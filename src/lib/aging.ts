export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export function agingBucket(asOf: Date): AgingBucket {
  const days = Math.floor((Date.now() - asOf.getTime()) / 86400000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function agingBucketLabel(bucket: AgingBucket): string {
  const labels: Record<AgingBucket, string> = {
    "0-30": "0–30 Days",
    "31-60": "31–60 Days",
    "61-90": "61–90 Days",
    "90+": "90+ Days",
  };
  return labels[bucket];
}
