import type { FollowUpStatus } from "@prisma/client";
import { isBefore, isToday, startOfDay } from "date-fns";

export function statusBadgeClass(status: FollowUpStatus): string {
  const map: Record<FollowUpStatus, string> = {
    PAID: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    PENDING: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    CONTACTED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    PAYMENT_PROMISED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    NOT_REACHABLE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status];
}

/** Row highlight: green paid, yellow due today, red overdue */
export function followupRowClass(
  status: FollowUpStatus,
  nextFollowupDate: Date | null | undefined
): string {
  if (status === "PAID") return "border-l-4 border-l-emerald-500";
  if (!nextFollowupDate) return "";
  const d = startOfDay(new Date(nextFollowupDate));
  const today = startOfDay(new Date());
  if (isToday(d)) return "border-l-4 border-l-amber-500";
  if (isBefore(d, today)) return "border-l-4 border-l-red-500";
  return "";
}

export function formatStatus(status: FollowUpStatus): string {
  return status.replace(/_/g, " ");
}
