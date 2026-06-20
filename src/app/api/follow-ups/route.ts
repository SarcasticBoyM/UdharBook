import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity, type FollowUpSourceModule } from "@/lib/follow-up-service";
import { canUseFollowUps } from "@/lib/permissions";
import { notifyFollowUpCompleted, notifyTaskCompleted } from "@/lib/notifications";
import { normalizeTaskType, taskTypeLabels } from "@/lib/tasks";
import { isShopAdminRole, normalizeFixedRole } from "@/lib/operational-roles";
import { isOrderFollowUp } from "@/lib/follow-up-types";
import { cancelLinkedTaskFromFollowUp, syncLinkedTaskFromFollowUp } from "@/lib/task-follow-up-sync";
import { logger } from "@/lib/logger";

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
  sourceModule: z
    .enum(["TODAY_FOLLOWUPS", "CUSTOMER_MODULE", "FIELD_VISIT", "CHEQUE_COLLECTION", "CHEQUE_DEPOSIT", "ADMIN_MANUAL", "AUTO_REMINDER"])
    .optional(),
  followUpType: z.string().max(80).optional(),
  summary: z.string().max(300).optional(),
  detailedNotes: z.string().max(2000).optional(),
  paymentStatus: z.string().max(80).optional(),
  chequeStatus: z.string().max(80).optional(),
  promiseDate: z.string().datetime().optional().nullable(),
  activitySource: z.string().max(80).optional(),
  assignedToId: z.string().min(1).optional().nullable(),
  orderId: z.string().min(1).optional().nullable(),
  supersedesFollowUpId: z.string().min(1).optional().nullable(),
  metadata: z.unknown().optional(),
});

const cancelSchema = z.object({
  id: z.string().min(1),
  action: z.literal("CANCEL"),
});

type ScopedUserRow = {
  id: string;
  role: string;
  disabledAt: Date | null;
};

async function findScopedUser(userId: string, shopId: string) {
  const [user] = await prisma.$queryRaw<ScopedUserRow[]>(Prisma.sql`
    SELECT "id", "role"::text AS "role", "disabledAt"
    FROM "User"
    WHERE "id" = ${userId} AND "shopId" = ${shopId}
    LIMIT 1
  `);
  return user ?? null;
}

