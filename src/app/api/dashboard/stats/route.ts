import { NextResponse } from "next/server";
import { startOfDay, endOfDay } from "date-fns";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { agingBucket } from "@/lib/aging";
import type { DashboardStats } from "@/types";
import { requestedShopId, isSuperAdmin } from "@/lib/tenant";
import { logger } from "@/lib/logger";

const emptyStats: DashboardStats = {
  totalCustomers: 0,
  totalOutstanding: 0,
  pendingFollowup: 0,
  todayFollowups: 0,
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
const CLOSED_FOLLOW_UP_STATUSES = new Set(["PAID", "COMPLETED", "WRONG_NUMBER"]);

async function resolveDashboardShopId(request: Request, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  if (!isSuperAdmin(session)) return session.shopId;

  const requested = requestedShopId(request, session);
  const requestedShop = requested && requested !== "default-shop"
    ? await prisma.shop.findUnique({ where: { id: requested }, select: { id: true } })
    : null;
  if (requestedShop) return requestedShop.id;

  if (requested) {
    logger.warn("dashboard_stats_requested_shop_missing", {
      userId: session.id,
      role: session.role,
      requestedShopId: requested,
    });
  }

  const fallback = await prisma.shop.findFirst({
    where: { id: { not: "platform-shop" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return fallback?.id ?? session.shopId;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shopId = await resolveDashboardShopId(request, session);
  if (!shopId) {
    logger.warn("dashboard_stats_no_shop", { userId: session.id, role: session.role });
    return NextResponse.json(emptyStats);
  }

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const now = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const threshold = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);

  const customers = await prisma.customer.findMany({
    where: { shopId, isArchived: false },
    include: { followUps: { orderBy: { followupDate: "desc" }, take: 1, select: { status: true } } },
  });
  const active = customers.filter((c) => c.status !== "CLEARED" && c.outstandingBalance > 0 && !CLOSED_FOLLOW_UP_STATUSES.has(c.followUps[0]?.status ?? ""));

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
    (c) => c.nextFollowupDate && c.nextFollowupDate < now
  ).length;
  const highOutstanding = active.filter((c) => c.outstandingBalance >= threshold).length;
  const statusCounts = active.reduce<Record<string, number>>((counts, customer) => {
    counts[customer.status] = (counts[customer.status] ?? 0) + 1;
    return counts;
  }, {});

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
  const [pendingOrders, highPriorityOrders, deliveredToday, upcomingDeliveries] = await prisma.$transaction([
    prisma.order.count({ where: { shopId, status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.order.count({ where: { shopId, status: { in: ["PENDING", "PROCESSING"] }, priority: "High" } }),
    prisma.order.count({ where: { shopId, status: "DELIVERED", deliveredAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.order.count({ where: { shopId, status: { in: ["PENDING", "PROCESSING"] }, preferredDeliveryDate: { gte: new Date(), lte: nextWeek } } }),
  ]);

  const stats: DashboardStats = {
    totalCustomers: active.length,
    totalOutstanding,
    pendingFollowup,
    todayFollowups,
    overdueFollowups,
    highOutstanding,
    recoveryAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
    pendingOrders,
    highPriorityOrders,
    deliveredToday,
    upcomingDeliveries,
    staffActivity: staffActivityGroups.map((group) => ({
      name: group.userId ? userMap.get(group.userId) ?? "Unknown" : "System",
      count: group._count.userId,
    })),
    statusDistribution: Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
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

  logger.info("dashboard_stats_loaded", {
    userId: session.id,
    role: session.role,
    shopId,
    customerCount: customers.length,
    activeCustomerCount: active.length,
    paymentCount: payments.length,
    followupDueCount: pendingFollowup,
    totalOutstanding,
    recoveryAmount: stats.recoveryAmount,
  });

  return NextResponse.json(stats);
}
