"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, PackageCheck, Plus, RefreshCw, Search, Truck, XCircle } from "lucide-react";

type OrderStatus = "ORDER_RECEIVED" | "DISPATCHED" | "PENDING" | "PROCESSING" | "DELIVERED" | "CANCELLED";

type OrderRow = {
  id: string;
  orderDetails: string;
  preferredDeliveryDate: string | null;
  priority: string;
  status: OrderStatus;
  visitSource: string | null;
  sourceModule?: string | null;
  createdAt: string;
  deliveredAt: string | null;
  cancelledAt?: string | null;
  customer: { partyName: string; contactNumber: string };
  createdBy: { name: string; role: string };
};

type CustomerSuggestion = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
};

type Summary = {
  pendingOrders: number;
  dispatchedOrders: number;
  highPriorityOrders: number;
  deliveredToday: number;
  cancelledOrders: number;
  upcomingDeliveries: number;
};

const emptySummary: Summary = {
  pendingOrders: 0,
  dispatchedOrders: 0,
  highPriorityOrders: 0,
  deliveredToday: 0,
  cancelledOrders: 0,
  upcomingDeliveries: 0,
};

const filters = [
  { label: "All", value: "all" },
  { label: "Pending Orders", value: "pending" },
  { label: "Dispatched Orders", value: "dispatched" },
  { label: "Delivered Orders", value: "delivered" },
  { label: "Cancelled Orders", value: "cancelled" },
  { label: "High Priority", value: "high" },
  { label: "Upcoming Delivery", value: "upcoming" },
  { label: "Sales Visits", value: "sales" },
  { label: "Lead Orders", value: "lead" },
];

function normalizedStatus(status: OrderStatus) {
  if (status === "PENDING") return "ORDER_RECEIVED";
  if (status === "PROCESSING") return "DISPATCHED";
  return status;
}

