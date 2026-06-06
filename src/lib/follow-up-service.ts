import type { FollowUpPriority, FollowUpStatus, Prisma } from "@prisma/client";

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
  updateCustomerFollowup?: boolean;
  updateCustomerStatus?: boolean;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function customerStatusFromFollowUp(status: FollowUpStatus, balance: number) {
  if (status === "PAID" || balance === 0) return "CLEARED";
  if (status === "COMPLETED") return balance === 0 ? "CLEARED" : "ACTIVE";
  if (status === "MISSED") return "HIGH_RISK";
  if (status === "RESCHEDULED" || status === "CALLBACK" || status === "FOLLOW_UP_REQUIRED") return "PENDING";
  if (status === "NOT_REACHABLE" || status === "WRONG_NUMBER") return "HIGH_RISK";
  if (status === "CONTACTED" || status === "PAYMENT_PROMISED" || status === "PARTIAL_PAID") return "ACTIVE";
  return "PENDING";
}

export async function recordFollowUpActivity(tx: DbClient, input: RecordFollowUpInput) {
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, shopId: input.shopId } });
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const requestedReminderAt = input.nextFollowUpDateTime ?? input.scheduledAt ?? input.nextFollowupDate;
  const reminderDateTime = toDate(requestedReminderAt);
  const reminderStatusAllowed = input.status === "CALLBACK" || input.status === "FOLLOW_UP_REQUIRED";
  const reminderEnabled = Boolean(input.manualReminder && input.reminderEnabled !== false && reminderDateTime && reminderStatusAllowed);
  const scheduledAt = reminderEnabled ? reminderDateTime : toDate(input.scheduledAt);
  const nextDate = toDate(input.nextFollowupDate) ?? reminderDateTime ?? scheduledAt;
  const now = toDate(input.actionLoggedAt) ?? new Date();
  const completedAt = toDate(input.completedAt) ?? (input.status === "COMPLETED" || input.status === "PAID" ? now : null);
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
      nextFollowUpDateTime: reminderEnabled ? reminderDateTime : toDate(input.nextFollowUpDateTime),
      scheduledAt,
      completedAt,
      rescheduledAt,
      actionLoggedAt: now,
      nextFollowupDate: nextDate,
      createdById: input.createdById,
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
        paidAt: now,
        createdById: input.createdById,
      },
    });
  }

  const shouldUpdateFollowup = input.updateCustomerFollowup !== false;
  const updated = await tx.customer.update({
    where: { id: input.customerId },
    data: {
      ...(shouldUpdateFollowup ? { lastFollowupDate: now, nextFollowupDate: nextDate } : {}),
      ...(shouldReduceBalance ? { outstandingBalance: newBalance } : {}),
      ...(shouldUpdateStatus ? { status: nextCustomerStatus } : {}),
      notes: input.notes ?? customer.notes,
      totalCallsMade: { increment: 1 },
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
