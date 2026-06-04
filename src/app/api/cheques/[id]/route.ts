import { NextResponse } from "next/server";
import { z } from "zod";
import type { ChequeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

const updateSchema = z.object({
  status: z.enum(["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "CANCELLED"]),
  notes: z.string().optional(),
  depositDateTime: z.string().datetime().optional().nullable(),
  depositedAccountId: z.string().optional(),
  depositBankAccount: z.string().optional(),
  depositSlipUrl: z.string().optional(),
  bounceReason: z.string().optional(),
});

function activityType(status: ChequeStatus) {
  if (status === "DEPOSITED") return "DEPOSITED";
  if (status === "CLEARED") return "CLEARED";
  if (status === "BOUNCED") return "BOUNCED";
  if (status === "REPLACED") return "REPLACED";
  if (status === "CANCELLED") return "CANCELLED";
  return "STATUS_CHANGED";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const body = updateSchema.parse(await request.json());
  const existing = await prisma.cheque.findFirst({
    where: { id, shopId },
    include: { customer: true },
  });
  if (!existing) return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
  const requiresDepositAccount = ["DEPOSITED", "CLEARED"].includes(body.status);
  if (requiresDepositAccount && !body.depositedAccountId && !existing.depositedAccountId) {
    return NextResponse.json({ error: "Deposit account is required" }, { status: 400 });
  }
  const depositAccount = body.depositedAccountId
    ? await prisma.chequeDepositAccount.findFirst({
        where: { id: body.depositedAccountId, shopId, isActive: true },
      })
    : null;
  if (body.depositedAccountId && !depositAccount) {
    return NextResponse.json({ error: "Deposit account not found" }, { status: 404 });
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const cheque = await tx.cheque.update({
      where: { id },
      data: {
        status: body.status,
        depositDateTime:
          ["DEPOSITED", "CLEARED"].includes(body.status)
            ? body.depositDateTime
              ? new Date(body.depositDateTime)
              : existing.depositDateTime ?? now
            : body.depositDateTime
              ? new Date(body.depositDateTime)
              : existing.depositDateTime,
        depositBankAccount: body.depositBankAccount ?? existing.depositBankAccount,
        depositedAccountId: body.depositedAccountId ?? existing.depositedAccountId,
        depositSlipUrl: body.depositSlipUrl ?? existing.depositSlipUrl,
        depositedById: ["DEPOSITED", "CLEARED"].includes(body.status) ? session.id : existing.depositedById,
        bounceReason: body.status === "BOUNCED" ? body.bounceReason ?? body.notes : existing.bounceReason,
        bouncedAt: body.status === "BOUNCED" ? now : existing.bouncedAt,
        clearedAt: body.status === "CLEARED" ? now : existing.clearedAt,
        cancelledAt: body.status === "CANCELLED" ? now : existing.cancelledAt,
      },
      include: {
        customer: { select: { id: true, partyName: true, contactNumber: true, outstandingBalance: true } },
        collectedBy: { select: { id: true, name: true, role: true } },
        depositedBy: { select: { id: true, name: true, role: true } },
        depositedAccount: { select: { id: true, accountName: true, bankName: true, lastFourDigits: true, isActive: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true, role: true } } },
          take: 20,
        },
      },
    });

    await tx.chequeActivity.create({
      data: {
        shopId,
        chequeId: id,
        userId: session.id,
        type: activityType(body.status),
        fromStatus: existing.status,
        toStatus: body.status,
        notes:
          body.notes ??
          body.bounceReason ??
          (depositAccount ? `Deposited in ${depositAccount.bankName} - ${depositAccount.accountName} - ${depositAccount.lastFourDigits}` : undefined),
      },
    });

    if (body.status === "BOUNCED") {
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { status: "HIGH_RISK", nextFollowupDate: now },
      });
      await tx.followUp.create({
        data: {
          shopId,
          customerId: existing.customerId,
          status: "PENDING",
          priority: "URGENT",
          notes: `Cheque bounced: ${existing.chequeNumber}. ${body.bounceReason ?? body.notes ?? ""}`.trim(),
          scheduledAt: now,
          nextFollowupDate: now,
          createdById: session.id,
        },
      });
      await tx.statusHistory.create({
        data: {
          customerId: existing.customerId,
          fromStatus: existing.customer.status,
          toStatus: "HIGH_RISK",
          notes: `Cheque bounced: ${existing.chequeNumber}`,
          changedById: session.id,
        },
      });
    }

    return cheque;
  });

  await logActivity({
    action: "cheque_status_updated",
    userId: session.id,
    shopId,
    customerId: existing.customerId,
    details: `${existing.chequeNumber}: ${existing.status} -> ${body.status}`,
  });

  return NextResponse.json(updated);
}
