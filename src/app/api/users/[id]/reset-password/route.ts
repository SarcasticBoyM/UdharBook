import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { normalizeFixedRole } from "@/lib/operational-roles";

type UserRow = {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  jobTitle: string | null;
  role: string | null;
  shopId: string;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  shopName: string | null;
};

async function getUserRow(id: string) {
  const [user] = await prisma.$queryRaw<UserRow[]>(Prisma.sql`
    SELECT u."id", u."name", u."email", u."mobile", u."jobTitle", u."role"::text AS "role",
      u."shopId", u."disabledAt", u."lastLoginAt", s."name" AS "shopName"
    FROM "User" u
    LEFT JOIN "Shop" s ON s."id" = u."shopId"
    WHERE u."id" = ${id}
    LIMIT 1
  `);
  return user
    ? { ...user, role: normalizeFixedRole(user.role || "ACCOUNT_STAFF"), shop: user.shopName ? { shopName: user.shopName } : null }
    : null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await getUserRow(id);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.role === "SUPER_ADMIN" && user.id !== session.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuperAdmin(session) && user.shopId !== session.shopId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "User"
    SET "passwordHash" = ${passwordHash},
      "passwordResetRequired" = true,
      "tempPasswordExpiresAt" = ${expiresAt}
    WHERE "id" = ${id}
  `);
  const updated = await getUserRow(id);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logActivity({
    action: "user_password_reset",
    userId: session.id,
    shopId: updated.shopId,
    details: updated.email,
  });
  return NextResponse.json({ user: updated, temporaryPassword });
}
