import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function queuePriorityScore(balance: number, dueDate: Date | null, priority?: string) {
  const now = new Date();
  const overdueDays = dueDate ? Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86400000)) : 0;
  const priorityScore = { URGENT: 4000, HIGH: 3000, MEDIUM: 2000, LOW: 1000 }[priority ?? "MEDIUM"] ?? 2000;
  return overdueDays * 10000 + priorityScore + Math.min(balance, 500000);
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const skip = Number(searchParams.get("skip") ?? 0);
  const take = Math.min(Number(searchParams.get("take") ?? 30), 100);
  const shopId = requireShopId(request, session);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const pendingWhere = {
    shopId,
    outstandingBalance: { gt: 0 },
    NOT: { status: "CLEARED" as const },
    nextFollowupDate: { lte: todayEnd },
  };

  const include = {
    followUps: {
      orderBy: { followupDate: "desc" as const },
      take: 8,
      include: { createdBy: { select: { name: true } } },
    },
    payments: {
      orderBy: { paidAt: "desc" as const },
      take: 3,
      include: { createdBy: { select: { name: true } } },
    },
  };

  const [pendingCustomers, pendingTotal, doneCustomers, todayRecovery] = await prisma.$transaction([
    prisma.customer.findMany({
      where: pendingWhere,
      include,
      orderBy: [{ nextFollowupDate: "asc" }, { outstandingBalance: "desc" }],
      skip,
      take,
    }),
    prisma.customer.count({ where: pendingWhere }),
    prisma.customer.findMany({
      where: {
        shopId,
        followUps: {
          some: {
            actionLoggedAt: { gte: todayStart, lte: todayEnd },
            OR: [{ completedAt: { not: null } }, { status: { in: ["PAID", "COMPLETED", "WRONG_NUMBER"] } }],
          },
        },
      },
      include,
      orderBy: { lastFollowupDate: "desc" },
      take: 100,
    }),
    prisma.paymentEntry.aggregate({
      where: { shopId, paidAt: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
  ]);

  const pending = pendingCustomers.map((customer) => ({
    ...customer,
    queueRank: queuePriorityScore(
      customer.outstandingBalance,
      customer.nextFollowupDate,
      customer.followUps[0]?.priority
    ),
  }));

  const done = doneCustomers.map((customer) => {
    const todayAction = customer.followUps.find((followUp) => {
      const actionTime = new Date(followUp.actionLoggedAt);
      return actionTime >= todayStart && actionTime <= todayEnd;
    });
    return { ...customer, todayAction };
  });

  return NextResponse.json({
    pending,
    done,
    summary: {
      totalToday: pendingTotal + done.length,
      pending: pendingTotal,
      completed: done.length,
      recoveryToday: todayRecovery._sum.amount ?? 0,
      overdue: pending.filter((customer) => customer.nextFollowupDate && customer.nextFollowupDate < todayStart).length,
    },
    pagination: {
      skip,
      take,
      hasMore: skip + pending.length < pendingTotal,
    },
  });
}
