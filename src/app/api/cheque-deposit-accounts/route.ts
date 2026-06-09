import { NextResponse } from "next/server";
import type { ChequeStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canManageShop } from "@/lib/tenant";
import { requireShopId } from "@/lib/tenant";
import { normalizeOperationalRoles } from "@/lib/operational-roles";

const depositAccountAccessRoles = new Set(["SHOP_ADMIN", "ACCOUNTING_STAFF", "CHEQUE_OPERATIONS", "FIELD_SALES_PERSON"]);

const accountSchema = z.object({
  accountName: z.string().min(1),
  bankName: z.string().min(1),
  lastFourDigits: z.string().regex(/^\d{4}$/),
  isActive: z.boolean().optional(),
});

function accountLabel(account: { bankName: string; accountName: string; lastFourDigits: string }) {
  return `${account.bankName} - ${account.accountName} - ${account.lastFourDigits}`;
}

function canViewDepositAccounts(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return false;
  if (session.role === "SUPER_ADMIN" || session.role === "SHOP_ADMIN") return true;
  const roles = normalizeOperationalRoles(session.role, session.roles ?? []);
  return roles.some((role) => depositAccountAccessRoles.has(role));
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDepositAccounts(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  const accountIds = accounts.map((account) => account.id);
  const linkedCounts = accountIds.length
    ? await prisma.cheque.groupBy({
        by: ["depositedAccountId"],
        where: { shopId, depositedAccountId: { in: accountIds } },
        _count: { id: true },
      })
    : [];
  const linkedCountMap = new Map(linkedCounts.map((row) => [row.depositedAccountId, row._count.id]));
  const auditWhere: Prisma.ChequeWhereInput = {
    shopId,
    depositedAccountId: { in: accountIds },
    ...(from || to ? { depositDateTime: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(staffId ? { depositedById: staffId } : {}),
    ...(status ? { status: status as ChequeStatus } : {}),
  };
  const grouped = accountIds.length
    ? await prisma.cheque.groupBy({
        by: ["depositedAccountId", "status"],
        where: auditWhere,
        _sum: { amount: true },
        _count: { id: true },
      })
    : [];
  const bucket = new Map<string, { amount: number; count: number }>();
  for (const row of grouped) {
    if (!row.depositedAccountId) continue;
    bucket.set(`${row.depositedAccountId}:${row.status}`, {
      amount: row._sum.amount ?? 0,
      count: row._count.id,
    });
  }

  const audit = accounts.map((account) => {
      const statuses: ChequeStatus[] = ["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "CANCELLED"];
      const total = statuses.reduce(
        (sum, item) => {
          const value = bucket.get(`${account.id}:${item}`);
          return { amount: sum.amount + (value?.amount ?? 0), count: sum.count + (value?.count ?? 0) };
        },
        { amount: 0, count: 0 },
      );
      const cleared = bucket.get(`${account.id}:CLEARED`);
      const bounced = bucket.get(`${account.id}:BOUNCED`);
      const deposited = bucket.get(`${account.id}:DEPOSITED`);
      return {
        accountId: account.id,
        label: accountLabel(account),
        totalDeposited: total.amount,
        totalDepositedCount: total.count,
        totalCleared: cleared?.amount ?? 0,
        totalClearedCount: cleared?.count ?? 0,
        totalBounced: bounced?.amount ?? 0,
        totalBouncedCount: bounced?.count ?? 0,
        pendingUnderClearing: deposited?.amount ?? 0,
        pendingUnderClearingCount: deposited?.count ?? 0,
      };
    })
  ;

  return NextResponse.json({
    accounts: accounts.map((account) => ({
      ...account,
      linkedChequeCount: linkedCountMap.get(account.id) ?? 0,
    })),
    audit,
  });
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
