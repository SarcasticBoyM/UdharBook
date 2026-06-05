import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  customerId: z.string(),
  status: z.enum([
    "CALLBACK",
    "FOLLOW_UP_REQUIRED",
    "CONTACTED",
    "PAYMENT_PROMISED",
    "PARTIAL_PAID",
    "PAID",
    "NOT_REACHABLE",
    "WRONG_NUMBER",
    "PENDING",
    "COMPLETED",
    "MISSED",
    "RESCHEDULED",
  ]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  notes: z.string().optional(),
  reminderNotes: z.string().optional(),
  customerResponse: z.string().optional(),
  manualReminder: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
  nextFollowUpDateTime: z.string().datetime().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
  paidAmount: z.number().min(0).optional(),
});

function customerStatusFromFollowUp(status: z.infer<typeof schema>["status"], balance: number) {
  if (status === "PAID" || balance === 0) return "CLEARED";
  if (status === "COMPLETED") return balance === 0 ? "CLEARED" : "ACTIVE";
  if (status === "MISSED") return "HIGH_RISK";
  if (status === "RESCHEDULED" || status === "CALLBACK" || status === "FOLLOW_UP_REQUIRED") return "PENDING";
  if (status === "NOT_REACHABLE" || status === "WRONG_NUMBER") return "HIGH_RISK";
  if (status === "CONTACTED" || status === "PAYMENT_PROMISED" || status === "PARTIAL_PAID") return "ACTIVE";
  return "PENDING";
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = schema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, shopId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const requestedReminderAt = body.nextFollowUpDateTime ?? body.scheduledAt ?? body.nextFollowupDate;
    const reminderDateTime = requestedReminderAt ? new Date(requestedReminderAt) : null;
    const reminderStatusAllowed = body.status === "CALLBACK" || body.status === "FOLLOW_UP_REQUIRED";
    const reminderEnabled = Boolean(body.manualReminder && body.reminderEnabled !== false && reminderDateTime && reminderStatusAllowed);
    const scheduledAt = reminderEnabled ? reminderDateTime : null;
    const nextDate = body.nextFollowupDate ? new Date(body.nextFollowupDate) : scheduledAt;
    const now = new Date();
    const isCompleteAction = body.status === "COMPLETED" || body.status === "PAID";
    const isRescheduledAction = body.status === "RESCHEDULED";
    const paidAmount =
      body.status === "PAID"
        ? customer.outstandingBalance
        : body.status === "PARTIAL_PAID"
          ? Math.min(body.paidAmount ?? 0, customer.outstandingBalance)
          : 0;
    const newBalance = body.status === "PAID" ? 0 : Math.max(0, customer.outstandingBalance - paidAmount);

    const result = await prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.create({
        data: {
          shopId,
          customerId: body.customerId,
          status: body.status,
          priority: body.priority,
          notes: body.notes,
          reminderNotes: body.reminderNotes,
          customerResponse: body.customerResponse,
          manualReminder: reminderEnabled,
          reminderEnabled,
          nextFollowUpDateTime: reminderEnabled ? reminderDateTime : null,
          scheduledAt,
          completedAt: isCompleteAction ? now : null,
          rescheduledAt: isRescheduledAction ? now : null,
          actionLoggedAt: now,
          nextFollowupDate: nextDate,
          createdById: session.id,
        },
      });

      if (paidAmount > 0) {
        await tx.paymentEntry.create({
          data: {
            shopId,
            customerId: body.customerId,
            amount: paidAmount,
            method: body.status === "PAID" ? "Full recovery" : "Partial recovery",
            notes: body.notes,
            paidAt: now,
            createdById: session.id,
          },
        });
      }

      const nextCustomerStatus = customerStatusFromFollowUp(body.status, newBalance);

      if (customer.status !== nextCustomerStatus) {
        await tx.statusHistory.create({
          data: {
            customerId: body.customerId,
            fromStatus: customer.status,
            toStatus: nextCustomerStatus,
            notes: body.notes,
            changedById: session.id,
          },
        });
      }

      const updated = await tx.customer.update({
        where: { id: body.customerId },
        data: {
          status: nextCustomerStatus,
          notes: body.notes ?? customer.notes,
          lastFollowupDate: now,
          nextFollowupDate: nextDate,
          totalCallsMade: { increment: 1 },
          outstandingBalance: newBalance,
        },
      });

      return { followUp, customer: updated };
    });

    await logActivity({
      action: "follow_up_created",
      userId: session.id,
      shopId,
      customerId: body.customerId,
      details: `${body.status} ${nextDate?.toISOString() ?? ""}`.trim(),
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter");
  const view = searchParams.get("view") ?? "customers";
  const skip = Number(searchParams.get("skip") ?? 0);
  const take = Math.min(Number(searchParams.get("take") ?? 30), 100);
  const shopId = requireShopId(request, session);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  let where: Record<string, unknown> = {
    shopId,
    outstandingBalance: { gt: 0 },
    NOT: { status: "CLEARED" },
  };
  if (filter === "today") {
    where = {
      ...where,
      nextFollowupDate: { lte: todayEnd },
    };
  } else if (filter === "overdue") {
    where = {
      ...where,
      nextFollowupDate: { lt: todayStart },
    };
  }

  if (view === "calendar") {
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : todayStart;
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : todayEnd;
    const followUps = await prisma.followUp.findMany({
      where: {
        shopId,
        scheduledAt: { gte: from, lte: to },
      },
      include: { customer: true, createdBy: { select: { name: true } } },
      orderBy: { scheduledAt: "asc" },
    });
    return NextResponse.json(followUps);
  }

  const [customers, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      include: {
        followUps: {
          orderBy: { followupDate: "desc" },
          take: 8,
          include: { createdBy: { select: { name: true } } },
        },
        payments: {
          orderBy: { paidAt: "desc" },
          take: 1,
          include: { createdBy: { select: { name: true } } },
        },
      },
      orderBy: [{ nextFollowupDate: "asc" }, { outstandingBalance: "desc" }],
      skip,
      take,
    }),
    prisma.customer.count({ where }),
  ]);

  return NextResponse.json({ customers, total, skip, take, hasMore: skip + customers.length < total });
}
