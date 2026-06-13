export const ORDER_FOLLOW_UP = "ORDER_FOLLOW_UP" as const;

export const followUpTypeLabels: Record<string, string> = {
  [ORDER_FOLLOW_UP]: "Order Follow-up",
};

export function followUpTypeLabel(value: string | null | undefined) {
  if (!value) return "Follow-up";
  return followUpTypeLabels[value] ?? value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isOrderFollowUp(value: string | null | undefined) {
  return value === ORDER_FOLLOW_UP;
}
