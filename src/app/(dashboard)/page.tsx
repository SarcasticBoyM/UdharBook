import Link from "next/link";
import { Upload, UserPlus, CalendarClock, AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { startOfDay, endOfDay } from "date-fns";
import { StatCards } from "@/components/dashboard/StatCards";
import { DashboardCharts } from "@/components/dashboard/Charts";
import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "@/types";
import { agingBucket } from "@/lib/aging";

async function getStats(): Promise<DashboardStats> {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);

  const customers = await prisma.customer.findMany();
  const active = customers.filter((c) => c.status !== "PAID" && c.outstandingBalance > 0);

  const statusGroups = await prisma.customer.groupBy({
    by: ["status"],
    _count: { status: true },
  });

  const agingMap: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of active) {
    agingMap[agingBucket(c.balanceAsOfDate)] += c.outstandingBalance;
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

  return {
    totalCustomers: customers.length,
    totalOutstanding: active.reduce((s, c) => s + c.outstandingBalance, 0),
    pendingFollowup: active.filter((c) => c.nextFollowupDate && c.nextFollowupDate <= todayEnd).length,
    todayFollowups: active.filter(
      (c) => c.nextFollowupDate && c.nextFollowupDate >= todayStart && c.nextFollowupDate <= todayEnd
    ).length,
    overdueFollowups: active.filter((c) => c.nextFollowupDate && c.nextFollowupDate < todayStart).length,
    highOutstanding: customers.filter((c) => c.outstandingBalance >= threshold).length,
    statusDistribution: statusGroups.map((g) => ({ status: g.status, count: g._count.status })),
    collectionProgress: Array.from(monthMap.entries()).map(([month, collected]) => ({ month, collected })),
    outstandingSummary: Object.entries(agingMap).map(([label, amount]) => ({ label, amount })),
  };
}

export default async function DashboardPage() {
  await getSession();
  const stats = await getStats();
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);
  const highBalanceCustomers = await prisma.customer.findMany({
    where: { outstandingBalance: { gte: threshold }, NOT: { status: "PAID" } },
    orderBy: { outstandingBalance: "desc" },
    take: 5,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-slate-500">Payment follow-up overview</p>

      {(stats.overdueFollowups > 0 || stats.todayFollowups > 0) && (
        <div className="mt-4 space-y-2">
          {stats.todayFollowups > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              <CalendarClock className="h-5 w-5" />
              {stats.todayFollowups} follow-up(s) scheduled for today
            </div>
          )}
          {stats.overdueFollowups > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              <AlertTriangle className="h-5 w-5" />
              {stats.overdueFollowups} overdue follow-up(s)
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <StatCards stats={stats} />
      </div>

      <DashboardCharts stats={stats} />

      {highBalanceCustomers.length > 0 && (
        <div className="card mt-6">
          <h3 className="font-semibold">High Outstanding Customers</h3>
          <ul className="mt-3 space-y-2">
            {highBalanceCustomers.map((c) => (
              <li key={c.id} className="flex justify-between text-sm">
                <Link href={`/customers/${c.id}`} className="text-brand-600 hover:underline">
                  {c.partyName}
                </Link>
                <span className="font-medium">{formatCurrency(c.outstandingBalance)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/upload"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          <Upload className="h-4 w-4" />
          Upload Excel
        </Link>
        <Link
          href="/customers/new"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <UserPlus className="h-4 w-4" />
          Add Customer
        </Link>
        <Link
          href="/follow-ups"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <CalendarClock className="h-4 w-4" />
          View Follow-ups
        </Link>
      </div>
    </div>
  );
}
