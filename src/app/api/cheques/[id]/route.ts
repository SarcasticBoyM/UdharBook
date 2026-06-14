import { NextResponse } from "next/server";
import { z } from "zod";
import type { ChequeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity } from "@/lib/follow-up-service";
import { canManageChequeAccounting, canUseCheques } from "@/lib/permissions";
import { notifyChequeEvent } from "@/lib/notifications";
import { normalizeFixedRole } from "@/lib/operational-roles";

const updateSchema = z.object({
  status: z.enum(["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "RETURNED_TO_PARTY", "CANCELLED"]),
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

const BOUNCE_REASONS = [
  "Insufficient Funds",
  "Signature Mismatch",
  "Payment Stopped",
  "Account Closed",
  "Technical Reason",
  "Other",
] as const;

const responseInclude = {
  customer: { select: { id: true, partyName: true, contactNumber: true, outstandingBalance: true } },
  collectedBy: { select: { id: true, name: true, role: true } },
  depositedBy: { select: { id: true, name: true, role: true } },
  depositReceiptUploadedBy: { select: { id: true, name: true, role: true } },
  depositedAccount: { select: { id: true, accountName: true, bankName: true, lastFourDigits: true, isActive: true } },
  activities: {
    orderBy: { createdAt: "desc" as const },
    include: { user: { select: { name: true, role: true } } },
    take: 20,
  },
} satisfies Prisma.ChequeInclude;

async function balanceApplicationForCheque(tx: Prisma.TransactionClient, cheque: {
  id: string;
  shopId: string;
  customerId: string;
  chequeNumber: string;
  amount: number;
  balanceAppliedAt: Date | null;
  balanceAppliedAmount: number | null;
  balanceAppliedCustomerId: string | null;
  balancePaymentEntryId: string | null;
}) {
  if (
    cheque.balanceAppliedAt
    && cheque.balanceAppliedAmount
    && cheque.balanceAppliedAmount > 0
    && cheque.balanceAppliedCustomerId
  ) {
    return {
      amount: cheque.balanceAppliedAmount,
      customerId: cheque.balanceAppliedCustomerId,
      paymentEntryId: cheque.balancePaymentEntryId,
      source: "EXPLICIT" as const,
    };
  }

  const candidates = await tx.paymentEntry.findMany({
    where: {
      shopId: cheque.shopId,
      method: "CHEQUE",
      notes: `Cheque collected: ${cheque.chequeNumber}`,
    },
    select: { id: true, customerId: true, amount: true },
    take: 2,
  });
  if (candidates.length !== 1 || candidates[0].amount <= 0) return null;
  return {
    amount: candidates[0].amount,
    customerId: candidates[0].customerId,
    paymentEntryId: candidates[0].id,
    source: "LEGACY_PAYMENT_MATCH" as const,
  };
}

function activityType(status: ChequeStatus) {
  if (status === "DEPOSITED") return "DEPOSITED";
  if (status === "CLEARED") return "CLEARED";
  if (status === "BOUNCED") return "BOUNCED";
  if (status === "REPLACED" || status === "RETURNED_TO_PARTY") return "REPLACED";
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
  if (current === "BOUNCED") return to === "DEPOSITED" || to === "RETURNED_TO_PARTY";
  return false;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCheques(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const shopId = requireShopId(request, session);
  const body = updateSchema.parse(await request.json());
  if (body.status === "BOUNCED" && !canManageChequeAccounting(session.role)) {
    return NextResponse.json({ error: "Only authorized accounting staff can mark a cheque bounced." }, { status: 403 });
  }
  if (body.status === "BOUNCED") {
    const reason = body.bounceReason?.trim();
    if (!reason) return NextResponse.json({ error: "Bounce reason is required." }, { status: 400 });
    const standardReason = BOUNCE_REASONS.find((item) => reason === item || reason.startsWith(`${item}:`));
    if (!standardReason) return NextResponse.json({ error: "Select a valid bounce reason." }, { status: 400 });
    if (standardReason === "Other" && !reason.startsWith("Other:")) {
      return NextResponse.json({ error: "Notes are required when bounce reason is Other." }, { status: 400 });
    }
  }
  const existing = await prisma.cheque.findFirst({
    where: { id, shopId },
    include: {
      customer: true,
      collectedBy: { select: { role: true } },
    },
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
  const transactionResult = await prisma.$transaction(async (tx) => {
    const current = await tx.cheque.findFirst({
      where: { id, shopId },
      include: { customer: true },
    });
    if (!current) throw new Error("Cheque not found");
    if (current.status === body.status) {
      const cheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
      return {
        cheque,
        statusChanged: false,
        balanceReversal: current.balanceReversedAt
          ? { applied: false as const, reason: "ALREADY_REVERSED" as const }
          : { applied: false as const, reason: "NO_STATUS_TRANSITION" as const },
      };
    }
    if (!isValidTransition(current.status, body.status)) {
      throw new Error(`Invalid cheque workflow: ${current.status} cannot move to ${body.status}`);
    }
    const replayResult = async (
      reason: "ALREADY_REVERSED" | "NO_STATUS_TRANSITION" | "BALANCE_NOT_APPLIED",
    ) => ({
      cheque: await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude }),
      statusChanged: false,
      balanceReversal: { applied: false as const, reason },
    });

    const balanceApplication = await balanceApplicationForCheque(tx, current);
    let balanceReversal:
      | { applied: true; amount: number; previousBalance: number; newBalance: number }
      | { applied: false; reason: "BALANCE_NOT_APPLIED" | "ALREADY_REVERSED" | "NOT_A_BOUNCE" }
      = { applied: false, reason: "NOT_A_BOUNCE" };

    if (body.status === "CLEARED" && current.status !== "CLEARED") {
      const clearingClaim = await tx.cheque.updateMany({
        where: {
          id,
          shopId,
          status: current.status,
          ...(current.balanceReversedAt ? { balanceReappliedAt: null } : {}),
        },
        data: {
          status: "CLEARED",
          ...(current.balanceReversedAt ? { balanceReappliedAt: now } : {}),
        },
      });
      if (clearingClaim.count === 0) return replayResult("NO_STATUS_TRANSITION");

      if (!balanceApplication) {
        const nextBalance = Math.max(0, current.customer.outstandingBalance - current.amount);
        const appliedAmount = current.customer.outstandingBalance - nextBalance;
        await tx.customer.update({
          where: { id: current.customerId },
          data: {
            outstandingBalance: nextBalance,
            status: nextBalance <= 0 ? "CLEARED" : current.customer.status === "CLEARED" ? "PENDING" : current.customer.status,
          },
        });
        const paymentEntry = await tx.paymentEntry.create({
          data: {
            shopId,
            customerId: current.customerId,
            amount: current.amount,
            method: "CHEQUE",
            notes: `Cheque cleared: ${current.chequeNumber}`,
            paidAt: now,
            createdById: session.id,
          },
        });
        await tx.cheque.update({
          where: { id },
          data: {
            balanceAppliedAt: now,
            balanceAppliedAmount: appliedAmount,
            balanceAppliedCustomerId: current.customerId,
            balancePaymentEntryId: paymentEntry.id,
          },
        });
        await tx.statusHistory.create({
          data: {
            customerId: current.customerId,
            fromStatus: current.customer.status,
            toStatus: nextBalance <= 0 ? "CLEARED" : current.customer.status,
            notes: `Cheque cleared: ${current.chequeNumber}. Balance reduced from ${current.customer.outstandingBalance} to ${nextBalance}`,
            changedById: session.id,
          },
        });
      } else if (current.balanceReversedAt && !current.balanceReappliedAt) {
        const appliedCustomer = await tx.customer.findFirst({
          where: { id: balanceApplication.customerId, shopId },
        });
        if (!appliedCustomer) throw new Error("Applied-balance customer is not available in this shop.");
        const nextBalance = Math.max(0, appliedCustomer.outstandingBalance - balanceApplication.amount);
        await tx.customer.update({
          where: { id: appliedCustomer.id },
          data: {
            outstandingBalance: nextBalance,
            status: nextBalance <= 0 ? "CLEARED" : appliedCustomer.status === "CLEARED" ? "PENDING" : appliedCustomer.status,
          },
        });
        await tx.statusHistory.create({
          data: {
            customerId: appliedCustomer.id,
            fromStatus: appliedCustomer.status,
            toStatus: nextBalance <= 0 ? "CLEARED" : appliedCustomer.status,
            notes: `Re-deposited cheque cleared: ${current.chequeNumber}. Balance reduced from ${appliedCustomer.outstandingBalance} to ${nextBalance}`,
            changedById: session.id,
          },
        });
      }
    }

    if (body.status === "BOUNCED") {
      if (current.balanceReversedAt) {
        const claim = await tx.cheque.updateMany({
          where: { id, shopId, status: current.status },
          data: { status: "BOUNCED", bounceReason: body.bounceReason, bouncedAt: now },
        });
        if (claim.count === 0) return replayResult("ALREADY_REVERSED");
        balanceReversal = { applied: false, reason: "ALREADY_REVERSED" };
      } else if (!balanceApplication) {
        const claim = await tx.cheque.updateMany({
          where: { id, shopId, status: current.status },
          data: { status: "BOUNCED", bounceReason: body.bounceReason, bouncedAt: now },
        });
        if (claim.count === 0) return replayResult("NO_STATUS_TRANSITION");
        balanceReversal = { applied: false, reason: "BALANCE_NOT_APPLIED" };
      } else {
        const appliedCustomer = await tx.customer.findFirst({
          where: { id: balanceApplication.customerId, shopId },
        });
        if (!appliedCustomer) throw new Error("Applied-balance customer is not available in this shop.");
        const reversalTransactionId = `CHEQUE_BOUNCE:${current.id}`;
        const claim = await tx.cheque.updateMany({
          where: {
            id,
            shopId,
            status: current.status,
            balanceReversedAt: null,
          },
          data: {
            status: "BOUNCED",
            bounceReason: body.bounceReason,
            bouncedAt: now,
            balanceAppliedAt: current.balanceAppliedAt ?? now,
            balanceAppliedAmount: balanceApplication.amount,
            balanceAppliedCustomerId: balanceApplication.customerId,
            balancePaymentEntryId: current.balancePaymentEntryId ?? balanceApplication.paymentEntryId,
            balanceReversedAt: now,
            balanceReversalReason: body.bounceReason,
            balanceReversalTransactionId: reversalTransactionId,
          },
        });
        if (claim.count === 0) {
          const concurrent = await tx.cheque.findUniqueOrThrow({ where: { id } });
          const cheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
          return {
            cheque,
            statusChanged: false,
            balanceReversal: concurrent.balanceReversedAt
            ? { applied: false, reason: "ALREADY_REVERSED" }
            : { applied: false, reason: "BALANCE_NOT_APPLIED" },
          };
        } else {
          const previousBalance = appliedCustomer.outstandingBalance;
          const newBalance = previousBalance + balanceApplication.amount;
          await tx.customer.update({
            where: { id: appliedCustomer.id },
            data: {
              outstandingBalance: newBalance,
              status: "HIGH_RISK",
              nextFollowupDate: now,
            },
          });
          await tx.statusHistory.create({
            data: {
              customerId: appliedCustomer.id,
              fromStatus: appliedCustomer.status,
              toStatus: "HIGH_RISK",
              notes: `Cheque Bounced - Balance Restored. Cheque No: ${current.chequeNumber}. Amount restored: ${balanceApplication.amount}. Balance changed from ${previousBalance} to ${newBalance}. Reason: ${body.bounceReason}`,
              changedById: session.id,
            },
          });
          balanceReversal = { applied: true, amount: balanceApplication.amount, previousBalance, newBalance };
        }
      }
    }

    if (body.status !== "BOUNCED" && body.status !== "CLEARED") {
      const transitionClaim = await tx.cheque.updateMany({
        where: { id, shopId, status: current.status },
        data: { status: body.status },
      });
      if (transitionClaim.count === 0) return replayResult("NO_STATUS_TRANSITION");
    }

    if (body.status === "BOUNCED" && balanceReversal.applied === false && balanceReversal.reason === "BALANCE_NOT_APPLIED") {
      await tx.customer.update({
        where: { id: current.customerId },
        data: {
          status: "HIGH_RISK",
          nextFollowupDate: now,
        },
      });
    }

    if (body.status === "RETURNED_TO_PARTY") {
      await tx.customer.update({
        where: { id: current.customerId },
        data: { status: "PENDING", nextFollowupDate: now },
      });
      await tx.statusHistory.create({
        data: {
          customerId: current.customerId,
          fromStatus: current.customer.status,
          toStatus: "PENDING",
          notes: `Cheque returned to party: ${current.chequeNumber}. No additional balance restoration was applied.`,
          changedById: session.id,
        },
      });
    }

    await tx.cheque.update({
      where: { id },
      data: {
        status: body.status,
        depositDateTime:
          ["DEPOSITED", "CLEARED"].includes(body.status)
            ? body.depositDateTime
              ? new Date(body.depositDateTime)
              : current.depositDateTime ?? now
            : body.depositDateTime
              ? new Date(body.depositDateTime)
              : current.depositDateTime,
        depositBankAccount: body.depositBankAccount ?? current.depositBankAccount,
        depositedAccountId: body.depositedAccountId ?? current.depositedAccountId,
        depositSlipUrl: body.depositSlipUrl ?? current.depositSlipUrl,
        depositReceiptUrl:
          body.depositReceiptUrl === null ? null : body.depositReceiptUrl ?? current.depositReceiptUrl,
        depositReceiptType:
          body.depositReceiptType === null ? null : body.depositReceiptType ?? current.depositReceiptType,
        depositReceiptUploadedAt:
          body.depositReceiptUploadedAt === null
            ? null
            : body.depositReceiptUploadedAt
              ? new Date(body.depositReceiptUploadedAt)
              : current.depositReceiptUploadedAt,
        depositReceiptUploadedById:
          body.depositReceiptUrl === null
            ? null
            : body.depositReceiptUrl
              ? session.id
              : current.depositReceiptUploadedById,
        depositedById: ["DEPOSITED", "CLEARED"].includes(body.status) ? session.id : current.depositedById,
        bounceReason: body.status === "BOUNCED" ? body.bounceReason ?? body.notes : current.bounceReason,
        bouncedAt: body.status === "BOUNCED" ? now : current.bouncedAt,
        clearedAt: body.status === "CLEARED" ? now : current.clearedAt,
        cancelledAt: ["CANCELLED", "RETURNED_TO_PARTY"].includes(body.status) ? now : current.cancelledAt,
      },
      include: responseInclude,
    });

    await tx.chequeActivity.create({
      data: {
        shopId,
        chequeId: id,
        userId: session.id,
        type: activityType(body.status),
        fromStatus: current.status,
        toStatus: body.status,
        notes:
          body.status === "BOUNCED" && balanceReversal.applied
            ? `Cheque bounced. Amount: ${current.amount}. Reason: ${body.bounceReason}. Balance restored: ${balanceReversal.amount}. Balance ${balanceReversal.previousBalance} -> ${balanceReversal.newBalance}.`
            : body.notes ??
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
          fromStatus: current.status,
          toStatus: body.status,
          notes: "Deposit receipt uploaded",
        },
      });
    }

    const depositSummary = depositAccount
      ? `${depositAccount.bankName} - ${depositAccount.accountName} - ${depositAccount.lastFourDigits}`
      : body.depositBankAccount ?? current.depositBankAccount ?? "";
    const followUpStatus =
      body.status === "BOUNCED"
        ? "PENDING"
        : body.status === "RETURNED_TO_PARTY"
          ? "PENDING"
        : body.status === "CLEARED"
          ? current.amount >= current.customer.outstandingBalance
            ? "PAID"
            : "PARTIAL_PAID"
          : "COMPLETED";
    await recordFollowUpActivity(tx, {
      shopId,
      customerId: current.customerId,
      createdById: session.id,
      status: followUpStatus,
      priority: body.status === "BOUNCED" || body.status === "RETURNED_TO_PARTY" ? "URGENT" : "MEDIUM",
      notes:
        body.notes ??
        body.bounceReason ??
        (body.status === "DEPOSITED" || body.status === "CLEARED" ? `Cheque ${body.status.toLowerCase()} ${depositSummary}`.trim() : undefined),
      nextFollowupDate: body.status === "BOUNCED" || body.status === "RETURNED_TO_PARTY" ? now : null,
      scheduledAt: body.status === "BOUNCED" || body.status === "RETURNED_TO_PARTY" ? now : null,
      recoveryAmount: current.amount,
      paymentStatus: body.status === "CLEARED" ? "PAID_BY_CHEQUE" : body.status,
      chequeId: current.id,
      chequeStatus: body.status,
      sourceModule: "CHEQUE_DEPOSIT",
      followUpType: `CHEQUE_${body.status}`,
      summary:
        body.status === "DEPOSITED"
          ? `Cheque deposited${depositSummary ? ` in ${depositSummary}` : ""}`
          : body.status === "CLEARED"
            ? `Cheque cleared Rs ${current.amount}`
            : body.status === "BOUNCED"
              ? "Cheque bounced and customer follow-up required"
              : body.status === "RETURNED_TO_PARTY"
                ? "Cheque returned to party and workflow closed"
              : `Cheque ${body.status.toLowerCase()}`,
      detailedNotes: body.notes ?? body.bounceReason,
      activitySource: "cheque-status",
      metadata: {
        chequeNumber: current.chequeNumber,
        bankName: current.bankName,
        fromStatus: current.status,
        toStatus: body.status,
      },
      recordPayment: false,
      updateCustomerStatus: false,
    });

    const responseCheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
    return { cheque: responseCheque, statusChanged: true, balanceReversal };
  });
  const updated = transactionResult.cheque;
  const restoredOutstanding =
    transactionResult.balanceReversal.applied
    && "newBalance" in transactionResult.balanceReversal
      ? transactionResult.balanceReversal.newBalance
      : undefined;

  if (transactionResult.statusChanged) {
    await logActivity({
      action: "cheque_status_updated",
      userId: session.id,
      shopId,
      customerId: existing.customerId,
      details: `${existing.chequeNumber}: ${existing.status} -> ${body.status}`,
    });
  }

  const shopNotification =
    transactionResult.statusChanged &&
    (body.status === "DEPOSITED" || body.status === "BOUNCED" || body.status === "RETURNED_TO_PARTY")
      ? await notifyChequeEvent({
      shopId,
      chequeId: updated.id,
      actorUserId: session.id,
      type:
        body.status === "DEPOSITED"
          ? "CHEQUE_DEPOSITED"
          : body.status === "BOUNCED"
            ? "CHEQUE_BOUNCED"
            : "CHEQUE_RETURNED",
      title:
        body.status === "DEPOSITED"
          ? "Cheque Deposited"
          : body.status === "BOUNCED"
            ? "Cheque Bounced"
            : "Cheque Returned",
      customerName: updated.customer.partyName,
      chequeNumber: updated.chequeNumber,
      amount: updated.amount,
      actorName: session.name,
      restoredOutstanding: body.status === "BOUNCED" ? restoredOutstanding : undefined,
      })
      : undefined;
  const assignedUserNotification =
    body.status === "BOUNCED" &&
    transactionResult.statusChanged &&
    String(normalizeFixedRole(existing.collectedBy.role)) === "SALES_PERSON"
      ? await notifyChequeEvent({
          shopId,
          chequeId: updated.id,
          actorUserId: session.id,
          type: "CHEQUE_BOUNCED",
          title: "Cheque Bounced",
          customerName: updated.customer.partyName,
          chequeNumber: updated.chequeNumber,
          amount: updated.amount,
          actorName: session.name,
          restoredOutstanding,
          target: { type: "USER", userId: existing.collectedById },
        })
      : undefined;
  const notification = shopNotification && assignedUserNotification
    ? {
        success: shopNotification.success && assignedUserNotification.success,
        queued: shopNotification.queued && assignedUserNotification.queued,
        retryQueued: shopNotification.retryQueued || assignedUserNotification.retryQueued,
      }
    : shopNotification ?? assignedUserNotification;

  return NextResponse.json({
    ...updated,
    success: true,
    data: updated,
    balanceReversal: transactionResult.balanceReversal,
    ...(notification ? { notification } : {}),
  });
}
