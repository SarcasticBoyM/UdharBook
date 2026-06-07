import { NextResponse } from "next/server";
import type { FollowUpPriority, FollowUpStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";

const HIGH_AMOUNT = Number(process.env.HIGH_BALANCE_THRESHOLD ?? 50000);
const RECENT_CONTACT_HOURS = 6;
const AUTO_QUEUE_NOTE = "Auto-created for daily recovery queue.";
const SCHEDULED_STATUSES: FollowUpStatus[] = ["CALLBACK", "FOLLOW_UP_REQUIRED", "PAYMENT_PROMISED", "RESCHEDULED"];
const CLOSED_STATUSES: FollowUpStatus[] = ["PAID", "COMPLETED", "WRONG_NUMBER"];

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

function daysSince(date: Date | null | undefined) {
  if (!date) return 9999;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function daysOverdue(date: Date | null | undefined) {
  if (!date) return 0;
  return Math.max(0, Math.ceil((Date.now() - date.getTime()) / 86400000));
}

function isPastDue(date: Date | null | undefined, now = new Date()) {
  return Boolean(date && date.getTime() < now.getTime());
}

function smartPriority(customer: {
  outstandingBalance: number;
  nextFollowupDate: Date | null;
  lastFollowupDate: Date | null;
  payments: { paidAt: Date }[];
  followUps: { status: FollowUpStatus; priority: FollowUpPriority }[];
}): FollowUpPriority {
  const overdue = daysOverdue(customer.nextFollowupDate);
  const followupAge = daysSince(customer.lastFollowupDate);
  const noPaymentAge = daysSince(customer.payments[0]?.paidAt);
  const latest = customer.followUps[0];

  if (
    latest?.priority === "URGENT" ||
    overdue >= 7 ||
    (overdue >= 3 && customer.outstandingBalance >= HIGH_AMOUNT) ||
    (customer.outstandingBalance >= HIGH_AMOUNT * 2 && followupAge >= 3)
  ) {
    return "URGENT";
  }
  if (
    latest?.priority === "HIGH" ||
    overdue >= 2 ||
    customer.outstandingBalance >= HIGH_AMOUNT ||
    followupAge >= 7 ||
    noPaymentAge >= 30
  ) {
    return "HIGH";
  }
  if (overdue >= 1 || followupAge >= 3 || customer.nextFollowupDate) return "MEDIUM";
  return "LOW";
}

function priorityRank(priority: FollowUpPriority) {
  return { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[priority];
}

function priorityLabel(priority: FollowUpPriority) {
  return priority === "URGENT" ? "Critical" : priority[0] + priority.slice(1).toLowerCase();
}

function scheduledDateFor(followUp: {
  nextFollowUpDateTime: Date | null;
  nextFollowupDate: Date | null;
  scheduledAt: Date | null;
}) {
  return followUp.nextFollowUpDateTime ?? followUp.nextFollowupDate ?? followUp.scheduledAt;
}

function isExplicitlyScheduled(followUp: {
  status: FollowUpStatus;
  notes: string | null;
  manualReminder: boolean;
  reminderEnabled: boolean;
  nextFollowUpDateTime: Date | null;
  nextFollowupDate: Date | null;
  scheduledAt: Date | null;
}) {
  if (!scheduledDateFor(followUp)) return false;
  if (CLOSED_STATUSES.includes(followUp.status)) return false;
  if (followUp.status === "PENDING" && followUp.notes === AUTO_QUEUE_NOTE) return false;
  return (
    followUp.manualReminder ||
    followUp.reminderEnabled ||
    Boolean(followUp.nextFollowUpDateTime) ||
    SCHEDULED_STATUSES.includes(followUp.status)
  );
}

function queueScore(customer: QueueCustomer) {
  const overdue = daysOverdue(customer.nextFollowupDate);
  const followupAge = daysSince(customer.lastFollowupDate);
  const latestStatus = customer.followUps[0]?.status;
  const recentlyContacted =
    customer.lastFollowupDate &&
    Date.now() - customer.lastFollowupDate.getTime() < RECENT_CONTACT_HOURS * 60 * 60 * 1000;

  return (
    overdue * 100000 +
    priorityRank(customer.smartPriority) * 20000 +
    Math.min(customer.outstandingBalance, 1000000) +
    followupAge * 100 -
    (recentlyContacted ? 200000 : 0) -
    (latestStatus === "PAYMENT_PROMISED" ? 50000 : 0)
  );
}

type QueueCustomer = Prisma.CustomerGetPayload<{
  include: {
    followUps: { include: { createdBy: { select: { name: true } } } };
    payments: { include: { createdBy: { select: { name: true } } } };
  };
}> & {
  smartPriority: FollowUpPriority;
  smartPriorityLabel: string;
  queueScore: number;
  section: "urgent" | "today" | "recent";
};

type ScheduledFollowUp = QueueCustomer & {
  scheduledFollowUp: {
    id: string;
    scheduledAt: Date;
    followUpType: FollowUpStatus;
    notes: string | null;
    reminderNotes: string | null;
    customerResponse: string | null;
    assignedTo: string;
    reminderEnabled: boolean;
    manualReminder: boolean;
    promiseToPay: boolean;
    overdue: boolean;
  };
};

type SortKey =
  | "amount_desc"
  | "amount_asc"
  | "overdue_desc"
  | "oldest_followup"
  | "newest_followup"
  | "last_contacted"
  | "never_contacted"
  | "priority_desc"
  | "priority_asc"
  | "az"
  | "za";

function compareBy(sort: SortKey, a: QueueCustomer, b: QueueCustomer) {
  const time = (value: Date | null) => value?.getTime() ?? 0;
  switch (sort) {
    case "amount_desc":
      return b.outstandingBalance - a.outstandingBalance;
    case "amount_asc":
      return a.outstandingBalance - b.outstandingBalance;
    case "overdue_desc":
      return daysOverdue(b.nextFollowupDate) - daysOverdue(a.nextFollowupDate);
    case "oldest_followup":
      return time(a.lastFollowupDate) - time(b.lastFollowupDate);
    case "newest_followup":
    case "last_contacted":
      return time(b.lastFollowupDate) - time(a.lastFollowupDate);
    case "never_contacted":
      return Number(Boolean(a.lastFollowupDate)) - Number(Boolean(b.lastFollowupDate));
    case "priority_desc":
      return priorityRank(b.smartPriority) - priorityRank(a.smartPriority);
    case "priority_asc":
      return priorityRank(a.smartPriority) - priorityRank(b.smartPriority);
    case "az":
      return a.partyName.localeCompare(b.partyName);
    case "za":
      return b.partyName.localeCompare(a.partyName);
    default:
      return b.queueScore - a.queueScore;
  }
}

function matchesFilter(filter: string, customer: QueueCustomer, todayStart: Date, todayEnd: Date) {
  const latest = customer.followUps[0];
  const overdue = isPastDue(customer.nextFollowupDate);
  const dueToday = customer.nextFollowupDate
    ? customer.nextFollowupDate >= todayStart && customer.nextFollowupDate <= todayEnd
    : false;
  if (filter === "overdue") return overdue;
  if (filter === "today") return dueToday;
  if (filter === "high_amount") return customer.outstandingBalance >= HIGH_AMOUNT;
  if (filter === "no_followup") return customer.followUps.length <= 1 && !customer.lastFollowupDate;
  if (filter === "pending") return customer.outstandingBalance > 0;
  if (filter === "promise") return latest?.status === "PAYMENT_PROMISED";
  if (filter === "not_answering") return latest?.status === "NOT_REACHABLE";
  if (filter === "urgent") return customer.smartPriority === "URGENT";
  return true;
}

function databaseFilter(filter: string, todayStart: Date, todayEnd: Date): Prisma.CustomerWhereInput {
  if (filter === "overdue") return { nextFollowupDate: { lt: new Date() } };
  if (filter === "today") return { nextFollowupDate: { gte: todayStart, lte: todayEnd } };
  if (filter === "high_amount") return { outstandingBalance: { gte: HIGH_AMOUNT } };
  if (filter === "no_followup") return { followUps: { none: {} }, lastFollowupDate: null };
  if (filter === "promise") return { followUps: { some: { status: "PAYMENT_PROMISED" } } };
  if (filter === "not_answering") return { followUps: { some: { status: "NOT_REACHABLE" } } };
  if (filter === "urgent") {
    return {
      OR: [
        { status: "HIGH_RISK" },
        { nextFollowupDate: { lt: new Date() } },
        { outstandingBalance: { gte: HIGH_AMOUNT } },
        { followUps: { some: { priority: "URGENT" } } },
      ],
    };
  }
  return {};
}

function databaseSearch(search: string): Prisma.CustomerWhereInput {
  if (!search) return {};
  const amount = Number(search.replace(/,/g, ""));
  return {
    OR: [
      { partyName: { contains: search, mode: "insensitive" } },
      { contactNumber: { contains: search.replace(/\D/g, "") || search } },
      { notes: { contains: search, mode: "insensitive" } },
      ...(Number.isFinite(amount) ? [{ outstandingBalance: amount }] : []),
      { followUps: { some: { notes: { contains: search, mode: "insensitive" } } } },
      { followUps: { some: { customerResponse: { contains: search, mode: "insensitive" } } } },
    ],
  };
}

function databaseOrder(sort: SortKey): Prisma.CustomerOrderByWithRelationInput[] {
  switch (sort) {
    case "amount_desc":
      return [{ outstandingBalance: "desc" }, { nextFollowupDate: "asc" }];
    case "amount_asc":
      return [{ outstandingBalance: "asc" }, { nextFollowupDate: "asc" }];
    case "overdue_desc":
    case "oldest_followup":
      return [{ nextFollowupDate: "asc" }, { outstandingBalance: "desc" }];
    case "newest_followup":
    case "last_contacted":
      return [{ lastFollowupDate: "desc" }, { outstandingBalance: "desc" }];
    case "never_contacted":
      return [{ lastFollowupDate: "asc" }, { outstandingBalance: "desc" }];
    case "az":
      return [{ partyName: "asc" }];
    case "za":
      return [{ partyName: "desc" }];
    default:
      return [{ nextFollowupDate: "asc" }, { outstandingBalance: "desc" }];
  }
}

async function seedMissingFollowUps(shopId: string, userId: string) {
  const today = new Date();
  const missing = await prisma.customer.findMany({
    where: {
      shopId,
      outstandingBalance: { gt: 0 },
      followUps: { none: {} },
    },
    include: {
      followUps: { orderBy: { followupDate: "desc" }, take: 1 },
      payments: { orderBy: { paidAt: "desc" }, take: 1 },
    },
  });

  if (missing.length === 0) return 0;

  await prisma.$transaction(
    missing.flatMap((customer) => {
      const priority = smartPriority(customer);
      return [
        prisma.followUp.create({
          data: {
            shopId,
            customerId: customer.id,
            status: "PENDING",
            priority,
            notes: "Auto-created for daily recovery queue.",
            sourceModule: "AUTO_REMINDER",
            followUpType: "DAILY_QUEUE",
            summary: "Auto-created for daily recovery queue.",
            activitySource: "daily-queue-seed",
            scheduledAt: today,
            nextFollowupDate: today,
            actionLoggedAt: today,
            queueRank: priorityRank(priority),
            createdById: userId,
          },
        }),
        prisma.customer.update({
          where: { id: customer.id },
          data: { nextFollowupDate: customer.nextFollowupDate ?? today },
        }),
      ];
    })
  );

  return missing.length;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const skip = Number(searchParams.get("skip") ?? 0);
  const take = Math.min(Number(searchParams.get("take") ?? 30), 100);
  const sort = (searchParams.get("sort") ?? "priority_desc") as SortKey;
  const filter = searchParams.get("filter") ?? "all";
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();
  const shopId = requireShopId(request, session);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();

  const autoCreated = await seedMissingFollowUps(shopId, session.id);

  const include = {
    followUps: {
      orderBy: { followupDate: "desc" as const },
      take: 12,
      include: { createdBy: { select: { name: true } } },
    },
    payments: {
      orderBy: { paidAt: "desc" as const },
      take: 3,
      include: { createdBy: { select: { name: true } } },
    },
  };

  const realActionTodayWhere: Prisma.FollowUpWhereInput = {
    status: { not: "PENDING" },
    OR: [
      { followupDate: { gte: todayStart, lte: todayEnd } },
      { completedAt: { gte: todayStart, lte: todayEnd } },
      { rescheduledAt: { gte: todayStart, lte: todayEnd } },
    ],
  };

  const pendingWhere: Prisma.CustomerWhereInput = {
    AND: [
      { shopId, outstandingBalance: { gt: 0 } },
      databaseFilter(filter, todayStart, todayEnd),
      databaseSearch(search),
    ],
  };
  const pageWindow = skip + Math.min(take * 3, 300);

  const [customers, pendingTotal, pendingAmount, doneCustomers, todayRecovery, staffActivity, overdueCount] = await prisma.$transaction([
    prisma.customer.findMany({
      where: pendingWhere,
      include,
      orderBy: databaseOrder(sort),
      take: pageWindow,
    }),
    prisma.customer.count({ where: pendingWhere }),
    prisma.customer.aggregate({ where: pendingWhere, _sum: { outstandingBalance: true } }),
    prisma.customer.findMany({
      where: {
        shopId,
        ...databaseSearch(search),
        followUps: {
          some: realActionTodayWhere,
        },
      },
      include,
      orderBy: { lastFollowupDate: "desc" },
      take: 200,
    }),
    prisma.paymentEntry.aggregate({
      where: { shopId, paidAt: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.followUp.groupBy({
      by: ["createdById"],
      where: { shopId, ...realActionTodayWhere },
      orderBy: { createdById: "asc" },
      _count: { _all: true },
    }),
    prisma.customer.count({ where: { shopId, outstandingBalance: { gt: 0 }, nextFollowupDate: { lt: new Date() } } }),
  ]);

  const scheduledRows = await prisma.followUp.findMany({
    where: {
      shopId,
      status: { notIn: CLOSED_STATUSES },
      customer: { outstandingBalance: { gt: 0 } },
      OR: [
        { manualReminder: true },
        { reminderEnabled: true },
        { nextFollowUpDateTime: { not: null } },
        { status: { in: SCHEDULED_STATUSES }, nextFollowupDate: { not: null } },
      ],
    },
    include: {
      createdBy: { select: { name: true } },
      customer: { include },
    },
    orderBy: [{ nextFollowUpDateTime: "asc" }, { nextFollowupDate: "asc" }, { scheduledAt: "asc" }, { followupDate: "desc" }],
    take: 300,
  });

  const scheduledByCustomer = new Map<string, ScheduledFollowUp>();
  for (const row of scheduledRows) {
    if (!isExplicitlyScheduled(row)) continue;
    const scheduledAt = scheduledDateFor(row);
    if (!scheduledAt) continue;
    const smart = smartPriority(row.customer);
    const candidate: ScheduledFollowUp = {
      ...row.customer,
      smartPriority: smart,
      smartPriorityLabel: priorityLabel(smart),
      queueScore: 0,
      section: "today",
      scheduledFollowUp: {
        id: row.id,
        scheduledAt,
        followUpType: row.status,
        notes: row.notes,
        reminderNotes: row.reminderNotes,
        customerResponse: row.customerResponse,
        assignedTo: row.createdBy.name,
        reminderEnabled: row.reminderEnabled,
        manualReminder: row.manualReminder,
        promiseToPay: row.status === "PAYMENT_PROMISED",
        overdue: isPastDue(scheduledAt),
      },
    };
    candidate.queueScore = queueScore(candidate);
    const existing = scheduledByCustomer.get(row.customerId);
    if (!existing) {
      scheduledByCustomer.set(row.customerId, candidate);
      continue;
    }
    const now = Date.now();
    const existingAt = existing.scheduledFollowUp.scheduledAt.getTime();
    const candidateAt = candidate.scheduledFollowUp.scheduledAt.getTime();
    if ((candidateAt < now && existingAt >= now) || Math.abs(candidateAt - now) < Math.abs(existingAt - now)) {
      scheduledByCustomer.set(row.customerId, candidate);
    }
  }

  const scheduled = Array.from(scheduledByCustomer.values()).sort((a, b) => {
    const now = Date.now();
    const aTime = a.scheduledFollowUp.scheduledAt.getTime();
    const bTime = b.scheduledFollowUp.scheduledAt.getTime();
    const aOverdue = aTime < now;
    const bOverdue = bTime < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return aTime - bTime;
  });
  const scheduledIds = new Set(scheduled.map((customer) => customer.id));

  const doneIds = new Set(doneCustomers.map((customer) => customer.id));
  const enriched = customers.map((customer) => {
    const smart = smartPriority(customer);
    const recentlyContacted =
      customer.lastFollowupDate &&
      Date.now() - customer.lastFollowupDate.getTime() < RECENT_CONTACT_HOURS * 60 * 60 * 1000;
    const section =
      smart === "URGENT" || daysOverdue(customer.nextFollowupDate) > 0
        ? "urgent"
        : recentlyContacted
          ? "recent"
          : "today";
    const item = {
      ...customer,
      smartPriority: smart,
      smartPriorityLabel: priorityLabel(smart),
      queueScore: 0,
      section,
    } satisfies QueueCustomer;
    item.queueScore = queueScore(item);
    return item;
  });

  const pendingPool = enriched.filter((customer) => !doneIds.has(customer.id) && !scheduledIds.has(customer.id));
  const filteredPool =
    filter === "done" ? [] : pendingPool.filter((customer) => matchesFilter(filter, customer, todayStart, todayEnd));
  const sorted = filteredPool.sort((a, b) => compareBy(sort, a, b) || b.queueScore - a.queueScore);
  const pending = sorted.slice(skip, skip + take);

  const done = doneCustomers.map((customer) => {
    const smart = smartPriority(customer);
    const todayAction = customer.followUps.find((followUp) => {
      const followupDate = new Date(followUp.followupDate);
      const completedAt = followUp.completedAt ? new Date(followUp.completedAt) : null;
      const rescheduledAt = followUp.rescheduledAt ? new Date(followUp.rescheduledAt) : null;
      return (
        followUp.status !== "PENDING" &&
        ((followupDate >= todayStart && followupDate <= todayEnd) ||
          (completedAt !== null && completedAt >= todayStart && completedAt <= todayEnd) ||
          (rescheduledAt !== null && rescheduledAt >= todayStart && rescheduledAt <= todayEnd))
      );
    });
    return {
      ...customer,
      todayAction,
      smartPriority: smart,
      smartPriorityLabel: priorityLabel(smart),
      queueScore: 0,
      section: "recent" as const,
    };
  });

  const userIds = staffActivity.map((item) => item.createdById);
  const users = await prisma.user.findMany({
    where: { shopId, id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((user) => [user.id, user.name]));
  const callsCompleted = done.reduce((count, customer) => {
    const action = customer.todayAction;
    return action?.status === "CONTACTED" || action?.status === "PAYMENT_PROMISED" ? count + 1 : count;
  }, 0);

  return NextResponse.json({
    scheduled,
    pending,
    done,
    summary: {
      totalCustomers: enriched.length,
      totalPendingCustomers: pendingTotal,
      totalPendingAmount: pendingAmount._sum.outstandingBalance ?? 0,
      totalToday: pendingTotal + done.length,
      pending: pendingTotal,
      completed: done.length,
      actionedToday: done.length,
      callsCompleted,
      recoveryToday: todayRecovery._sum.amount ?? 0,
      overdue: overdueCount,
      scheduled: scheduled.length,
      scheduledOverdue: scheduled.filter((customer) => customer.scheduledFollowUp.overdue).length,
      autoCreated,
      staffPerformance: staffActivity.map((item) => ({
        staffId: item.createdById,
        name: userMap.get(item.createdById) ?? "Staff",
        actions: typeof item._count === "object" ? item._count._all ?? 0 : 0,
      })),
    },
    sections: {
      urgent: filteredPool.filter((customer) => customer.section === "urgent").length,
      today: filteredPool.filter((customer) => customer.section === "today").length,
      recent: filteredPool.filter((customer) => customer.section === "recent").length,
      done: done.length,
    },
    pagination: {
      skip,
      take,
      total: pendingTotal,
      hasMore: skip + pending.length < pendingTotal,
    },
  });
}
