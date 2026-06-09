import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { fallbackOperationalRoles, primaryUserRoleFromOperationalRoles } from "@/lib/operational-roles";
import type { OperationalRole, Prisma, UserRole } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["SHOP_ADMIN", "STAFF", "FIELD_SALES"]).optional(),
  roles: z.array(z.enum(["SHOP_ADMIN", "ACCOUNTING_STAFF", "FIELD_SALES_PERSON", "CHEQUE_OPERATIONS", "ORDER_MANAGER", "FOLLOWUP_MANAGER"])).min(1).optional(),
  mobile: z.string().optional(),
  jobTitle: z.string().optional(),
  password: z.string().min(8).optional(),
  shopId: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  userId: z.string().min(1),
  disabled: z.boolean().optional(),
});

function legacyAssignments(role: UserRole) {
  return fallbackOperationalRoles(role).map((item) => ({ role: item, createdAt: new Date(0) }));
}

async function findUsersWithRoleFallback(shopId: string | null, actorId: string, actorRole: string) {
  const where = {
    ...(shopId ? { shopId } : {}),
    role: { not: "SUPER_ADMIN" as const },
  };
  try {
    const users = await prisma.user.findMany({
      where,
      include: {
        shop: { select: { shopName: true } },
        roleAssignments: { select: { role: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    logger.info("staff_users_loaded_with_role_assignments", {
      actorId,
      actorRole,
      shopId,
      count: users.length,
    });
    return users;
  } catch (error) {
    logger.error("staff_users_role_assignment_load_failed_fallback_legacy_role", {
      actorId,
      actorRole,
      shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const users = await prisma.user.findMany({
      where,
      include: { shop: { select: { shopName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return users.map((user) => ({ ...user, roleAssignments: legacyAssignments(user.role) }));
  }
}

async function findUserWithRoleFallback(userId: string, actorId: string, actorRole: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { roleAssignments: true } });
    if (!user) return null;
    return user;
  } catch (error) {
    logger.error("staff_user_role_assignment_lookup_failed_fallback_legacy_role", {
      actorId,
      actorRole,
      userId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user ? { ...user, roleAssignments: [] } : null;
  }
}

async function syncRoleAssignments(tx: Prisma.TransactionClient, input: {
  actorId: string;
  actorRole: string;
  userId: string;
  shopId: string;
  roles: OperationalRole[];
}) {
  await tx.userRoleAssignment.deleteMany({ where: { userId: input.userId } });
  if (input.roles.length > 0) {
    await tx.userRoleAssignment.createMany({
      data: input.roles.map((role) => ({
        shopId: input.shopId,
        userId: input.userId,
        role,
        assignedById: input.actorId,
      })),
      skipDuplicates: true,
    });
  }
  logger.info("staff_user_role_assignments_synced", {
    actorId: input.actorId,
    actorRole: input.actorRole,
    userId: input.userId,
    shopId: input.shopId,
    roles: input.roles,
  });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = isSuperAdmin(session) ? new URL(request.url).searchParams.get("shopId") : session.shopId;
  const users = await findUsersWithRoleFallback(shopId, session.id, session.role);
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = createSchema.parse(await request.json());
    const shopId = isSuperAdmin(session) ? body.shopId : session.shopId;
    if (!shopId || shopId === "platform-shop") {
      logger.warn("user_create_missing_business_shop", { actorId: session.id, actorRole: session.role, requestedShopId: shopId });
      return NextResponse.json({ error: "A business shop is required" }, { status: 400 });
    }
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) {
      logger.warn("user_create_shop_not_found", { actorId: session.id, actorRole: session.role, requestedShopId: shopId });
      return NextResponse.json({ error: "Selected shop no longer exists. Please select a valid business shop." }, { status: 400 });
    }
    const requestedRoles = body.roles?.length ? body.roles : body.role ? fallbackOperationalRoles(body.role) : ["ACCOUNTING_STAFF" as const];
    const primaryRole = primaryUserRoleFromOperationalRoles(requestedRoles);
    const temporaryPassword = body.password ?? generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: body.name,
          email: body.email.toLowerCase(),
          mobile: body.mobile,
          role: primaryRole,
          jobTitle: body.jobTitle,
          shopId,
          passwordHash,
          passwordResetRequired: !body.password,
          tempPasswordExpiresAt: body.password ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        include: { shop: { select: { shopName: true } } },
      });
      await syncRoleAssignments(tx, { actorId: session.id, actorRole: session.role, userId: created.id, shopId, roles: requestedRoles });
      const roleAssignments = await tx.userRoleAssignment.findMany({
        where: { userId: created.id },
        select: { role: true, createdAt: true },
      });
      return { ...created, roleAssignments };
    });
    await prisma.activityLog.create({
      data: {
        action: "user_roles_assigned",
        userId: session.id,
        shopId,
        details: `${user.email}: ${requestedRoles.join(", ")}`,
      },
    }).catch((error) => logger.error("user_role_assignment_activity_log_failed_non_blocking", {
      actorId: session.id,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    await logActivity({
      action: "user_created",
      userId: session.id,
      shopId,
      details: user.email,
    });
    return NextResponse.json({ user, temporaryPassword }, { status: 201 });
  } catch (error) {
    logger.error("user_create_failed", {
      actorId: session.id,
      actorRole: session.role,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid staff details" : "Could not create staff user" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = updateSchema.parse(await request.json());
    const existing = await findUserWithRoleFallback(body.userId, session.id, session.role);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.id === session.id) {
      return NextResponse.json({ error: "You cannot edit your own Staff Management access. Use password reset only for your current account." }, { status: 400 });
    }
    if (existing.role === "SUPER_ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuperAdmin(session) && existing.shopId !== session.shopId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const requestedRoles = body.roles?.length
      ? body.roles
      : existing.roleAssignments.length
        ? existing.roleAssignments.map((assignment) => assignment.role)
        : fallbackOperationalRoles(existing.role);
    const primaryRole = primaryUserRoleFromOperationalRoles(requestedRoles, existing.role);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: existing.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.email ? { email: body.email.toLowerCase() } : {}),
          ...(body.mobile !== undefined ? { mobile: body.mobile } : {}),
          ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
          role: primaryRole,
          ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
        },
        include: { shop: { select: { shopName: true } } },
      });
      await syncRoleAssignments(tx, { actorId: session.id, actorRole: session.role, userId: existing.id, shopId: existing.shopId, roles: requestedRoles });
      const roleAssignments = await tx.userRoleAssignment.findMany({
        where: { userId: existing.id },
        select: { role: true, createdAt: true },
      });
      return { ...saved, roleAssignments };
    });
    await prisma.activityLog.create({
      data: {
        action: "user_roles_updated",
        userId: session.id,
        shopId: existing.shopId,
        details: `${updated.email}: ${requestedRoles.join(", ")}`,
      },
    }).catch((error) => logger.error("user_role_update_activity_log_failed_non_blocking", {
      actorId: session.id,
      userId: existing.id,
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json({ user: updated });
  } catch (error) {
    logger.error("user_update_failed", {
      actorId: session.id,
      actorRole: session.role,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid staff details" : "Could not update staff user" }, { status: 400 });
  }
}
