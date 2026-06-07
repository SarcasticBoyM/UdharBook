import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageShop, requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const updateSchema = z.object({
  accountName: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  lastFourDigits: z.string().regex(/^\d{4}$/).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageShop(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { id } = await params;
  const body = updateSchema.parse(await request.json());

  const existing = await prisma.chequeDepositAccount.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const account = await prisma.chequeDepositAccount.update({ where: { id }, data: body });
  return NextResponse.json(account);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "SHOP_ADMIN") return NextResponse.json({ error: "Only shop admins can delete deposit accounts" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const { id } = await params;

  const account = await prisma.chequeDepositAccount.findFirst({
    where: { id, shopId },
    select: { id: true, bankName: true, accountName: true, lastFourDigits: true, isActive: true },
  });
  if (!account) return NextResponse.json({ error: "Deposit account not found" }, { status: 404 });

  const linkedChequeCount = await prisma.cheque.count({ where: { shopId, depositedAccountId: id } });
  const label = `${account.bankName} - ${account.accountName} - ${account.lastFourDigits}`;

  if (linkedChequeCount > 0) {
    if (!account.isActive) {
      return NextResponse.json(
        { error: "This account is already archived because it is linked to cheque records.", action: "already_archived", linkedChequeCount },
        { status: 409 },
      );
    }
    const archived = await prisma.chequeDepositAccount.update({
      where: { id },
      data: { isActive: false },
    });
    await logActivity({
      action: "cheque_deposit_account_archived",
      shopId,
      userId: session.id,
      details: `${label} archived; linked cheque records: ${linkedChequeCount}`,
    });
    return NextResponse.json({
      account: archived,
      action: "archived",
      linkedChequeCount,
      message: "Account is linked to cheque records, so it was archived instead of deleted.",
    });
  }

  await prisma.chequeDepositAccount.delete({ where: { id } });
  await logActivity({
    action: "cheque_deposit_account_deleted",
    shopId,
    userId: session.id,
    details: `${label} deleted`,
  });
  return NextResponse.json({ action: "deleted", linkedChequeCount: 0, message: "Deposit account deleted successfully." });
}
