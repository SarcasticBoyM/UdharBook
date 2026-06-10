export function normalizeBatchTag(tag?: string | null) {
  const normalized = tag?.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40);
  return normalized || null;
}

export function batchTagKey(tag?: string | null) {
  return normalizeBatchTag(tag) ?? "__UNTAGGED__";
}
