import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { canManageShop, isSuperAdmin } from "@/lib/tenant";
import { generateTemporaryPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";

export async function POST(
  _request: Request,
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

  const temporaryPassword = generateTemporaryPassword();
  const updated = await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      passwordResetRequired: true,
      tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    include: {
      shop: { select: { shopName: true } },
      roleAssignments: { select: { role: true, createdAt: true } },
    },
  });
  await logActivity({
    action: "user_password_reset",
    userId: session.id,
    shopId: updated.shopId,
    details: updated.email,
  });
  return NextResponse.json({ user: updated, temporaryPassword });
}
