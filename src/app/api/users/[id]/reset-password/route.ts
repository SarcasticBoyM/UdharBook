import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { fallbackOperationalRoles } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.role === "SUPER_ADMIN" && user.id !== session.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuperAdmin(session) && user.shopId !== session.shopId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const updated = await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      passwordResetRequired: true,
      tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    include: { shop: { select: { shopName: true } } },
  });
  const roleAssignments = await prisma.userRoleAssignment.findMany({
    where: { userId: updated.id, shopId: updated.shopId },
    select: { role: true, createdAt: true },
  }).catch((error) => {
    logger.error("user_reset_password_role_assignment_lookup_failed_fallback_legacy_role", {
      actorId: session.id,
      userId: updated.id,
      shopId: updated.shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return fallbackOperationalRoles(updated.role).map((role) => ({ role, createdAt: new Date(0) }));
  });
  await logActivity({
    action: "user_password_reset",
    userId: session.id,
    shopId: updated.shopId,
    details: updated.email,
  });
  return NextResponse.json({ user: { ...updated, roleAssignments }, temporaryPassword });
}
