import { formatCurrency } from "./utils";

export function paymentReminderMessage(partyName: string, balance: number, dueDate?: Date | string | null): string {
  const due = dueDate ? ` Due date: ${new Date(dueDate).toLocaleString("en-IN")}.` : "";
  return `Hello ${partyName}, our records show an outstanding balance of ${formatCurrency(balance)}.${due} Kindly arrange payment at the earliest. Thank you.`;
}

export function whatsappHref(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
