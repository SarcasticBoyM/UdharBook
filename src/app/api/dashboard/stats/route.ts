import { NextResponse } from "next/server";
import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { agingBucket } from "@/lib/aging";
import type { DashboardStats } from "@/types";
import { requireShopId } from "@/lib/tenant";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shopId = requireShopId(request, session);

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);

  const customers = await prisma.customer.findMany({ where: { shopId } });
  const active = customers.filter((c) => c.status !== "CLEARED" && c.outstandingBalance > 0);

  const totalOutstanding = active.reduce((s, c) => s + c.outstandingBalance, 0);
  const pendingFollowup = active.filter(
    (c) => c.nextFollowupDate && c.nextFollowupDate <= todayEnd
  ).length;
  const todayFollowups = active.filter(
    (c) =>
      c.nextFollowupDate &&
      c.nextFollowupDate >= todayStart &&
      c.nextFollowupDate <= todayEnd
  ).length;
  const overdueFollowups = active.filter(
    (c) => c.nextFollowupDate && c.nextFollowupDate < todayStart
  ).length;
  const highOutstanding = customers.filter((c) => c.outstandingBalance >= threshold).length;

  const statusGroups = await prisma.customer.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { status: true },
  });

  const agingMap: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of active) {
    const bucket = agingBucket(c.balanceAsOfDate);
    agingMap[bucket] += c.outstandingBalance;
  }

  const payments = await prisma.paymentEntry.findMany({
    where: { shopId },
    orderBy: { paidAt: "asc" },
    take: 200,
  });

  const monthMap = new Map<string, number>();
  for (const payment of payments) {
    const key = payment.paidAt.toISOString().slice(0, 7);
    monthMap.set(key, (monthMap.get(key) ?? 0) + payment.amount);
  }

  const staffActivityGroups = await prisma.activityLog.groupBy({
    by: ["userId"],
    where: { shopId, createdAt: { gte: todayStart } },
    _count: { userId: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: staffActivityGroups.map((group) => group.userId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((user) => [user.id, user.name]));

  const stats: DashboardStats = {
    totalCustomers: customers.length,
    totalOutstanding,
    pendingFollowup,
    todayFollowups,
    overdueFollowups,
    highOutstanding,
    recoveryAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
    staffActivity: staffActivityGroups.map((group) => ({
      name: group.userId ? userMap.get(group.userId) ?? "Unknown" : "System",
      count: group._count.userId,
    })),
    statusDistribution: statusGroups.map((g) => ({
      status: g.status,
      count: g._count.status,
    })),
    collectionProgress: Array.from(monthMap.entries()).map(([month, collected]) => ({
      month,
      collected,
    })),
    outstandingSummary: Object.entries(agingMap).map(([label, amount]) => ({
      label,
      amount,
    })),
  };

  return NextResponse.json(stats);
}
