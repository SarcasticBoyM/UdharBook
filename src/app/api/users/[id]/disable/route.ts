import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageShop, isSuperAdmin } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageShop(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "SUPER_ADMIN") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuperAdmin(session) && user.shopId !== session.shopId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const disabled = new URL(request.url).searchParams.get("disabled") !== "false";
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id },
      data: { disabledAt: disabled ? new Date() : null },
      include: {
        shop: { select: { shopName: true } },
        roleAssignments: { select: { role: true, createdAt: true } },
      },
    });
    if (disabled) {
      await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
    }
    return result;
  });
  await logActivity({
    action: disabled ? "user_disabled" : "user_enabled",
    userId: session.id,
    shopId: updated.shopId,
    details: updated.email,
  });
  return NextResponse.json({ user: updated });
}
