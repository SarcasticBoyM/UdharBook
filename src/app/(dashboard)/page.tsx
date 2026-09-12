import Link from "next/link";
import { cookies } from "next/headers";
import { Activity, AlertTriangle, CalendarClock, HardDrive, LifeBuoy, ScrollText, ShieldCheck, Store, Upload, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { startOfDay, endOfDay } from "date-fns";
import { DashboardDeferred } from "@/components/dashboard/DashboardDeferred";
import { formatDate } from "@/lib/utils";
import type { DashboardStats } from "@/types";
import { isSuperAdmin } from "@/lib/tenant";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const emptyStats: DashboardStats = {
  totalCustomers: 0,
  totalOutstanding: 0,
  pendingFollowup: 0,
  todayFollowups: 0,
  todayFollowupAmount: 0,
  todayCheques: 0,
  todayChequeAmount: 0,
  pendingCheques: 0,
  overdueFollowups: 0,
  highOutstanding: 0,
  recoveryAmount: 0,
  pendingOrders: 0,
  highPriorityOrders: 0,
  deliveredToday: 0,
  upcomingDeliveries: 0,
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
type DashboardCoreRow = {
  totalCustomers: number;
  totalOutstanding: number;
  pendingFollowup: number;
  todayFollowups: number;
  todayFollowupAmount: number;
  overdueFollowups: number;
  highOutstanding: number;
  recoveryAmount: number;
  todayCheques: number;
  todayChequeAmount: number;
  pendingCheques: number;
};

async function selectedShopId(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  try {
    if (!isSuperAdmin(session)) return session.shopId;

    const cookieStore = await cookies();
    const explicit = cookieStore.get("udharbook_shop")?.value;
    if (explicit && explicit !== "default-shop") {
      const shop = await prisma.shop.findUnique({ where: { id: explicit }, select: { id: true } });
      if (shop) return shop.id;
      logger.warn("dashboard_page_stale_shop_cookie", {
        userId: session.id,
        role: session.role,
        requestedShopId: explicit,
      });
    }

    const fallback = await prisma.shop.findFirst({
      where: { id: { not: "platform-shop" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return fallback?.id ?? session.shopId ?? "";
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
  const rows = await prisma.$queryRaw<DashboardCoreRow[]>(Prisma.sql`
    WITH customers AS (
      SELECT c.*, latest.status AS "latestFollowUpStatus"
      FROM "Customer" c
      LEFT JOIN LATERAL (
        SELECT f.status FROM "FollowUp" f
        WHERE f."customerId" = c.id
        ORDER BY f."followupDate" DESC LIMIT 1
      ) latest ON TRUE
      WHERE c."shopId" = ${shopId}
    ), active AS (
      SELECT * FROM customers
      WHERE status <> 'CLEARED' AND "outstandingBalance" > 0
        AND ("latestFollowUpStatus" IS NULL OR "latestFollowUpStatus" NOT IN ('PAID', 'COMPLETED', 'WRONG_NUMBER'))
    )
    SELECT
      (SELECT COUNT(*)::int FROM customers) AS "totalCustomers",
      COALESCE((SELECT SUM("outstandingBalance") FROM active), 0)::float8 AS "totalOutstanding",
      (SELECT COUNT(*)::int FROM active WHERE "nextFollowupDate" <= ${todayEnd}) AS "pendingFollowup",
      (SELECT COUNT(*)::int FROM active WHERE "nextFollowupDate" >= ${todayStart} AND "nextFollowupDate" <= ${todayEnd}) AS "todayFollowups",
      COALESCE((SELECT SUM("outstandingBalance") FROM active WHERE "nextFollowupDate" >= ${todayStart} AND "nextFollowupDate" <= ${todayEnd}), 0)::float8 AS "todayFollowupAmount",
      (SELECT COUNT(*)::int FROM active WHERE "nextFollowupDate" < ${new Date()}) AS "overdueFollowups",
      (SELECT COUNT(*)::int FROM customers WHERE "outstandingBalance" >= ${threshold}) AS "highOutstanding",
      COALESCE((SELECT SUM(amount) FROM (SELECT amount FROM "PaymentEntry" WHERE "shopId" = ${shopId} ORDER BY "paidAt" ASC LIMIT 200) p), 0)::float8 AS "recoveryAmount",
      (SELECT COUNT(*)::int FROM "Cheque" WHERE "shopId" = ${shopId} AND status IN ('COLLECTED', 'PENDING_DEPOSIT') AND "chequeDate" >= ${todayStart} AND "chequeDate" <= ${todayEnd}) AS "todayCheques",
      COALESCE((SELECT SUM(amount) FROM "Cheque" WHERE "shopId" = ${shopId} AND status IN ('COLLECTED', 'PENDING_DEPOSIT') AND "chequeDate" >= ${todayStart} AND "chequeDate" <= ${todayEnd}), 0)::float8 AS "todayChequeAmount",
      (SELECT COUNT(*)::int FROM "Cheque" WHERE "shopId" = ${shopId} AND status IN ('COLLECTED', 'PENDING_DEPOSIT')) AS "pendingCheques"
  `);
  const core = rows[0];
  const stats: DashboardStats = core ? { ...emptyStats, ...core } : emptyStats;

  logger.info("dashboard_page_stats_loaded", {
    shopId,
    customerCount: stats.totalCustomers,
    totalOutstanding: stats.totalOutstanding,
    todayFollowups: stats.todayFollowups,
    overdueFollowups: stats.overdueFollowups,
  });

  return stats;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session?.role === "SUPER_ADMIN") {
    return <PlatformDashboard />;
  }

  const shopId = session ? await selectedShopId(session) : "";
  let dashboardError = false;
  let stats = emptyStats;
  let staffCount = 0;

  try {
    stats = await getStats(shopId);
  } catch (error) {
    dashboardError = true;
    console.error("Dashboard stats failed", error);
  }

  if (shopId) {
    try {
      staffCount = await prisma.user.count({ where: { shopId, role: { not: "SUPER_ADMIN" } } });
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

      <SetupProgressCard stats={stats} staffCount={staffCount} />

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

      <DashboardDeferred initialStats={stats} />

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

async function PlatformDashboard() {
  const [shopCount, userCount, activeShops, activeShopCount, recentLogs, chequeFileCount, visitPhotoCount] = await prisma.$transaction([
    prisma.shop.count({ where: { id: { not: "platform-shop" } } }),
    prisma.user.count({ where: { role: { not: "SUPER_ADMIN" } } }),
    prisma.shop.findMany({
      where: { id: { not: "platform-shop" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        shopName: true,
        ownerName: true,
        subscriptionStatus: true,
        onboardingCompleted: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    }),
    prisma.shop.count({
      where: {
        id: { not: "platform-shop" },
        subscriptionStatus: { in: ["ACTIVE", "TRIAL"] },
      },
    }),
    prisma.activityLog.findMany({
      where: {
        action: {
          in: ["support_access_granted", "support_access_revoked", "support_access_used", "user_created", "user_disabled"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true, role: true } }, shop: { select: { shopName: true } } },
    }),
    prisma.cheque.count({
      where: {
        OR: [
          { frontImageUrl: { not: null } },
          { backImageUrl: { not: null } },
          { depositSlipUrl: { not: null } },
          { depositReceiptUrl: { not: null } },
        ],
      },
    }),
    prisma.visitPhoto.count(),
  ]);

  const storageObjects = chequeFileCount + visitPhotoCount;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Platform Dashboard</h1>
          <p className="text-slate-500">Privacy-safe platform operations without tenant business records.</p>
        </div>
        <Link href="/shops" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          <Store className="h-4 w-4" />
          Manage Shops
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PlatformStat label="Shops" value={shopCount} icon={Store} />
        <PlatformStat label="Tenant Users" value={userCount} icon={Users} />
        <PlatformStat label="Active / Trial" value={activeShopCount} icon={ShieldCheck} />
        <PlatformStat label="Stored Objects" value={storageObjects} icon={HardDrive} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Shops & Plans</h2>
              <p className="text-sm text-slate-500">Operational metadata only: no customers, balances, notes, images, or ledger details.</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-2">Shop</th>
                  <th className="p-2">Plan</th>
                  <th className="p-2">Users</th>
                  <th className="p-2">Onboarding</th>
                  <th className="p-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {activeShops.map((shop) => (
                  <tr key={shop.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2">
                      <p className="font-medium">{shop.shopName}</p>
                      <p className="text-xs text-slate-500">{shop.ownerName}</p>
                    </td>
                    <td className="p-2">{shop.subscriptionStatus}</td>
                    <td className="p-2">{shop._count.users}</td>
                    <td className="p-2">{shop.onboardingCompleted ? "Complete" : "Pending"}</td>
                    <td className="p-2">{formatDate(shop.createdAt)}</td>
                  </tr>
                ))}
                {activeShops.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate-500">No shops onboarded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-brand-600" />
            <h2 className="font-semibold">System Health</h2>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <HealthRow label="Auth middleware" value="Protected" />
            <HealthRow label="Tenant isolation" value="SUPER_ADMIN blocked by default" />
            <HealthRow label="Business APIs" value="Shop session required" />
            <HealthRow label="Support access" value="Temporary grants audited" />
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="card">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-amber-600" />
            <h2 className="font-semibold">Support Access</h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">Business data remains blocked unless a shop admin grants temporary support access. Every grant and use is written to the audit log.</p>
          <Link href="/shops" className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            Review support tools
          </Link>
        </section>

        <section className="card">
          <div className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-slate-600" />
            <h2 className="font-semibold">System Logs</h2>
          </div>
          <ul className="mt-4 space-y-3 text-sm">
            {recentLogs.length === 0 ? (
              <li className="text-slate-500">No platform audit events yet.</li>
            ) : (
              recentLogs.map((log) => (
                <li key={log.id} className="border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
                  <p className="font-medium">{log.action.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-500">
                    {log.shop?.shopName ?? "Platform"} | {log.user?.name ?? "System"} | {formatDate(log.createdAt)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function PlatformStat({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <Icon className="h-5 w-5 text-brand-600" />
      </div>
      <p className="mt-2 text-2xl font-bold">{value.toLocaleString("en-IN")}</p>
    </div>
  );
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function SetupProgressCard({ stats, staffCount }: { stats: DashboardStats; staffCount: number }) {
  const items = [
    { label: "Create shop", done: true, href: "/shops" },
    { label: "Add admin", done: staffCount > 0, href: "/shops" },
    { label: "Upload customers", done: stats.totalCustomers > 0, href: "/upload" },
    { label: "Add staff", done: staffCount > 1, href: "/shops" },
    { label: "Configure reminders", done: true, href: "/today-follow-ups" },
    { label: "Start first follow-up", done: stats.todayFollowups > 0 || stats.overdueFollowups > 0, href: "/today-follow-ups" },
  ];
  const done = items.filter((item) => item.done).length;
  const percent = Math.round((done / items.length) * 100);
  if (percent === 100 && stats.totalCustomers > 0) return null;

  return (
    <section className="mt-5 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-950 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Setup progress</h2>
          <p className="mt-1 text-sm opacity-80">Complete these steps to start recovery work smoothly.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-100">{percent}%</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm font-medium dark:bg-slate-900/70">
            <span className={item.done ? "text-emerald-600" : "text-slate-400"}>{item.done ? "Done" : "Open"}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