function displayStatus(status: OrderStatus) {
  const normalized = normalizedStatus(status);
  if (normalized === "ORDER_RECEIVED") return "Order Received";
  if (normalized === "DISPATCHED") return "Dispatched";
  if (normalized === "DELIVERED") return "Delivered";
  return "Cancelled";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function toInputDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function datePayload(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
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
  const normalized = normalizedStatus(status);
  if (normalized === "DELIVERED") return "bg-emerald-100 text-emerald-800";
  if (normalized === "CANCELLED") return "bg-red-100 text-red-800";
  if (normalized === "DISPATCHED") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function canEdit(order: OrderRow) {
  return normalizedStatus(order.status) === "ORDER_RECEIVED";
}

function canDispatch(order: OrderRow) {
  return normalizedStatus(order.status) === "ORDER_RECEIVED";
}

function canDeliver(order: OrderRow) {
  return normalizedStatus(order.status) === "DISPATCHED";
}

function canCancel(order: OrderRow) {
  return !["DELIVERED", "CANCELLED"].includes(normalizedStatus(order.status));
}

export default function OrderDeskPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState("");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; order?: OrderRow } | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [orderDetails, setOrderDetails] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [priority, setPriority] = useState("Normal");
  const canManageOrders = role === "SHOP_ADMIN" || role === "STAFF";
  const canCreateOrders = canManageOrders;

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
    setSummary(data.summary ?? emptySummary);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRole(data?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  useEffect(() => {
    if (!editor || editor.mode !== "create") return;
    const queryText = customerQuery.trim();
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: queryText, limit: "8" });
      const res = await fetch(`/api/customers/search?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      setCustomerResults(data.customers ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerQuery, editor]);

  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.customer.partyName, order.customer.contactNumber, order.orderDetails, order.createdBy.name, order.visitSource ?? "", displayStatus(order.status)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [orders, query]);

  function openCreate() {
    setMessage("");
    setSelectedCustomer(null);
    setCustomerQuery("");
    setCustomerResults([]);
    setOrderDetails("");
    setDeliveryDate("");
    setPriority("Normal");
    setEditor({ mode: "create" });
  }

  function openEdit(order: OrderRow) {
    setMessage("");
    setOrderDetails(order.orderDetails);
    setDeliveryDate(toInputDate(order.preferredDeliveryDate));
    setPriority(order.priority);
    setEditor({ mode: "edit", order });
  }

  async function submitEditor() {
    if (!editor) return;
    setMessage("");
    const payload =
      editor.mode === "create"
        ? {
            customerId: selectedCustomer?.id,
            orderDetails,
            preferredDeliveryDate: datePayload(deliveryDate),
            priority,
          }
        : {
            orderId: editor.order?.id,
            action: "EDIT",
            orderDetails,
            preferredDeliveryDate: datePayload(deliveryDate),
            priority,
          };

    const res = await fetch("/api/orders", {
      method: editor.mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? "Could not save order.");
      return;
    }
    setEditor(null);
    await load();
  }

  async function runAction(orderId: string, action: "DISPATCH" | "DELIVER" | "CANCEL") {
    setMessage("");
    const res = await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, action }),
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
          <p className="text-slate-500">Centralized tracking for field, customer, and admin orders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateOrders && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" />
              New Order
            </button>
          )}
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending Orders" value={summary.pendingOrders} icon={<Clock className="h-5 w-5" />} />
        <Stat label="Dispatched" value={summary.dispatchedOrders} icon={<Truck className="h-5 w-5" />} />
        <Stat label="High Priority" value={summary.highPriorityOrders} icon={<PackageCheck className="h-5 w-5" />} />
        <Stat label="Delivered Today" value={summary.deliveredToday} icon={<CheckCircle2 className="h-5 w-5" />} />
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
          <article key={order.id} className={`rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${["DELIVERED", "CANCELLED"].includes(normalizedStatus(order.status)) ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">{order.customer.partyName}</h2>
                <p className="text-sm text-slate-500">{order.customer.contactNumber}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityClass(order.priority)}`}>{order.priority}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(order.status)}`}>{displayStatus(order.status)}</span>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{order.orderDetails}</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
              <span>Delivery: {formatDate(order.preferredDeliveryDate)}</span>
              <span>By: {order.createdBy.name}</span>
              <span>Source: {order.visitSource ?? order.sourceModule ?? "Field visit"}</span>
              <span>Order date: {formatDateTime(order.createdAt)}</span>
            </div>
            {canManageOrders && (
              <div className="mt-3 flex flex-wrap gap-2">
                {canEdit(order) && (
                  <button type="button" onClick={() => openEdit(order)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    Edit Order
                  </button>
                )}
                {canDispatch(order) && (
                  <button type="button" onClick={() => runAction(order.id, "DISPATCH")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">
                    Dispatch Order
                  </button>
                )}
                {canDeliver(order) && (
                  <button type="button" onClick={() => runAction(order.id, "DELIVER")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">
                    Mark Delivered
                  </button>
                )}
                {canCancel(order) && (
                  <button type="button" onClick={() => runAction(order.id, "CANCEL")} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">
                    Cancel Order
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {editor && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{editor.mode === "create" ? "New Order" : "Edit Order"}</h2>
                <p className="text-sm text-slate-500">Use free-text order details for fast field and counter entry.</p>
              </div>
              <button type="button" onClick={() => setEditor(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close order form">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {editor.mode === "create" && (
                <div>
                  <label className="text-sm font-semibold">Customer</label>
                  <input value={customerQuery} onChange={(e) => { setCustomerQuery(e.target.value); setSelectedCustomer(null); }} placeholder="Search customer or mobile" className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                  {selectedCustomer && <p className="mt-2 text-xs font-semibold text-emerald-700">Selected: {selectedCustomer.partyName} - {selectedCustomer.contactNumber}</p>}
                  {!selectedCustomer && customerResults.length > 0 && (
                    <div className="mt-2 max-h-48 overflow-auto rounded-lg border dark:border-slate-700">
                      {customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setCustomerQuery(`${customer.partyName} - ${customer.contactNumber}`);
                            setCustomerResults([]);
                          }}
                          className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 dark:border-slate-700"
                        >
                          <span className="font-semibold">{customer.partyName}</span>
                          <span className="block text-xs text-slate-500">{customer.contactNumber}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-sm font-semibold">Order Details</label>
                <textarea value={orderDetails} onChange={(e) => setOrderDetails(e.target.value)} rows={5} placeholder="Example: 100 bags cement + 20 steel rods" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold">Delivery Preferred Date</label>
                  <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                </div>
                <div>
                  <label className="text-sm font-semibold">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
                    <option>Normal</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold dark:border-slate-700">
                Cancel
              </button>
              <button type="button" onClick={submitEditor} disabled={!orderDetails.trim() || (editor.mode === "create" && !selectedCustomer)} className="rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                Save Order
              </button>
            </div>
          </div>
        </div>
      )}
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
