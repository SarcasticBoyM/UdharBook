import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/tenant";
import { canManageUsers } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { fallbackOperationalRoles } from "@/lib/operational-roles";
import { logger } from "@/lib/logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageUsers(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.id === session.id) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }
  if (user.role === "SUPER_ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuperAdmin(session) && user.shopId !== session.shopId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const disabled = new URL(request.url).searchParams.get("disabled") !== "false";
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id },
      data: { disabledAt: disabled ? new Date() : null },
      include: { shop: { select: { shopName: true } } },
    });
    if (disabled) {
      await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
    }
    return result;
  });
  const roleAssignments = await prisma.userRoleAssignment.findMany({
    where: { userId: updated.id, shopId: updated.shopId },
    select: { role: true, createdAt: true },
  }).catch((error) => {
    logger.error("user_disable_role_assignment_lookup_failed_fallback_legacy_role", {
      actorId: session.id,
      userId: updated.id,
      shopId: updated.shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return fallbackOperationalRoles(updated.role).map((role) => ({ role, createdAt: new Date(0) }));
  });
  await logActivity({
    action: disabled ? "user_disabled" : "user_enabled",
    userId: session.id,
    shopId: updated.shopId,
    details: updated.email,
  });
  return NextResponse.json({ user: { ...updated, roleAssignments } });
}
