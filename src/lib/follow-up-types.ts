export const ORDER_FOLLOW_UP = "ORDER_FOLLOW_UP" as const;
export const PAYMENT_FOLLOW_UP = "PAYMENT_FOLLOW_UP" as const;
export const FOLLOW_UP_VISIT = "FOLLOW_UP_VISIT" as const;
export const CHEQUE_COLLECTION_FOLLOW_UP = "CHEQUE_COLLECTION" as const;
export const INVOICE_DELIVERY_FOLLOW_UP = "INVOICE_HARD_COPY_DELIVERY" as const;

export const followUpTypeLabels: Record<string, string> = {
  [ORDER_FOLLOW_UP]: "Order Follow-up",
  [PAYMENT_FOLLOW_UP]: "Payment Follow-up",
  [FOLLOW_UP_VISIT]: "Follow-up Visit",
  [CHEQUE_COLLECTION_FOLLOW_UP]: "Cheque Collection",
  [INVOICE_DELIVERY_FOLLOW_UP]: "Invoice Hard Copy Delivery",
};

export function followUpTypeLabel(value: string | null | undefined) {
  if (!value) return "Follow-up";
  return followUpTypeLabels[value] ?? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isOrderFollowUp(value: string | null | undefined) {
  return value === ORDER_FOLLOW_UP;
}
