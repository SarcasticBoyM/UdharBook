import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type ChequeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireShopId } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { recordFollowUpActivity } from "@/lib/follow-up-service";
import { canManageChequeAccounting, canUseCheques } from "@/lib/permissions";
import { notifyChequeEvent } from "@/lib/notifications";
import { isAccountsRole, isSalesRole, isShopAdminRole, normalizeFixedRole } from "@/lib/operational-roles";

const updateSchema = z.object({
  status: z.enum(["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED", "CLEARED", "BOUNCED", "REPLACED", "RETURNED_TO_PARTY", "CANCELLED"]).optional(),
  notes: z.string().optional(),
  depositDateTime: z.string().datetime().optional().nullable(),
  depositedAccountId: z.string().optional(),
  depositBankAccount: z.string().optional(),
  depositSlipUrl: z.string().optional(),
  depositReceiptUrl: z.string().optional().nullable(),
  depositReceiptType: z.string().optional().nullable(),
  depositReceiptUploadedAt: z.string().datetime().optional().nullable(),
  bounceReason: z.string().optional(),
  customerId: z.string().optional(),
  chequeNumber: z.string().min(1).optional(),
  bankName: z.string().min(1).optional(),
  branch: z.string().optional().nullable(),
  chequeDate: z.string().datetime().optional(),
  amount: z.number().positive().optional(),
  accountHolderName: z.string().min(1).optional(),
  collectionDateTime: z.string().datetime().optional(),
  collectionNotes: z.string().optional().nullable(),
  frontImageUrl: z.string().optional().nullable(),
  ocrRawText: z.string().optional().nullable(),
  ocrExtractedData: z.record(z.unknown()).optional().nullable(),
  ocrConfidence: z.number().min(0).max(1).optional().nullable(),
  ocrEditedFields: z.record(z.boolean()).optional().nullable(),
  correctionReason: z.string().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  sourceScreen: z.string().max(80).optional(),
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

const EDITABLE_STATUSES: ChequeStatus[] = ["COLLECTED", "PENDING_DEPOSIT"];
const FINANCIAL_EDIT_FIELDS = ["customerId", "chequeNumber", "bankName", "branch", "chequeDate", "amount", "accountHolderName", "collectionDateTime", "frontImageUrl"] as const;

function isEligibleEditStatus(status: ChequeStatus) {
  return EDITABLE_STATUSES.includes(status);
}

function canEditCollectedCheque(role: string, userId: string, cheque: { collectedById: string }) {
  if (role === "SUPER_ADMIN" || isShopAdminRole(role) || isAccountsRole(role)) return true;
  return isSalesRole(role) && cheque.collectedById === userId;
}

function canChangeChequeCustomer(role: string) {
  return role === "SUPER_ADMIN" || isShopAdminRole(role) || isAccountsRole(role);
}

function customerStatusFor(balance: number, currentStatus: "ACTIVE" | "PENDING" | "HIGH_RISK" | "CLEARED") {
  if (balance <= 0) return "CLEARED" as const;
  return currentStatus === "CLEARED" ? "PENDING" as const : currentStatus;
}

function changedValue(oldValue: unknown, newValue: unknown) {
  const oldComparable = oldValue instanceof Date ? oldValue.toISOString() : oldValue ?? "";
  const newComparable = newValue instanceof Date ? newValue.toISOString() : newValue ?? "";
  return String(oldComparable) !== String(newComparable);
}

function editFieldChanges(current: Prisma.ChequeGetPayload<{ include: { customer: true } }>, body: z.infer<typeof updateSchema>) {
  const nextChequeDate = body.chequeDate ? new Date(body.chequeDate) : undefined;
  const nextCollectionDateTime = body.collectionDateTime ? new Date(body.collectionDateTime) : undefined;
  const pairs: { field: string; oldValue: unknown; newValue: unknown }[] = [
    { field: "customerId", oldValue: current.customerId, newValue: body.customerId },
    { field: "chequeNumber", oldValue: current.chequeNumber, newValue: body.chequeNumber },
    { field: "bankName", oldValue: current.bankName, newValue: body.bankName },
    { field: "branch", oldValue: current.branch, newValue: body.branch },
    { field: "chequeDate", oldValue: current.chequeDate, newValue: nextChequeDate },
    { field: "amount", oldValue: current.amount, newValue: body.amount },
    { field: "accountHolderName", oldValue: current.accountHolderName, newValue: body.accountHolderName },
    { field: "collectionDateTime", oldValue: current.collectionDateTime, newValue: nextCollectionDateTime },
    { field: "collectionNotes", oldValue: current.collectionNotes, newValue: body.collectionNotes },
    { field: "frontImageUrl", oldValue: current.frontImageUrl, newValue: body.frontImageUrl },
  ];
  return pairs.filter((pair) => pair.newValue !== undefined && changedValue(pair.oldValue, pair.newValue));
}

function auditLine(input: {
  reason: string;
  sourceScreen?: string;
  changes: { field: string; oldValue: unknown; newValue: unknown }[];
  balanceDelta: number;
}) {
  const fieldSummary = input.changes
    .map((change) => {
      const oldText = change.oldValue instanceof Date ? change.oldValue.toISOString() : String(change.oldValue ?? "-");
      const newText = change.newValue instanceof Date ? change.newValue.toISOString() : String(change.newValue ?? "-");
      return `${change.field}: ${oldText} -> ${newText}`;
    })
    .join("; ");
  return [
    "Cheque Edited",
    fieldSummary,
    `Reason: ${input.reason}`,
    `Source: ${input.sourceScreen ?? "cheque-tracker"}`,
    `Balance adjustment delta: ${input.balanceDelta}`,
  ].filter(Boolean).join("\n");
}

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

  const requestedEditFields = FINANCIAL_EDIT_FIELDS.filter((field) => body[field] !== undefined);
  const isCollectedEditRequest = requestedEditFields.length > 0 || body.collectionNotes !== undefined;
  if (isCollectedEditRequest && !body.status) {
    if (!canEditCollectedCheque(session.role, session.id, existing)) {
      return NextResponse.json({ code: "CHEQUE_EDIT_FORBIDDEN", error: "You do not have permission to edit this cheque." }, { status: 403 });
    }

    const hasFinancialChanges = requestedEditFields.length > 0;
    if (!isEligibleEditStatus(existing.status) && hasFinancialChanges) {
      return NextResponse.json({
        code: "CHEQUE_FINALIZED",
        error: "This cheque is already deposited or finalized. Normal financial editing is not allowed.",
      }, { status: 409 });
    }
    if (!isEligibleEditStatus(existing.status) && !canManageChequeAccounting(session.role)) {
      return NextResponse.json({
        code: "CHEQUE_NOTES_LOCKED",
        error: "Only authorized accounting staff can add correction notes after a cheque is finalized.",
      }, { status: 403 });
    }

    if (body.expectedUpdatedAt && existing.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString()) {
      return NextResponse.json({
        code: "CHEQUE_CONFLICT",
        error: "This cheque was updated by another user. Refresh and review the latest details.",
      }, { status: 409 });
    }

    if (body.customerId && body.customerId !== existing.customerId && !canChangeChequeCustomer(session.role)) {
      return NextResponse.json({
        code: "CUSTOMER_CHANGE_FORBIDDEN",
        error: "Only Shop Admin or authorized accounting staff can change the cheque customer.",
      }, { status: 403 });
    }

    const duplicate = (body.chequeNumber || body.bankName)
      ? await prisma.cheque.findFirst({
          where: {
            id: { not: id },
            shopId,
            chequeNumber: body.chequeNumber ?? existing.chequeNumber,
            bankName: body.bankName ?? existing.bankName,
          },
          select: {
            chequeNumber: true,
            bankName: true,
            amount: true,
            chequeDate: true,
            customer: { select: { partyName: true } },
          },
        })
      : null;
    if (duplicate) {
      return NextResponse.json({
        code: "DUPLICATE_CHEQUE",
        error: "A cheque with this number and bank already exists.",
        duplicate: {
          chequeNumber: duplicate.chequeNumber,
          customer: duplicate.customer.partyName,
          amount: duplicate.amount,
          chequeDate: duplicate.chequeDate,
          bankName: duplicate.bankName,
        },
      }, { status: 409 });
    }

    const newCustomer = body.customerId && body.customerId !== existing.customerId
      ? await prisma.customer.findFirst({ where: { id: body.customerId, shopId, isArchived: false } })
      : null;
    if (body.customerId && body.customerId !== existing.customerId && !newCustomer) {
      return NextResponse.json({ code: "CUSTOMER_NOT_FOUND", error: "Selected customer was not found in this shop." }, { status: 404 });
    }

    const previewChanges = editFieldChanges(existing, body);
    const sensitiveChanged = previewChanges.some((change) => ["customerId", "amount", "chequeDate"].includes(change.field));
    if (sensitiveChanged && !body.correctionReason?.trim()) {
      return NextResponse.json({
        code: "CORRECTION_REASON_REQUIRED",
        error: "Correction reason is required for amount, date, or customer changes.",
      }, { status: 400 });
    }
    if (body.customerId && body.customerId !== existing.customerId) {
      const confirmed = body.correctionReason?.trim();
      if (!confirmed) {
        return NextResponse.json({ code: "CUSTOMER_CHANGE_REASON_REQUIRED", error: "Correction reason is required to change customer." }, { status: 400 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.cheque.findFirst({ where: { id, shopId }, include: { customer: true } });
      if (!current) throw new Error("Cheque not found");
      if (body.expectedUpdatedAt && current.updatedAt.toISOString() !== new Date(body.expectedUpdatedAt).toISOString()) {
        return { conflict: true as const };
      }

      const changes = editFieldChanges(current, body);
      if (changes.length === 0) {
        const cheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
        return { conflict: false as const, cheque, balanceAdjustment: { applied: false, delta: 0 }, changedCustomerId: current.customerId };
      }

      const balanceApplication = await balanceApplicationForCheque(tx, current);
      const oldAppliedAmount = balanceApplication?.amount ?? 0;
      const targetCustomerId = body.customerId ?? current.customerId;
      const nextAmount = body.amount ?? current.amount;
      let balanceDelta = 0;

      if (isEligibleEditStatus(current.status) && balanceApplication) {
        if (targetCustomerId !== current.customerId) {
          const oldCustomer = await tx.customer.findFirst({ where: { id: balanceApplication.customerId, shopId } });
          const targetCustomer = await tx.customer.findFirst({ where: { id: targetCustomerId, shopId, isArchived: false } });
          if (!oldCustomer || !targetCustomer) throw new Error("Customer balance correction could not be completed.");

          const oldCustomerBalance = oldCustomer.outstandingBalance + oldAppliedAmount;
          await tx.customer.update({
            where: { id: oldCustomer.id },
            data: {
              outstandingBalance: oldCustomerBalance,
              status: customerStatusFor(oldCustomerBalance, oldCustomer.status),
            },
          });

          const newAppliedAmount = Math.min(nextAmount, targetCustomer.outstandingBalance);
          const targetBalance = Math.max(0, targetCustomer.outstandingBalance - newAppliedAmount);
          await tx.customer.update({
            where: { id: targetCustomer.id },
            data: {
              outstandingBalance: targetBalance,
              status: customerStatusFor(targetBalance, targetCustomer.status),
            },
          });
          await tx.statusHistory.create({
            data: {
              customerId: oldCustomer.id,
              fromStatus: oldCustomer.status,
              toStatus: customerStatusFor(oldCustomerBalance, oldCustomer.status),
              notes: `Cheque correction reversed: ${current.chequeNumber}. Amount restored: ${oldAppliedAmount}. Reason: ${body.correctionReason}`,
              changedById: session.id,
            },
          });
          await tx.statusHistory.create({
            data: {
              customerId: targetCustomer.id,
              fromStatus: targetCustomer.status,
              toStatus: customerStatusFor(targetBalance, targetCustomer.status),
              notes: `Cheque correction applied: ${body.chequeNumber ?? current.chequeNumber}. Amount reduced: ${newAppliedAmount}. Reason: ${body.correctionReason}`,
              changedById: session.id,
            },
          });
          balanceDelta = newAppliedAmount - oldAppliedAmount;
          if (balanceApplication.paymentEntryId) {
            await tx.paymentEntry.update({
              where: { id: balanceApplication.paymentEntryId },
              data: { customerId: targetCustomer.id, amount: nextAmount, notes: `Cheque corrected: ${body.chequeNumber ?? current.chequeNumber}` },
            });
          }
          await tx.cheque.update({
            where: { id },
            data: {
              balanceAppliedAmount: newAppliedAmount,
              balanceAppliedCustomerId: targetCustomer.id,
              balancePaymentEntryId: balanceApplication.paymentEntryId ?? current.balancePaymentEntryId,
            },
          });
        } else if (body.amount !== undefined && body.amount !== current.amount) {
          const appliedCustomer = await tx.customer.findFirst({ where: { id: balanceApplication.customerId, shopId } });
          if (!appliedCustomer) throw new Error("Applied-balance customer is not available in this shop.");
          const amountDelta = body.amount - current.amount;
          const newAppliedAmount = Math.max(0, oldAppliedAmount + amountDelta);
          const nextBalance = amountDelta >= 0
            ? Math.max(0, appliedCustomer.outstandingBalance - amountDelta)
            : appliedCustomer.outstandingBalance + Math.abs(amountDelta);
          await tx.customer.update({
            where: { id: appliedCustomer.id },
            data: {
              outstandingBalance: nextBalance,
              status: customerStatusFor(nextBalance, appliedCustomer.status),
            },
          });
          await tx.statusHistory.create({
            data: {
              customerId: appliedCustomer.id,
              fromStatus: appliedCustomer.status,
              toStatus: customerStatusFor(nextBalance, appliedCustomer.status),
              notes: `Cheque amount corrected: ${current.chequeNumber}. ${current.amount} -> ${body.amount}. Balance delta: ${amountDelta}. Reason: ${body.correctionReason}`,
              changedById: session.id,
            },
          });
          balanceDelta = amountDelta;
          if (balanceApplication.paymentEntryId) {
            await tx.paymentEntry.update({
              where: { id: balanceApplication.paymentEntryId },
              data: { amount: body.amount, notes: `Cheque corrected: ${body.chequeNumber ?? current.chequeNumber}` },
            });
          }
          await tx.cheque.update({
            where: { id },
            data: {
              balanceAppliedAmount: newAppliedAmount,
              balanceAppliedCustomerId: balanceApplication.customerId,
              balancePaymentEntryId: balanceApplication.paymentEntryId ?? current.balancePaymentEntryId,
            },
          });
        }
      }

      await tx.cheque.update({
        where: { id },
        data: {
          customerId: targetCustomerId,
          chequeNumber: body.chequeNumber ?? current.chequeNumber,
          bankName: body.bankName ?? current.bankName,
          branch: body.branch === null ? null : body.branch ?? current.branch,
          chequeDate: body.chequeDate ? new Date(body.chequeDate) : current.chequeDate,
          amount: nextAmount,
          accountHolderName: body.accountHolderName ?? current.accountHolderName,
          collectionDateTime: body.collectionDateTime ? new Date(body.collectionDateTime) : current.collectionDateTime,
          collectionNotes: body.collectionNotes === null ? null : body.collectionNotes ?? current.collectionNotes,
          frontImageUrl: body.frontImageUrl === null ? null : body.frontImageUrl ?? current.frontImageUrl,
          ocrRawText: body.ocrRawText === null ? null : body.ocrRawText ?? current.ocrRawText,
          ocrExtractedData: body.ocrExtractedData === null ? Prisma.JsonNull : body.ocrExtractedData as Prisma.InputJsonValue | undefined,
          ocrConfidence: body.ocrConfidence === null ? null : body.ocrConfidence ?? current.ocrConfidence,
          ocrEditedFields: body.ocrEditedFields === null ? Prisma.JsonNull : body.ocrEditedFields as Prisma.InputJsonValue | undefined,
        },
      });

      if (current.staffVisitId && targetCustomerId !== current.customerId) {
        await tx.staffVisit.updateMany({
          where: { id: current.staffVisitId, shopId },
          data: { customerId: targetCustomerId },
        });
      }
      await tx.followUp.updateMany({
        where: { shopId, chequeId: id },
        data: {
          customerId: targetCustomerId,
          recoveryAmount: nextAmount,
          detailedNotes: body.collectionNotes ?? undefined,
          metadata: {
            chequeNumber: body.chequeNumber ?? current.chequeNumber,
            bankName: body.bankName ?? current.bankName,
            chequeDate: body.chequeDate ?? current.chequeDate.toISOString(),
            correctionReason: body.correctionReason ?? null,
          },
        },
      });

      await tx.chequeActivity.create({
        data: {
          shopId,
          chequeId: id,
          userId: session.id,
          type: "NOTE",
          fromStatus: current.status,
          toStatus: current.status,
          notes: auditLine({
            reason: body.correctionReason?.trim() || "Notes corrected",
            sourceScreen: body.sourceScreen,
            changes,
            balanceDelta,
          }),
        },
      });

      const cheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
      return {
        conflict: false as const,
        cheque,
        balanceAdjustment: { applied: balanceDelta !== 0, delta: balanceDelta },
        changedCustomerId: targetCustomerId,
      };
    });

    if (result.conflict) {
      return NextResponse.json({
        code: "CHEQUE_CONFLICT",
        error: "This cheque was updated by another user. Refresh and review the latest details.",
      }, { status: 409 });
    }

    await logActivity({
      action: "cheque_edited",
      userId: session.id,
      shopId,
      customerId: result.changedCustomerId,
      details: `${existing.chequeNumber}: ${body.correctionReason ?? "Cheque corrected"}`,
    });

    return NextResponse.json({
      success: true,
      cheque: result.cheque,
      data: result.cheque,
      balanceAdjustment: result.balanceAdjustment,
    });
  }

  if (!body.status) {
    return NextResponse.json({ error: "Cheque status is required for workflow updates." }, { status: 400 });
  }
  const targetStatus = body.status;
  if (!isValidTransition(existing.status, targetStatus)) {
    return NextResponse.json(
      { error: `Invalid cheque workflow: ${existing.status} cannot move to ${targetStatus}` },
      { status: 400 }
    );
  }
  const requiresDepositAccount = ["DEPOSITED", "CLEARED"].includes(targetStatus);
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
    if (current.status === targetStatus) {
      const cheque = await tx.cheque.findUniqueOrThrow({ where: { id }, include: responseInclude });
      return {
        cheque,
        statusChanged: false,
        balanceReversal: current.balanceReversedAt
          ? { applied: false as const, reason: "ALREADY_REVERSED" as const }
          : { applied: false as const, reason: "NO_STATUS_TRANSITION" as const },
      };
    }
    if (!isValidTransition(current.status, targetStatus)) {
      throw new Error(`Invalid cheque workflow: ${current.status} cannot move to ${targetStatus}`);
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

    if (targetStatus === "CLEARED" && current.status !== "CLEARED") {
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

    if (targetStatus === "BOUNCED") {
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

    if (targetStatus !== "BOUNCED" && targetStatus !== "CLEARED") {
      const transitionClaim = await tx.cheque.updateMany({
        where: { id, shopId, status: current.status },
        data: { status: targetStatus },
      });
      if (transitionClaim.count === 0) return replayResult("NO_STATUS_TRANSITION");
    }

    if (targetStatus === "BOUNCED" && balanceReversal.applied === false && balanceReversal.reason === "BALANCE_NOT_APPLIED") {
      await tx.customer.update({
        where: { id: current.customerId },
        data: {
          status: "HIGH_RISK",
          nextFollowupDate: now,
        },
      });
    }

    if (targetStatus === "RETURNED_TO_PARTY") {
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
        status: targetStatus,
        depositDateTime:
          ["DEPOSITED", "CLEARED"].includes(targetStatus)
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
        depositedById: ["DEPOSITED", "CLEARED"].includes(targetStatus) ? session.id : current.depositedById,
        bounceReason: targetStatus === "BOUNCED" ? body.bounceReason ?? body.notes : current.bounceReason,
        bouncedAt: targetStatus === "BOUNCED" ? now : current.bouncedAt,
        clearedAt: targetStatus === "CLEARED" ? now : current.clearedAt,
        cancelledAt: ["CANCELLED", "RETURNED_TO_PARTY"].includes(targetStatus) ? now : current.cancelledAt,
      },
      include: responseInclude,
    });

    await tx.chequeActivity.create({
      data: {
        shopId,
        chequeId: id,
        userId: session.id,
        type: activityType(targetStatus),
        fromStatus: current.status,
        toStatus: targetStatus,
        notes:
          targetStatus === "BOUNCED" && balanceReversal.applied
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
          toStatus: targetStatus,
          notes: "Deposit receipt uploaded",
        },
      });
    }

    const depositSummary = depositAccount
      ? `${depositAccount.bankName} - ${depositAccount.accountName} - ${depositAccount.lastFourDigits}`
      : body.depositBankAccount ?? current.depositBankAccount ?? "";
    const followUpStatus =
      targetStatus === "BOUNCED"
        ? "PENDING"
        : targetStatus === "RETURNED_TO_PARTY"
          ? "PENDING"
        : targetStatus === "CLEARED"
          ? current.amount >= current.customer.outstandingBalance
            ? "PAID"
            : "PARTIAL_PAID"
          : "COMPLETED";
    await recordFollowUpActivity(tx, {
      shopId,
      customerId: current.customerId,
      createdById: session.id,
      status: followUpStatus,
      priority: targetStatus === "BOUNCED" || targetStatus === "RETURNED_TO_PARTY" ? "URGENT" : "MEDIUM",
      notes:
        body.notes ??
        body.bounceReason ??
        (targetStatus === "DEPOSITED" || targetStatus === "CLEARED" ? `Cheque ${targetStatus.toLowerCase()} ${depositSummary}`.trim() : undefined),
      nextFollowupDate: targetStatus === "BOUNCED" || targetStatus === "RETURNED_TO_PARTY" ? now : null,
      scheduledAt: targetStatus === "BOUNCED" || targetStatus === "RETURNED_TO_PARTY" ? now : null,
      recoveryAmount: current.amount,
      paymentStatus: targetStatus === "CLEARED" ? "PAID_BY_CHEQUE" : targetStatus,
      chequeId: current.id,
      chequeStatus: targetStatus,
      sourceModule: "CHEQUE_DEPOSIT",
      followUpType: `CHEQUE_${targetStatus}`,
      summary:
        targetStatus === "DEPOSITED"
          ? `Cheque deposited${depositSummary ? ` in ${depositSummary}` : ""}`
          : targetStatus === "CLEARED"
            ? `Cheque cleared Rs ${current.amount}`
            : targetStatus === "BOUNCED"
              ? "Cheque bounced and customer follow-up required"
              : targetStatus === "RETURNED_TO_PARTY"
                ? "Cheque returned to party and workflow closed"
              : `Cheque ${targetStatus.toLowerCase()}`,
      detailedNotes: body.notes ?? body.bounceReason,
      activitySource: "cheque-status",
      metadata: {
        chequeNumber: current.chequeNumber,
        bankName: current.bankName,
        fromStatus: current.status,
        toStatus: targetStatus,
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
      details: `${existing.chequeNumber}: ${existing.status} -> ${targetStatus}`,
    });
  }

  const shopNotification =
    transactionResult.statusChanged &&
    (targetStatus === "DEPOSITED" || targetStatus === "BOUNCED" || targetStatus === "RETURNED_TO_PARTY")
      ? await notifyChequeEvent({
      shopId,
      chequeId: updated.id,
      actorUserId: session.id,
      type:
        targetStatus === "DEPOSITED"
          ? "CHEQUE_DEPOSITED"
          : targetStatus === "BOUNCED"
            ? "CHEQUE_BOUNCED"
            : "CHEQUE_RETURNED",
      title:
        targetStatus === "DEPOSITED"
          ? "Cheque Deposited"
          : targetStatus === "BOUNCED"
            ? "Cheque Bounced"
            : "Cheque Returned",
      customerName: updated.customer.partyName,
      chequeNumber: updated.chequeNumber,
      amount: updated.amount,
      actorName: session.name,
      restoredOutstanding: targetStatus === "BOUNCED" ? restoredOutstanding : undefined,
      })
      : undefined;
  const assignedUserNotification =
    targetStatus === "BOUNCED" &&
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
