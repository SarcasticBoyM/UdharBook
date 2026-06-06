"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, PackageCheck, RefreshCw, Search } from "lucide-react";

type OrderStatus = "PENDING" | "PROCESSING" | "DELIVERED" | "CANCELLED";

type OrderRow = {
  id: string;
  orderDetails: string;
  preferredDeliveryDate: string | null;
  priority: string;
  status: OrderStatus;
  visitSource: string | null;
  createdAt: string;
  deliveredAt: string | null;
  customer: { partyName: string; contactNumber: string };
  createdBy: { name: string; role: string };
};

type Summary = {
  pendingOrders: number;
  highPriorityOrders: number;
  deliveredToday: number;
  upcomingDeliveries: number;
};

const filters = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Delivered", value: "delivered" },
  { label: "High Priority", value: "high" },
  { label: "Upcoming Delivery", value: "upcoming" },
  { label: "Sales Visits", value: "sales" },
  { label: "Lead Orders", value: "lead" },
];

const statuses: OrderStatus[] = ["PENDING", "PROCESSING", "DELIVERED", "CANCELLED"];

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function priorityClass(priority: string) {
  if (priority === "High") return "bg-red-100 text-red-800";
  if (priority === "Urgent") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function statusClass(status: OrderStatus) {
  if (status === "DELIVERED") return "bg-emerald-100 text-emerald-800";
  if (status === "CANCELLED") return "bg-slate-200 text-slate-600";
  if (status === "PROCESSING") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

export default function OrderDeskPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ pendingOrders: 0, highPriorityOrders: 0, deliveredToday: 0, upcomingDeliveries: 0 });
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/orders?filter=${filter}`);
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(data.error ?? "Could not load orders.");
      return;
    }
    setOrders(data.orders ?? []);
    setSummary(data.summary ?? summary);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.customer.partyName, order.customer.contactNumber, order.orderDetails, order.createdBy.name, order.visitSource ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [orders, query]);

  async function updateStatus(orderId: string, status: OrderStatus) {
    setMessage("");
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? "Could not update order.");
      return;
    }
    await load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Order Desk</h1>
          <p className="text-slate-500">Centralized tracking for sales, lead, and field visit orders.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending Orders" value={summary.pendingOrders} icon={<Clock className="h-5 w-5" />} />
        <Stat label="High Priority" value={summary.highPriorityOrders} icon={<PackageCheck className="h-5 w-5" />} />
        <Stat label="Delivered Today" value={summary.deliveredToday} icon={<CheckCircle2 className="h-5 w-5" />} />
        <Stat label="Upcoming Deliveries" value={summary.upcomingDeliveries} icon={<Clock className="h-5 w-5" />} />
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-semibold ${filter === item.value ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search orders, customers, mobile, staff" className="min-h-12 w-full rounded-lg border py-3 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
      </div>

      <div className="mt-4 space-y-3">
        {loading && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">Loading orders...</div>}
        {!loading && visibleOrders.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No orders found.</div>}
        {visibleOrders.map((order) => (
          <article key={order.id} className={`rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${order.status === "DELIVERED" || order.status === "CANCELLED" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">{order.customer.partyName}</h2>
                <p className="text-sm text-slate-500">{order.customer.contactNumber}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityClass(order.priority)}`}>{order.priority}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(order.status)}`}>{order.status.replace(/_/g, " ")}</span>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{order.orderDetails}</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
              <span>Delivery: {formatDate(order.preferredDeliveryDate)}</span>
              <span>By: {order.createdBy.name}</span>
              <span>Source: {order.visitSource ?? "Field visit"}</span>
              <span>Order date: {formatDateTime(order.createdAt)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {statuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => updateStatus(order.id, status)}
                  disabled={order.status === status}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-slate-700"
                >
                  {status.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{label}</p>
        <span className="text-brand-600">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
