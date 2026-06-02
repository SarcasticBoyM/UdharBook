import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

const schema = z.object({
  customerId: z.string(),
  status: z.enum(["CONTACTED", "PAYMENT_PROMISED", "PAID", "NOT_REACHABLE", "PENDING"]),
  notes: z.string().optional(),
  nextFollowupDate: z.string().datetime().optional().nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = schema.parse(await request.json());
    const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const nextDate = body.nextFollowupDate ? new Date(body.nextFollowupDate) : null;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const followUp = await tx.followUp.create({
        data: {
          customerId: body.customerId,
          status: body.status,
          notes: body.notes,
          nextFollowupDate: nextDate,
          createdById: session.id,
        },
      });

      if (customer.status !== body.status) {
        await tx.statusHistory.create({
          data: {
            customerId: body.customerId,
            fromStatus: customer.status,
            toStatus: body.status,
            notes: body.notes,
            changedById: session.id,
          },
        });
      }

      const updated = await tx.customer.update({
        where: { id: body.customerId },
        data: {
          status: body.status,
          notes: body.notes ?? customer.notes,
          lastFollowupDate: now,
          nextFollowupDate: nextDate,
          totalCallsMade: { increment: 1 },
          outstandingBalance: body.status === "PAID" ? 0 : customer.outstandingBalance,
        },
      });

      return { followUp, customer: updated };
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  let where: Record<string, unknown> = {
    outstandingBalance: { gt: 0 },
    NOT: { status: "PAID" },
  };
  if (filter === "today") {
    where = {
      ...where,
      nextFollowupDate: { gte: todayStart, lte: todayEnd },
    };
  } else if (filter === "overdue") {
    where = {
      ...where,
      nextFollowupDate: { lt: todayStart },
    };
  }

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { nextFollowupDate: "asc" },
  });

  return NextResponse.json(customers);
}
