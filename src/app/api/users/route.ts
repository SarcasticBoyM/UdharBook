import { NextResponse } from "next/server";
import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { normalizeFixedRole, roleLabel } from "@/lib/operational-roles";

const fixedRoleSchema = z.enum(["SHOP_ADMIN", "SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"]);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: fixedRoleSchema.default("ACCOUNT_STAFF"),
  mobile: z.string().optional(),
  jobTitle: z.string().optional(),
  password: z.string().min(8).optional(),
  shopId: z.string().optional(),
});

const updateSchema = createSchema.partial().extend({
  userId: z.string().min(1),
  disabled: z.boolean().optional(),
});

function fixedUserRole(role: string | undefined, fallback: UserRole = "ACCOUNT_STAFF" as UserRole) {
  return (role ? normalizeFixedRole(role) : fallback) as UserRole;
}

async function findUsers(shopId: string | null) {
  return prisma.user.findMany({
    where: {
      ...(shopId ? { shopId } : {}),
      role: { not: "SUPER_ADMIN" },
    },
    include: { shop: { select: { shopName: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = isSuperAdmin(session) ? new URL(request.url).searchParams.get("shopId") : session.shopId;
  const users = await findUsers(shopId);
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
      return NextResponse.json({ error: "A business shop is required" }, { status: 400 });
    }
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) return NextResponse.json({ error: "Selected shop no longer exists. Please select a valid business shop." }, { status: 400 });

    const temporaryPassword = body.password ?? generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const role = fixedUserRole(body.role);
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        mobile: body.mobile,
        role,
        jobTitle: body.jobTitle,
        shopId,
        passwordHash,
        passwordResetRequired: !body.password,
        tempPasswordExpiresAt: body.password ? null : new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      include: { shop: { select: { shopName: true } } },
    });
    await logActivity({
      action: "user_created",
      userId: session.id,
      shopId,
      details: `${user.email}: ${roleLabel(role)}`,
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
    const existing = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.id === session.id) {
      return NextResponse.json({ error: "You cannot edit your own Staff Management access. Use password reset only for your current account." }, { status: 400 });
    }
    if (existing.role === "SUPER_ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuperAdmin(session) && existing.shopId !== session.shopId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const role = fixedUserRole(body.role, normalizeFixedRole(existing.role) as UserRole);
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email.toLowerCase() } : {}),
        ...(body.mobile !== undefined ? { mobile: body.mobile } : {}),
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
        role,
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
      },
      include: { shop: { select: { shopName: true } } },
    });
    await prisma.activityLog.create({
      data: {
        action: "user_role_updated",
        userId: session.id,
        shopId: existing.shopId,
        details: `${updated.email}: ${roleLabel(role)}`,
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
