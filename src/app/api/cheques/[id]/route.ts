import { NextResponse } from "next/server";
import { z } from "zod";
import type { ChequeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity } from "@/lib/follow-up-service";

const updateSchema = z.object({
  status: z.enum(["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "CANCELLED"]),
  notes: z.string().optional(),
  depositDateTime: z.string().datetime().optional().nullable(),
  depositedAccountId: z.string().optional(),
  depositBankAccount: z.string().optional(),
  depositSlipUrl: z.string().optional(),
  depositReceiptUrl: z.string().optional().nullable(),
  depositReceiptType: z.string().optional().nullable(),
  depositReceiptUploadedAt: z.string().datetime().optional().nullable(),
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

function normalizedStatus(status: ChequeStatus) {
  return status === "PENDING_DEPOSIT" ? "COLLECTED" : status;
}

function isValidTransition(from: ChequeStatus, to: ChequeStatus) {
  const current = normalizedStatus(from);
  if (to === current) return true;
  if (current === "COLLECTED") return to === "DEPOSITED" || to === "CANCELLED";
  if (current === "DEPOSITED") return to === "CLEARED" || to === "BOUNCED";
  if (current === "BOUNCED") return to === "DEPOSITED";
  return false;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SHOP_ADMIN", "STAFF", "FIELD_SALES"].includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const body = updateSchema.parse(await request.json());
  const existing = await prisma.cheque.findFirst({
    where: { id, shopId },
    include: { customer: true },
  });
  if (!existing) return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
  if (!isValidTransition(existing.status, body.status)) {
    return NextResponse.json(
      { error: `Invalid cheque workflow: ${existing.status} cannot move to ${body.status}` },
      { status: 400 }
    );
  }
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
    if (body.status === "CLEARED" && existing.status !== "CLEARED") {
      const nextBalance = Math.max(0, existing.customer.outstandingBalance - existing.amount);
      await tx.customer.update({
        where: { id: existing.customerId },
        data: {
          outstandingBalance: nextBalance,
          status: nextBalance <= 0 ? "CLEARED" : existing.customer.status === "CLEARED" ? "PENDING" : existing.customer.status,
        },
      });
      await tx.paymentEntry.create({
        data: {
          shopId,
          customerId: existing.customerId,
          amount: existing.amount,
          method: "CHEQUE",
          notes: `Cheque cleared: ${existing.chequeNumber}`,
          paidAt: now,
          createdById: session.id,
        },
      });
      await tx.statusHistory.create({
        data: {
          customerId: existing.customerId,
          fromStatus: existing.customer.status,
          toStatus: nextBalance <= 0 ? "CLEARED" : existing.customer.status,
          notes: `Cheque cleared: ${existing.chequeNumber}. Balance reduced by ${existing.amount}`,
          changedById: session.id,
        },
      });
    }

    if (body.status === "BOUNCED" && existing.status === "CLEARED") {
      await tx.customer.update({
        where: { id: existing.customerId },
        data: {
          outstandingBalance: existing.customer.outstandingBalance + existing.amount,
          status: "HIGH_RISK",
        },
      });
    }

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
        depositReceiptUrl:
          body.depositReceiptUrl === null ? null : body.depositReceiptUrl ?? existing.depositReceiptUrl,
        depositReceiptType:
          body.depositReceiptType === null ? null : body.depositReceiptType ?? existing.depositReceiptType,
        depositReceiptUploadedAt:
          body.depositReceiptUploadedAt === null
            ? null
            : body.depositReceiptUploadedAt
              ? new Date(body.depositReceiptUploadedAt)
              : existing.depositReceiptUploadedAt,
        depositReceiptUploadedById:
          body.depositReceiptUrl === null
            ? null
            : body.depositReceiptUrl
              ? session.id
              : existing.depositReceiptUploadedById,
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
        depositReceiptUploadedBy: { select: { id: true, name: true, role: true } },
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

    if (body.depositReceiptUrl) {
      await tx.chequeActivity.create({
        data: {
          shopId,
          chequeId: id,
          userId: session.id,
          type: "NOTE",
          fromStatus: existing.status,
          toStatus: body.status,
          notes: "Deposit receipt uploaded",
        },
      });
    }

    const depositSummary = depositAccount
      ? `${depositAccount.bankName} - ${depositAccount.accountName} - ${depositAccount.lastFourDigits}`
      : body.depositBankAccount ?? existing.depositBankAccount ?? "";
    const followUpStatus =
      body.status === "BOUNCED"
        ? "PENDING"
        : body.status === "CLEARED"
          ? existing.amount >= existing.customer.outstandingBalance
            ? "PAID"
            : "PARTIAL_PAID"
          : "COMPLETED";
    await recordFollowUpActivity(tx, {
      shopId,
      customerId: existing.customerId,
      createdById: session.id,
      status: followUpStatus,
      priority: body.status === "BOUNCED" ? "URGENT" : "MEDIUM",
      notes:
        body.notes ??
        body.bounceReason ??
        (body.status === "DEPOSITED" || body.status === "CLEARED" ? `Cheque ${body.status.toLowerCase()} ${depositSummary}`.trim() : undefined),
      nextFollowupDate: body.status === "BOUNCED" ? now : null,
      scheduledAt: body.status === "BOUNCED" ? now : null,
      recoveryAmount: existing.amount,
      paymentStatus: body.status === "CLEARED" ? "PAID_BY_CHEQUE" : body.status,
      chequeId: existing.id,
      chequeStatus: body.status,
      sourceModule: "CHEQUE_DEPOSIT",
      followUpType: `CHEQUE_${body.status}`,
      summary:
        body.status === "DEPOSITED"
          ? `Cheque deposited${depositSummary ? ` in ${depositSummary}` : ""}`
          : body.status === "CLEARED"
            ? `Cheque cleared Rs ${existing.amount}`
            : body.status === "BOUNCED"
              ? "Cheque bounced and customer follow-up required"
              : `Cheque ${body.status.toLowerCase()}`,
      detailedNotes: body.notes ?? body.bounceReason,
      activitySource: "cheque-status",
      metadata: {
        chequeNumber: existing.chequeNumber,
        bankName: existing.bankName,
        fromStatus: existing.status,
        toStatus: body.status,
      },
      recordPayment: false,
      updateCustomerStatus: false,
    });

    if (body.status === "BOUNCED") {
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { status: "HIGH_RISK", nextFollowupDate: now },
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
