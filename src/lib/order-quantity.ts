export function extractOrderQuantity(orderText: string | null | undefined): number {
  if (!orderText) return 0;
  const text = String(orderText);
  const matches = text.matchAll(/[-–—]\s*(\d+(?:\.\d+)?)/g);
  let total = 0;
  for (const match of matches) {
    const quantity = Number(match[1]);
    if (Number.isFinite(quantity)) total += quantity;
  }
  return total;
}
