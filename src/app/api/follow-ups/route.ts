import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

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

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = schema.parse(await request.json());
    const shopId = requireShopId(request, session);
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, shopId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      return recordFollowUpActivity(tx, {
        shopId,
        customerId: body.customerId,
        createdById: session.id,
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
        paymentStatus: body.status === "PAID" ? "PAID" : body.status === "PARTIAL_PAID" ? "PARTIAL_PAID" : null,
        sourceModule: "TODAY_FOLLOWUPS",
        followUpType: body.status,
        summary: body.notes ?? body.customerResponse ?? `${body.status.replace(/_/g, " ").toLowerCase()} for ${customer.partyName}`,
        detailedNotes: body.notes,
        activitySource: "today-follow-ups",
        recordPayment: body.status === "PAID" || body.status === "PARTIAL_PAID",
        paymentMethod: body.status === "PAID" ? "Full recovery" : "Partial recovery",
      });
    });

    await logActivity({
      action: "follow_up_created",
      userId: session.id,
      shopId,
      customerId: body.customerId,
      details: `${body.status} ${result.followUp.nextFollowupDate?.toISOString() ?? ""}`.trim(),
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
