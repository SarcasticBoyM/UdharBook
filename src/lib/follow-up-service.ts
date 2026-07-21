import type { FollowUpPriority, FollowUpStatus, Prisma } from "@prisma/client";
import { ORDER_FOLLOW_UP } from "@/lib/follow-up-types";

export type FollowUpSourceModule =
  | "TODAY_FOLLOWUPS"
  | "CUSTOMER_MODULE"
  | "FIELD_VISIT"
  | "CHEQUE_COLLECTION"
  | "CHEQUE_DEPOSIT"
  | "ADMIN_MANUAL"
  | "AUTO_REMINDER";

type DbClient = Prisma.TransactionClient;

export type RecordFollowUpInput = {
  shopId: string;
  customerId: string;
  createdById: string;
  assignedToId?: string | null;
  orderId?: string | null;
  supersedesFollowUpId?: string | null;
  status: FollowUpStatus;
  priority?: FollowUpPriority;
  notes?: string | null;
  reminderNotes?: string | null;
  customerResponse?: string | null;
  manualReminder?: boolean;
  reminderEnabled?: boolean;
  nextFollowUpDateTime?: Date | string | null;
  scheduledAt?: Date | string | null;
  nextFollowupDate?: Date | string | null;
  completedAt?: Date | string | null;
  rescheduledAt?: Date | string | null;
  actionLoggedAt?: Date | string | null;
  sourceModule: FollowUpSourceModule;
  followUpType?: string | null;
  summary?: string | null;
  detailedNotes?: string | null;
  recoveryAmount?: number;
  paymentStatus?: string | null;
  chequeId?: string | null;
  chequeStatus?: string | null;
  promiseDate?: Date | string | null;
  visitId?: string | null;
  activitySource?: string | null;
  metadata?: Prisma.InputJsonValue;
  recordPayment?: boolean;
  paymentMethod?: string | null;
  paymentDate?: Date | string | null;
  updateCustomerFollowup?: boolean;
  updateCustomerStatus?: boolean;
  updateCustomerNotes?: boolean;
  incrementCallCount?: boolean;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function customerStatusFromFollowUp(status: FollowUpStatus, balance: number) {
  if (status === "PAID" || balance <= 0) return "CLEARED";
  if (status === "COMPLETED") return balance <= 0 ? "CLEARED" : "ACTIVE";
  if (status === "MISSED") return "HIGH_RISK";
  if (status === "RESCHEDULED" || status === "CALLBACK" || status === "FOLLOW_UP_REQUIRED") return "PENDING";
  if (status === "NOT_REACHABLE" || status === "WRONG_NUMBER") return "HIGH_RISK";
  if (status === "CONTACTED" || status === "PAYMENT_PROMISED" || status === "PARTIAL_PAID") return "ACTIVE";
  return "PENDING";
}

const CLOSED_FOLLOW_UP_STATUSES: FollowUpStatus[] = ["PAID", "COMPLETED", "WRONG_NUMBER"];
const REMINDER_ALLOWED_STATUSES: FollowUpStatus[] = [
  "PENDING",
  "CALLBACK",
  "FOLLOW_UP_REQUIRED",
  "PAYMENT_PROMISED",
  "PARTIAL_PAID",
  "NOT_REACHABLE",
  "RESCHEDULED",
];

export async function recordFollowUpActivity(tx: DbClient, input: RecordFollowUpInput) {
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, shopId: input.shopId, isArchived: false } });
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const isClosedFollowUp = CLOSED_FOLLOW_UP_STATUSES.includes(input.status);
  const requestedReminderAt = input.nextFollowUpDateTime ?? input.scheduledAt ?? input.nextFollowupDate;
  const reminderDateTime = isClosedFollowUp ? null : toDate(requestedReminderAt);
  const reminderStatusAllowed = REMINDER_ALLOWED_STATUSES.includes(input.status);
  const explicitReminder = Boolean(input.manualReminder || input.reminderEnabled);
  const shouldSchedule = Boolean(reminderDateTime && reminderStatusAllowed && explicitReminder);
  const reminderEnabled = shouldSchedule;
  const scheduledAt = shouldSchedule ? reminderDateTime : null;
  const nextDate = shouldSchedule ? reminderDateTime : null;
  const now = toDate(input.actionLoggedAt) ?? new Date();
  const completedAt = toDate(input.completedAt) ?? (isClosedFollowUp ? now : null);
  const rescheduledAt = toDate(input.rescheduledAt) ?? (input.status === "RESCHEDULED" ? now : null);
  const recoveryAmount = Math.max(0, input.recoveryAmount ?? 0);
  const paidAmount =
    input.status === "PAID"
      ? customer.outstandingBalance
      : input.status === "PARTIAL_PAID"
        ? Math.min(recoveryAmount, customer.outstandingBalance)
        : recoveryAmount;
  const shouldReduceBalance = input.recordPayment === true && paidAmount > 0;
  const newBalance = shouldReduceBalance ? Math.max(0, customer.outstandingBalance - paidAmount) : customer.outstandingBalance;
  const nextCustomerStatus = customerStatusFromFollowUp(input.status, newBalance);
  const shouldUpdateStatus = input.updateCustomerStatus !== false;

  if (input.supersedesFollowUpId) {
    const superseded = await tx.followUp.updateMany({
      where: {
        id: input.supersedesFollowUpId,
        shopId: input.shopId,
        customerId: input.customerId,
        supersededAt: null,
        cancelledAt: null,
      },
      data: {
        supersededAt: now,
        reminderEnabled: false,
      },
    });
    if (!superseded.count) throw new Error("FOLLOW_UP_TO_SUPERSEDE_NOT_FOUND");
  }

  if (input.followUpType !== ORDER_FOLLOW_UP) {
    await tx.followUp.updateMany({
      where: {
        shopId: input.shopId,
        customerId: input.customerId,
        supersededAt: null,
        cancelledAt: null,
        completedAt: null,
        reminderEnabled: true,
        manualReminder: true,
        nextFollowUpDateTime: { not: null },
        NOT: {
          OR: [
            { followUpType: ORDER_FOLLOW_UP },
            ...(input.supersedesFollowUpId ? [{ id: input.supersedesFollowUpId }] : []),
          ],
        },
      },
      data: {
        supersededAt: now,
        reminderEnabled: false,
        manualReminder: false,
      },
    });
  }

  const followUp = await tx.followUp.create({
    data: {
      shopId: input.shopId,
      customerId: input.customerId,
      status: input.status,
      priority: input.priority ?? "MEDIUM",
      notes: input.notes,
      reminderNotes: input.reminderNotes,
      customerResponse: input.customerResponse,
      manualReminder: reminderEnabled,
      reminderEnabled,
      nextFollowUpDateTime: shouldSchedule ? reminderDateTime : null,
      scheduledAt,
      completedAt,
      rescheduledAt,
      actionLoggedAt: now,
      nextFollowupDate: nextDate,
      createdById: input.createdById,
      assignedToId: input.assignedToId,
      orderId: input.orderId,
      sourceModule: input.sourceModule,
      followUpType: input.followUpType ?? input.status,
      summary: input.summary ?? input.notes ?? input.customerResponse,
      detailedNotes: input.detailedNotes ?? input.notes,
      recoveryAmount: recoveryAmount > 0 ? recoveryAmount : null,
      paymentStatus: input.paymentStatus ?? (paidAmount > 0 ? "RECORDED" : null),
      chequeId: input.chequeId,
      chequeStatus: input.chequeStatus,
      promiseDate: toDate(input.promiseDate) ?? (input.status === "PAYMENT_PROMISED" ? nextDate : null),
      visitId: input.visitId,
      activitySource: input.activitySource ?? input.sourceModule,
      metadata: input.metadata,
    },
  });

  if (shouldReduceBalance) {
    await tx.paymentEntry.create({
      data: {
        shopId: input.shopId,
        customerId: input.customerId,
        amount: paidAmount,
        method: input.paymentMethod ?? input.sourceModule,
        notes: input.summary ?? input.notes ?? undefined,
        paidAt: toDate(input.paymentDate) ?? now,
        createdById: input.createdById,
      },
    });
  }

  const shouldUpdateFollowup = input.updateCustomerFollowup !== false;
  const updated = await tx.customer.update({
    where: { id: input.customerId },
    data: {
      ...(shouldUpdateFollowup ? { lastFollowupDate: now, nextFollowupDate: nextDate } : {}),
      ...(newBalance <= 0 ? { nextFollowupDate: null } : {}),
      ...(shouldReduceBalance ? { outstandingBalance: newBalance } : {}),
      ...(shouldUpdateStatus ? { status: nextCustomerStatus } : {}),
      ...(input.updateCustomerNotes === false ? {} : { notes: input.notes ?? customer.notes }),
      ...(input.incrementCallCount === false ? {} : { totalCallsMade: { increment: 1 } }),
    },
  });

  if (shouldUpdateStatus && updated.status !== customer.status) {
    await tx.statusHistory.create({
      data: {
        customerId: input.customerId,
        fromStatus: customer.status,
        toStatus: updated.status,
        notes: input.summary ?? input.notes ?? `Follow-up ${input.status}`,
        changedById: input.createdById,
      },
    });
  }

  return { followUp, customer: updated };
}
