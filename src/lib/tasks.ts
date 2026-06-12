export const taskTypes = [
  "PAYMENT_COLLECTION",
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
  FOLLOW_UP_VISIT: "Follow-up Visit",
  CHEQUE_COLLECTION: "Cheque Collection",
  CHEQUE_DEPOSIT: "Cheque Deposit",
  INVOICE_HARD_COPY_DELIVERY: "Invoice Hard Copy Delivery",
  ORDER_FOLLOW_UP: "Order Follow-up",
  GENERAL_TASK: "General Task",
};

export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const taskStatuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

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
