import { formatCurrency } from "./utils";

export function paymentReminderMessage(partyName: string, balance: number, dueDate?: Date | string | null): string {
  const customerName = partyName?.trim() || "Customer";
  const safeBalance = Number.isFinite(balance) ? balance : 0;
  const parsedDueDate = dueDate ? new Date(dueDate) : null;
  const due = parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
    ? ` Due date: ${parsedDueDate.toLocaleDateString("en-IN")}.`
    : "";

  return `Hello ${customerName}, our records show an outstanding balance of ${formatCurrency(safeBalance)}.${due} Kindly arrange payment at the earliest. Thank you.`;
}

export function normalizeWhatsAppPhone(input: unknown, defaultCountryCode = "91"): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;

  const raw = String(input).trim();
  if (!raw || /[a-z]/i.test(raw)) return null;

  const digits = raw.replace(/\D/g, "");
  const countryCode = defaultCountryCode.replace(/\D/g, "");
  if (!countryCode || digits.length < 10) return null;

  let normalized = digits;
  if (digits.length === 10) normalized = `${countryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) normalized = `${countryCode}${digits.slice(1)}`;

  if (normalized.length < 10 || normalized.length > 15) return null;
  if (normalized.startsWith("91") && !/^[6-9]\d{9}$/.test(normalized.slice(2))) return null;
  return normalized;
}

export function whatsappHref(phone: unknown, message: string): string | null {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function openWhatsAppUrl(url: string): void {
  const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobileDevice) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
