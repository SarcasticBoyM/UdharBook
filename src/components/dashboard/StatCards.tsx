import { formatCurrency } from "@/lib/utils";
import type { DashboardStats } from "@/types";

export function StatCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Total Customers", value: stats.totalCustomers.toString() },
    { label: "Total Outstanding", value: formatCurrency(stats.totalOutstanding) },
    { label: "Recovered", value: formatCurrency(stats.recoveryAmount) },
    { label: "Pending Follow-up", value: stats.pendingFollowup.toString() },
    { label: "Today's Follow-ups", value: stats.todayFollowups.toString() },
    { label: "Overdue Follow-ups", value: stats.overdueFollowups.toString(), alert: stats.overdueFollowups > 0 },
    { label: "Pending Orders", value: stats.pendingOrders.toString() },
    { label: "High Priority Orders", value: stats.highPriorityOrders.toString(), alert: stats.highPriorityOrders > 0 },
    { label: "Delivered Today", value: stats.deliveredToday.toString() },
    { label: "Upcoming Deliveries", value: stats.upcomingDeliveries.toString() },
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
