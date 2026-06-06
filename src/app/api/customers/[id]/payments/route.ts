import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { requireShopId } from "@/lib/tenant";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

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
    const shopId = requireShopId(request, session);
    const customer = await prisma.customer.findFirst({ where: { id, shopId } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const newBalance = Math.max(0, customer.outstandingBalance - body.amount);
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.paymentEntry.create({
        data: {
          shopId,
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

      const followUp = await recordFollowUpActivity(tx, {
        shopId,
        customerId: id,
        createdById: session.id,
        status: newBalance === 0 ? "PAID" : "PARTIAL_PAID",
        priority: "MEDIUM",
        notes: body.notes ?? `Payment recorded: ${body.amount}`,
        recoveryAmount: body.amount,
        paymentStatus: newBalance === 0 ? "PAID" : "PARTIAL_PAID",
        sourceModule: "CUSTOMER_MODULE",
        followUpType: "PAYMENT_COLLECTED",
        summary: `Payment recovered Rs ${body.amount}`,
        detailedNotes: body.notes,
        activitySource: "customer-payment",
        recordPayment: false,
        updateCustomerStatus: false,
      });

      return { payment, customer: updated, followUp: followUp.followUp };
    });

    await logActivity({
      action: "payment_recorded",
      shopId,
      userId: session.id,
      customerId: id,
      details: `Payment ${body.amount} recorded`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
