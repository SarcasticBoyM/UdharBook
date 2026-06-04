import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageShop } from "@/lib/tenant";
import { requireShopId } from "@/lib/tenant";

const accountSchema = z.object({
  accountName: z.string().min(1),
  bankName: z.string().min(1),
  lastFourDigits: z.string().regex(/^\d{4}$/),
  isActive: z.boolean().optional(),
});

function accountLabel(account: { bankName: string; accountName: string; lastFourDigits: string }) {
  return `${account.bankName} - ${account.accountName} - ${account.lastFourDigits}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = requireShopId(request, session);
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get("activeOnly") !== "false";
  const from = searchParams.get("from") ? new Date(String(searchParams.get("from"))) : undefined;
  const to = searchParams.get("to") ? new Date(String(searchParams.get("to"))) : undefined;
  if (to) to.setHours(23, 59, 59, 999);
  const staffId = searchParams.get("staffId") || undefined;
  const status = searchParams.get("status") || undefined;

  const accounts = await prisma.chequeDepositAccount.findMany({
    where: { shopId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ isActive: "desc" }, { bankName: "asc" }, { accountName: "asc" }],
  });

  const audit = await Promise.all(
    accounts.map(async (account) => {
      const where = {
        shopId,
        depositedAccountId: account.id,
        ...(from || to ? { depositDateTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(staffId ? { depositedById: staffId } : {}),
        ...(status ? { status: status as never } : {}),
      };
      const [totalDeposited, totalCleared, totalBounced, pendingUnderClearing] = await Promise.all([
        prisma.cheque.aggregate({ where, _sum: { amount: true }, _count: { id: true } }),
        prisma.cheque.aggregate({ where: { ...where, status: "CLEARED" }, _sum: { amount: true }, _count: { id: true } }),
        prisma.cheque.aggregate({ where: { ...where, status: "BOUNCED" }, _sum: { amount: true }, _count: { id: true } }),
        prisma.cheque.aggregate({ where: { ...where, status: "DEPOSITED" }, _sum: { amount: true }, _count: { id: true } }),
      ]);

      return {
        accountId: account.id,
        label: accountLabel(account),
        totalDeposited: totalDeposited._sum.amount ?? 0,
        totalDepositedCount: totalDeposited._count.id,
        totalCleared: totalCleared._sum.amount ?? 0,
        totalClearedCount: totalCleared._count.id,
        totalBounced: totalBounced._sum.amount ?? 0,
        totalBouncedCount: totalBounced._count.id,
        pendingUnderClearing: pendingUnderClearing._sum.amount ?? 0,
        pendingUnderClearingCount: pendingUnderClearing._count.id,
      };
    })
  );

  return NextResponse.json({ accounts, audit });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageShop(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const shopId = requireShopId(request, session);
  const body = accountSchema.parse(await request.json());
  const account = await prisma.chequeDepositAccount.create({
    data: { shopId, ...body, isActive: body.isActive ?? true },
  });
  return NextResponse.json(account, { status: 201 });
}