export async function POST(request: Request) {
  const routeStartedAt = performance.now();
  let transactionMs = 0;
  let notificationMs = 0;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseFollowUps(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = schema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, shopId, isArchived: false } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    const orderFollowUp = isOrderFollowUp(body.followUpType);
    const reminderAtValue = body.nextFollowUpDateTime ?? body.scheduledAt ?? body.nextFollowupDate;
    const reminderAt = reminderAtValue ? new Date(reminderAtValue) : null;
    if (orderFollowUp && (!reminderAt || Number.isNaN(reminderAt.getTime()))) {
      return NextResponse.json({ error: "Reminder date and time are required for an Order Follow-up." }, { status: 400 });
    }

    const assignedToId = body.assignedToId ?? session.id;
    if (body.assignedToId && body.assignedToId !== session.id && !isShopAdminRole(session.role) && session.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only a Shop Admin can assign a follow-up to another staff member." }, { status: 403 });
    }
    const assignedTo = await findScopedUser(assignedToId, shopId);
    if (!assignedTo || assignedTo.disabledAt) {
      return NextResponse.json({ error: "Select an active staff member from this shop." }, { status: 400 });
    }
    if (
      body.assignedToId &&
      !["SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"].includes(String(normalizeFixedRole(assignedTo.role)))
    ) {
      return NextResponse.json({ error: "Order follow-ups can only be assigned to operational staff." }, { status: 400 });
    }

    const linkedOrder = body.orderId
      ? await prisma.order.findFirst({
          where: { id: body.orderId, shopId, customerId: body.customerId },
          select: { id: true },
        })
      : null;
    if (body.orderId && !linkedOrder) {
      return NextResponse.json({ error: "The selected order does not belong to this customer and shop." }, { status: 400 });
    }

    const transactionStartedAt = performance.now();
    const result = await prisma.$transaction(async (tx) => {
      const recorded = await recordFollowUpActivity(tx, {
        shopId,
        customerId: body.customerId,
        createdById: session.id,
        assignedToId,
        orderId: linkedOrder?.id,
        supersedesFollowUpId: body.supersedesFollowUpId,
        status: body.status,
        priority: body.priority,
        notes: body.notes,
        reminderNotes: body.reminderNotes,
        customerResponse: body.customerResponse,
        manualReminder: body.manualReminder,
        reminderEnabled: body.reminderEnabled,
        nextFollowUpDateTime: body.nextFollowUpDateTime,
        scheduledAt: body.scheduledAt,
        nextFollowupDate: body.nextFollowupDate,
        recoveryAmount: body.paidAmount,
        sourceModule: (body.sourceModule ?? "TODAY_FOLLOWUPS") as FollowUpSourceModule,
        followUpType: body.followUpType ?? body.status,
        summary: body.summary ?? body.notes ?? body.customerResponse ?? `${body.status.replace(/_/g, " ").toLowerCase()} for ${customer.partyName}`,
        detailedNotes: body.detailedNotes ?? body.notes,
        paymentStatus: body.paymentStatus ?? (body.status === "PAID" ? "PAID" : body.status === "PARTIAL_PAID" ? "PARTIAL_PAID" : null),
        chequeStatus: body.chequeStatus,
        promiseDate: body.promiseDate,
        activitySource: body.activitySource ?? (body.sourceModule === "CUSTOMER_MODULE" ? "customer-quick-follow-up" : "today-follow-ups"),
        metadata: body.metadata as Prisma.InputJsonValue | undefined,
        recordPayment: body.status === "PAID" || body.status === "PARTIAL_PAID",
        paymentMethod: body.status === "PAID" ? "Full recovery" : "Partial recovery",
        updateCustomerFollowup: !orderFollowUp,
        updateCustomerStatus: !orderFollowUp,
        updateCustomerNotes: !orderFollowUp,
        incrementCallCount: !orderFollowUp,
      });
      const linkedTask = await syncLinkedTaskFromFollowUp(tx, {
        previousFollowUpId: body.supersedesFollowUpId,
        followUpId: recorded.followUp.id,
        shopId,
        status: body.status,
        reminderAt,
        notes: body.detailedNotes ?? body.notes ?? body.customerResponse,
      });
      return { ...recorded, linkedTask };
    });
    transactionMs = Math.round(performance.now() - transactionStartedAt);

    await logActivity({
      action: "follow_up_created",
      userId: session.id,
      shopId,
      customerId: body.customerId,
      details: `${body.status} ${result.followUp.nextFollowupDate?.toISOString() ?? ""}`.trim(),
    });

    const notificationStartedAt = performance.now();
    const notification = body.status === "COMPLETED"
      ? await notifyFollowUpCompleted({
        shopId,
        followUpId: result.followUp.id,
        customerId: body.customerId,
        customerName: customer.partyName,
        completedByName: session.name,
      })
      : undefined;
    const taskNotification = result.linkedTask && result.linkedTask.status === "COMPLETED"
      ? await notifyTaskCompleted({
          shopId,
          taskId: result.linkedTask.id,
          assignedById: result.linkedTask.assignedById,
          taskTypeLabel: (() => {
            const normalized = normalizeTaskType(result.linkedTask.taskType);
            return normalized ? taskTypeLabels[normalized] : result.linkedTask.title;
          })(),
          customerName: customer.partyName,
          completedByName: session.name,
        })
      : undefined;
    notificationMs = Math.round(performance.now() - notificationStartedAt);

    if (process.env.NODE_ENV === "development") {
      logger.info("api_followups_post_timing", {
        route: "/api/follow-ups",
        durationMs: Math.round(performance.now() - routeStartedAt),
        transactionMs,
        notificationMs,
        shopPresent: Boolean(shopId),
        status: body.status,
        sourceModule: body.sourceModule ?? "TODAY_FOLLOWUPS",
        hasLinkedTask: Boolean(result.linkedTask),
      });
    }

    return NextResponse.json({
      ...result,
      success: true,
      data: result,
      ...(notification ? { notification } : {}),
      ...(taskNotification ? { taskNotification } : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: "Invalid follow-up details.",
        details: error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`),
      }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Invalid request";
    const status = message === "FOLLOW_UP_TO_SUPERSEDE_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({
      error: message === "FOLLOW_UP_TO_SUPERSEDE_NOT_FOUND"
        ? "The scheduled follow-up is no longer available."
        : "Could not save the follow-up.",
    }, { status });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseFollowUps(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = cancelSchema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const followUp = await prisma.followUp.findFirst({
      where: { id: body.id, shopId },
      select: { id: true, assignedToId: true, createdById: true, cancelledAt: true, completedAt: true },
    });
    if (!followUp) return NextResponse.json({ error: "Follow-up not found." }, { status: 404 });
    const canCancel =
      isShopAdminRole(session.role) ||
      session.role === "SUPER_ADMIN" ||
      followUp.assignedToId === session.id ||
      followUp.createdById === session.id;
    if (!canCancel) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (followUp.completedAt) return NextResponse.json({ error: "A completed follow-up cannot be cancelled." }, { status: 409 });

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.followUp.update({
        where: { id: followUp.id },
        data: {
          cancelledAt: followUp.cancelledAt ?? new Date(),
          reminderEnabled: false,
        },
      });
      await cancelLinkedTaskFromFollowUp(tx, { followUpId: followUp.id, shopId });
      return cancelled;
    });
    return NextResponse.json({ success: true, followUp: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid cancellation request." }, { status: 400 });
    return NextResponse.json({ error: "Could not cancel the follow-up." }, { status: 500 });
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
  const now = new Date();

  let where: Record<string, unknown> = {
    shopId,
    isArchived: false,
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
      nextFollowupDate: { lt: now },
    };
  }

  if (view === "calendar") {
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : todayStart;
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : todayEnd;
    const followUps = await prisma.followUp.findMany({
      where: {
        shopId,
        scheduledAt: { gte: from, lte: to },
        customer: { isArchived: false },
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
