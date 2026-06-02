import { formatCurrency } from "./utils";

export function paymentReminderMessage(partyName: string, balance: number): string {
  return `Hello ${partyName}, our records show an outstanding balance of ${formatCurrency(balance)}. Kindly arrange payment at the earliest. Thank you.`;
}

export function whatsappHref(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
