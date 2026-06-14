export const taskTypes = [
  "PAYMENT_COLLECTION",
  "PAYMENT_FOLLOW_UP",
  "FOLLOW_UP_VISIT",
  "CHEQUE_COLLECTION",
  "CHEQUE_DEPOSIT",
  "INVOICE_HARD_COPY_DELIVERY",
  "ORDER_FOLLOW_UP",
  "GENERAL_TASK",
] as const;

export type TaskType = (typeof taskTypes)[number];

export const taskTypeLabels: Record<TaskType, string> = {
  PAYMENT_COLLECTION: "Payment Collection",
  PAYMENT_FOLLOW_UP: "Payment Follow-up",
  FOLLOW_UP_VISIT: "Follow-up Visit",
  CHEQUE_COLLECTION: "Cheque Collection",
  CHEQUE_DEPOSIT: "Cheque Deposit",
  INVOICE_HARD_COPY_DELIVERY: "Invoice Hard Copy Delivery",
  ORDER_FOLLOW_UP: "Order Follow-up",
  GENERAL_TASK: "General Task",
};

export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const taskStatuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const taskTypeAliases: Record<string, TaskType> = {
  PAYMENT_COLLECTION: "PAYMENT_COLLECTION",
  PAYMENT_FOLLOW_UP: "PAYMENT_FOLLOW_UP",
  FOLLOW_UP_VISIT: "FOLLOW_UP_VISIT",
  ORDER_FOLLOW_UP: "ORDER_FOLLOW_UP",
  CHEQUE_COLLECTION: "CHEQUE_COLLECTION",
  INVOICE_HARD_COPY_DELIVERY: "INVOICE_HARD_COPY_DELIVERY",
  PAYMENTCOLLECTION: "PAYMENT_COLLECTION",
  PAYMENTFOLLOWUP: "PAYMENT_FOLLOW_UP",
  FOLLOWUPVISIT: "FOLLOW_UP_VISIT",
  ORDERFOLLOWUP: "ORDER_FOLLOW_UP",
  CHEQUECOLLECTION: "CHEQUE_COLLECTION",
  INVOICEHARDCOPYDELIVERY: "INVOICE_HARD_COPY_DELIVERY",
};

export const scheduledFollowUpTaskTypes = [
  "PAYMENT_COLLECTION",
  "PAYMENT_FOLLOW_UP",
  "FOLLOW_UP_VISIT",
  "ORDER_FOLLOW_UP",
  "CHEQUE_COLLECTION",
  "INVOICE_HARD_COPY_DELIVERY",
] as const satisfies readonly TaskType[];

export function normalizeTaskType(value: string | null | undefined): TaskType | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return taskTypeAliases[normalized] ?? taskTypeAliases[normalized.replace(/_/g, "")] ?? null;
}

export function isScheduledFollowUpTaskType(value: string | null | undefined) {
  const normalized = normalizeTaskType(value);
  return Boolean(normalized && scheduledFollowUpTaskTypes.includes(normalized as (typeof scheduledFollowUpTaskTypes)[number]));
}

export function taskReferenceUrl(input: {
  customerId?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
}) {
  if (input.customerId) return `/customers/${encodeURIComponent(input.customerId)}`;
  if (input.sourceEntityType === "ORDER" && input.sourceEntityId) return `/orders?highlight=${encodeURIComponent(input.sourceEntityId)}`;
  if (input.sourceEntityType === "CHEQUE" && input.sourceEntityId) return `/cheques?highlight=${encodeURIComponent(input.sourceEntityId)}`;
  return null;
}
