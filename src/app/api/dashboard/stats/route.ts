import { NextResponse } from "next/server";
import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { agingBucket } from "@/lib/aging";
import type { DashboardStats } from "@/types";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);

  const customers = await prisma.customer.findMany();
  const active = customers.filter((c) => c.status !== "PAID" && c.outstandingBalance > 0);

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
    _count: { status: true },
  });

  const agingMap: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of active) {
    const bucket = agingBucket(c.balanceAsOfDate);
    agingMap[bucket] += c.outstandingBalance;
  }

  const paidFollowUps = await prisma.followUp.findMany({
    where: { status: "PAID" },
    orderBy: { followupDate: "asc" },
    take: 200,
  });

  const monthMap = new Map<string, number>();
  for (const f of paidFollowUps) {
    const key = f.followupDate.toISOString().slice(0, 7);
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
  }

  const stats: DashboardStats = {
    totalCustomers: customers.length,
    totalOutstanding,
    pendingFollowup,
    todayFollowups,
    overdueFollowups,
    highOutstanding,
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
