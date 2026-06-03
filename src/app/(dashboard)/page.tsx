import Link from "next/link";
import { cookies } from "next/headers";
import { Upload, UserPlus, CalendarClock, AlertTriangle } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { startOfDay, endOfDay } from "date-fns";
import { StatCards } from "@/components/dashboard/StatCards";
import { DashboardCharts } from "@/components/dashboard/Charts";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DashboardStats } from "@/types";
import { agingBucket } from "@/lib/aging";

export const dynamic = "force-dynamic";

const emptyStats: DashboardStats = {
  totalCustomers: 0,
  totalOutstanding: 0,
  pendingFollowup: 0,
  todayFollowups: 0,
  overdueFollowups: 0,
  highOutstanding: 0,
  recoveryAmount: 0,
  staffActivity: [],
  statusDistribution: [],
  collectionProgress: [],
  outstandingSummary: [
    { label: "0-30", amount: 0 },
    { label: "31-60", amount: 0 },
    { label: "61-90", amount: 0 },
    { label: "90+", amount: 0 },
  ],
};

type RecentActivityItem = Prisma.ActivityLogGetPayload<{
  include: {
    user: { select: { name: true } };
    customer: { select: { partyName: true; id: true } };
  };
}>;

async function selectedShopId() {
  try {
    const session = await getSession();
    const cookieStore = await cookies();
    const explicit = cookieStore.get("udharbook_shop")?.value ?? session?.shopId;
    if (explicit) return explicit;
    const firstShop = await prisma.shop.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    return firstShop?.id ?? "";
  } catch (error) {
    console.error("Dashboard shop lookup failed", error);
    return "";
  }
}

async function getStats(shopId: string): Promise<DashboardStats> {
  if (!shopId) return emptyStats;
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);

  const customers = await prisma.customer.findMany({ where: { shopId } });
  const active = customers.filter((c) => c.status !== "CLEARED" && c.outstandingBalance > 0);

  const statusGroups = await prisma.customer.groupBy({
    by: ["status"],
    where: { shopId },
    _count: { status: true },
  });

  const agingMap: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of active) {
    agingMap[agingBucket(c.balanceAsOfDate)] += c.outstandingBalance;
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

  const staffGroups = await prisma.activityLog.groupBy({
    by: ["userId"],
    where: { shopId, createdAt: { gte: todayStart } },
    _count: { userId: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: staffGroups.map((group) => group.userId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((user) => [user.id, user.name]));

  return {
    totalCustomers: customers.length,
    totalOutstanding: active.reduce((s, c) => s + c.outstandingBalance, 0),
    pendingFollowup: active.filter((c) => c.nextFollowupDate && c.nextFollowupDate <= todayEnd).length,
    todayFollowups: active.filter(
      (c) => c.nextFollowupDate && c.nextFollowupDate >= todayStart && c.nextFollowupDate <= todayEnd
    ).length,
    overdueFollowups: active.filter((c) => c.nextFollowupDate && c.nextFollowupDate < todayStart).length,
    highOutstanding: customers.filter((c) => c.outstandingBalance >= threshold).length,
    recoveryAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
    staffActivity: staffGroups.map((group) => ({
      name: group.userId ? userMap.get(group.userId) ?? "Unknown" : "System",
      count: group._count.userId,
    })),
    statusDistribution: statusGroups.map((g) => ({ status: g.status, count: g._count.status })),
    collectionProgress: Array.from(monthMap.entries()).map(([month, collected]) => ({ month, collected })),
    outstandingSummary: Object.entries(agingMap).map(([label, amount]) => ({ label, amount })),
  };
}

export default async function DashboardPage() {
  const shopId = await selectedShopId();
  let dashboardError = false;
  let stats = emptyStats;
  let highBalanceCustomers: Awaited<ReturnType<typeof prisma.customer.findMany>> = [];
  let recentActivity: RecentActivityItem[] = [];

  try {
    stats = await getStats(shopId);
  } catch (error) {
    dashboardError = true;
    console.error("Dashboard stats failed", error);
  }

  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);
  if (shopId) {
    try {
      highBalanceCustomers = await prisma.customer.findMany({
        where: { shopId, outstandingBalance: { gte: threshold }, NOT: { status: "CLEARED" } },
        orderBy: { outstandingBalance: "desc" },
        take: 5,
      });
      recentActivity = await prisma.activityLog.findMany({
        where: { shopId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          user: { select: { name: true } },
          customer: { select: { partyName: true, id: true } },
        },
      });
    } catch (error) {
      dashboardError = true;
      console.error("Dashboard secondary queries failed", error);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-slate-500">UdharBook collections and recovery overview</p>

      {dashboardError && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Dashboard data could not be loaded right now. Other modules can still be opened from the sidebar.
        </div>
      )}

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
          <h3 className="font-semibold">High Risk Outstanding Customers</h3>
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

      <div className="card mt-6">
        <h3 className="font-semibold">Recent Activity</h3>
        <ul className="mt-3 space-y-3 text-sm">
          {recentActivity.length === 0 ? (
            <li className="text-slate-500">No activity yet</li>
          ) : (
            recentActivity.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                <span>
                  <span className="font-medium">{item.action.replace(/_/g, " ")}</span>
                  {item.customer && (
                    <>
                      {" for "}
                      <Link href={`/customers/${item.customer.id}`} className="text-brand-600 hover:underline">
                        {item.customer.partyName}
                      </Link>
                    </>
                  )}
                </span>
                <span className="text-xs text-slate-500">{formatDate(item.createdAt)}</span>
              </li>
            ))
          )}
        </ul>
      </div>

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
