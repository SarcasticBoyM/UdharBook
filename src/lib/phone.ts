/** Normalize Indian phone numbers to digits with country code (91). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function telHref(phone: string): string {
  const normalized = normalizePhone(phone);
  return `tel:+${normalized}`;
}

export function displayPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (n.length === 12 && n.startsWith("91")) {
    return `+91 ${n.slice(2, 7)} ${n.slice(7)}`;
  }
  return `+${n}`;
}
