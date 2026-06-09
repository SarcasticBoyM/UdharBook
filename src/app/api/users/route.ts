import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { logger } from "@/lib/logger";
import { normalizeFixedRole, roleLabel, type FixedShopRole } from "@/lib/operational-roles";

const fixedRoleValues = ["SHOP_ADMIN", "SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"] as const;
const fixedRoleSchema = z.preprocess(
  (value) => normalizeFixedRole(String(value ?? "")),
  z.enum(fixedRoleValues),
);

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

function fixedUserRole(role: FixedShopRole | undefined, fallback: UserRole = "ACCOUNT_STAFF" as UserRole) {
  return (role ? normalizeFixedRole(role) : fallback) as UserRole;
}

type StaffListRow = {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  jobTitle: string | null;
  role: string | null;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  shopId: string;
  createdAt: Date;
  shopName: string | null;
};

const fixedRoleSet = new Set<string>(fixedRoleValues);

function safeStaffRole(role: string | null | undefined, userId?: string) {
  const normalized = normalizeFixedRole(role || "ACCOUNT_STAFF");
  if (fixedRoleSet.has(String(normalized))) {
    if (role && role !== normalized) {
      logger.warn("staff_role_legacy_value_normalized", { userId, originalRole: role, normalizedRole: normalized });
    }
    return normalized as FixedShopRole;
  }
  logger.warn("staff_role_unknown_value_defaulted", { userId, originalRole: role, normalizedRole: "ACCOUNT_STAFF" });
  return "ACCOUNT_STAFF" as FixedShopRole;
}

async function findUsers(shopId: string | null) {
  const where = shopId
    ? Prisma.sql`WHERE u."shopId" = ${shopId} AND u."role"::text <> 'SUPER_ADMIN'`
    : Prisma.sql`WHERE u."role"::text <> 'SUPER_ADMIN'`;
  const rows = await prisma.$queryRaw<StaffListRow[]>(Prisma.sql`
    SELECT
      u."id",
      u."name",
      u."email",
      u."mobile",
      u."jobTitle",
      u."role"::text AS "role",
      u."disabledAt",
      u."lastLoginAt",
      u."shopId",
      u."createdAt",
      s."name" AS "shopName"
    FROM "User" u
    LEFT JOIN "Shop" s ON s."id" = u."shopId"
    ${where}
    ORDER BY u."createdAt" DESC
  `);
  logger.info("staff_fetch_raw_success", {
    shopId,
    rowCount: rows.length,
    legacyRoleCount: rows.filter((row) => row.role && safeStaffRole(row.role) !== row.role).length,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    mobile: row.mobile,
    jobTitle: row.jobTitle,
    role: safeStaffRole(row.role, row.id),
    disabledAt: row.disabledAt,
    lastLoginAt: row.lastLoginAt,
    shopId: row.shopId,
    createdAt: row.createdAt,
    shop: row.shopName ? { shopName: row.shopName } : null,
  }));
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = isSuperAdmin(session) ? new URL(request.url).searchParams.get("shopId") : session.shopId;
  try {
    const users = await findUsers(shopId);
    return NextResponse.json({ users });
  } catch (error) {
    logger.error("staff_fetch_failed", {
      actorId: session.id,
      actorRole: session.role,
      shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ users: [], warning: "Staff list could not be loaded right now." });
  }
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
    const [existing] = await prisma.$queryRaw<Array<{ id: string; role: string | null; shopId: string }>>(Prisma.sql`
      SELECT "id", "role"::text AS "role", "shopId"
      FROM "User"
      WHERE "id" = ${body.userId}
      LIMIT 1
    `);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.id === session.id) {
      return NextResponse.json({ error: "You cannot edit your own Staff Management access. Use password reset only for your current account." }, { status: 400 });
    }
    if (existing.role === "SUPER_ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isSuperAdmin(session) && existing.shopId !== session.shopId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const role = fixedUserRole(body.role, normalizeFixedRole(existing.role || "ACCOUNT_STAFF") as UserRole);
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
