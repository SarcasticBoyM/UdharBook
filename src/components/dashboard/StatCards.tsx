import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "@/types";

export function StatCards({ stats, secondaryLoading = false }: { stats: DashboardStats; secondaryLoading?: boolean }) {
  const cards = [
    { label: "Total Customers", value: stats.totalCustomers.toString() },
    { label: "Total Outstanding", value: formatCurrency(stats.totalOutstanding) },
    { label: "Recovered", value: formatCurrency(stats.recoveryAmount) },
    { label: "Pending Follow-up", value: stats.pendingFollowup.toString() },
    { label: "Today's Follow-ups", value: stats.todayFollowups.toString() },
    { label: "Today's Follow-up Amount", value: formatCurrency(stats.todayFollowupAmount) },
    { label: "Today's Cheques", value: stats.todayCheques.toString() },
    { label: "Today's Cheque Amount", value: formatCurrency(stats.todayChequeAmount) },
    { label: "Collected Cheques", value: stats.collectedCheques.toString() },
    { label: "Pending Deposit", value: stats.pendingDepositCheques.toString() },
    { label: "Deposited Cheques", value: stats.depositedCheques.toString() },
    { label: "Bounced Cheques", value: stats.bouncedCheques.toString(), alert: stats.bouncedCheques > 0 },
    { label: "Overdue Follow-ups", value: stats.overdueFollowups.toString(), alert: stats.overdueFollowups > 0 },
    { label: "Pending Orders", value: secondaryLoading ? "…" : stats.pendingOrders.toString() },
    { label: "High Priority Orders", value: secondaryLoading ? "…" : stats.highPriorityOrders.toString(), alert: !secondaryLoading && stats.highPriorityOrders > 0 },
    { label: "Delivered Today", value: secondaryLoading ? "…" : stats.deliveredToday.toString() },
    { label: "Upcoming Deliveries", value: secondaryLoading ? "…" : stats.upcomingDeliveries.toString() },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="card">
          <p className="text-sm text-slate-500">{c.label}</p>
          <p
            className={`mt-2 text-2xl font-bold ${c.alert ? "text-red-600" : ""}`}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
