import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  amount: z.number().positive(),
  paidAt: z.string().datetime().optional(),
  method: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = schema.parse(await request.json());
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const newBalance = Math.max(0, customer.outstandingBalance - body.amount);
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentEntry.create({
        data: {
          customerId: id,
          amount: body.amount,
          paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
          method: body.method,
          notes: body.notes,
          createdById: session.id,
        },
      });

      const updated = await tx.customer.update({
        where: { id },
        data: {
          outstandingBalance: newBalance,
          status: newBalance === 0 ? "CLEARED" : customer.status === "PENDING" ? "ACTIVE" : customer.status,
        },
      });

      if (updated.status !== customer.status) {
        await tx.statusHistory.create({
          data: {
            customerId: id,
            fromStatus: customer.status,
            toStatus: updated.status,
            notes: `Payment recorded: ${body.amount}`,
            changedById: session.id,
          },
        });
      }

      return { payment, customer: updated };
    });

    await logActivity({
      action: "payment_recorded",
      userId: session.id,
      customerId: id,
      details: `Payment ${body.amount} recorded`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

