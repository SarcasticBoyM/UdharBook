"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, Copy, Loader2, PackageCheck, Plus, RefreshCw, Search, Share2, Truck, XCircle } from "lucide-react";
import { canUseOrders } from "@/lib/permissions";
import { isShopAdminRole } from "@/lib/operational-roles";
import { AssignTaskButton } from "@/components/AssignTaskDialog";
import { AppDatePicker } from "@/components/AppDateTimePicker";
import { currentIstDate, istDateTimeToIso } from "@/lib/app-date-time";
import { extractOrderQuantity } from "@/lib/order-quantity";

type OrderStatus = "ORDER_RECEIVED" | "DISPATCHED" | "PENDING" | "PROCESSING" | "DELIVERED" | "CANCELLED" | (string & {});

type OrderRow = {
  id: string;
  orderDetails: string;
  preferredDeliveryDate: string | null;
  deliveryLocationText?: string | null;
  deliveryLocationUrl?: string | null;
  priority: string;
  status: OrderStatus;
  visitSource: string | null;
  sourceModule?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  deliveredAt: string | null;
  cancelledAt?: string | null;
  customer: { id: string; partyName: string; contactNumber: string; batchTag?: string | null } | null;
  customerMatchStatus?: string | null;
  submittedCustomerName?: string | null;
  submittedCustomerMobile?: string | null;
  submittedAddress?: string | null;
  createdBy: { name: string; role?: string };
  activities?: { action: string; newStatus?: OrderStatus | null; createdAt: string; user: { name: string; role?: string } }[];
};

type CustomerMode = "existing" | "new";

type CustomerSuggestion = {
  id: string;
  partyName: string;
  contactNumber: string;
  batchTag?: string | null;
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

type MatchCustomer = { id: string; partyName: string; contactNumber: string; batchTag?: string | null };

type ClubFilter = "all" | "pending" | "dispatched";
type DateFilter = "all" | "today" | "yesterday" | "last7days" | "thisMonth" | "custom";
type StructuredOrderItem = { material: string; qty: string };
type OrderShareSource = Partial<OrderRow> & {
  customerName?: string | null;
  partyName?: string | null;
  contactNumber?: string | null;
  mobile?: string | null;
  orderText?: string | null;
  itemsText?: string | null;
  description?: string | null;
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

const filterValues = new Set(filters.map((item) => item.value));

const dateFilterOptions: { label: string; value: DateFilter }[] = [
  { label: "All Dates", value: "all" },
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last7days" },
  { label: "This Month", value: "thisMonth" },
  { label: "Custom Range", value: "custom" },
];

const safeText = (value: unknown) => value ? String(value).trim() : "";

function cleanContact(contact: unknown) {
  const value = String(contact || "").trim();
  if (!value) return "";
  if (value.toUpperCase().startsWith("NO-PH-")) return "";
  if (["undefined", "null", "nan"].includes(value.toLowerCase())) return "";
  return value;
}

function orderCustomerName(order: OrderRow) {
  return order.customer?.partyName || order.submittedCustomerName || "Customer";
}

function orderCustomerContact(order: OrderRow) {
  return order.customer?.contactNumber || order.submittedCustomerMobile || "";
}

function orderCustomerBatch(order: OrderRow) {
  return order.customer?.batchTag ?? "";
}

function orderMatchLabel(status?: string | null) {
  if (status === "AUTO_MATCHED") return "Auto matched";
  if (status === "NEW_CREATED") return "New customer created";
  if (status === "REVIEW_REQUIRED") return "Customer match review required";
  if (status === "UNLINKED") return "Kept unlinked";
  return "";
}

function buildOrderShareText(order: OrderShareSource) {
  const customerName = String(order.customerName || order.customer?.partyName || order.submittedCustomerName || order.partyName || "").trim();
  const contact = cleanContact(order.contactNumber || order.mobile || order.customer?.contactNumber || order.submittedCustomerMobile);
  const orderText = String(order.orderText || order.itemsText || order.description || order.orderDetails || "").trim();
  const deliveryLocation = String(order.deliveryLocationText || order.deliveryLocationUrl || "").trim();
  const deliveryLine = deliveryLocation ? `Delivery Location: ${deliveryLocation}` : "";
  return [customerName, contact, orderText, deliveryLine].filter(Boolean).join("\n");
}

function deliveryLocationLabel(order: Pick<OrderRow, "deliveryLocationText" | "deliveryLocationUrl">) {
  if (order.deliveryLocationText) return order.deliveryLocationText;
  if (order.deliveryLocationUrl) return "Map link added";
  return "";
}

function normalizedStatus(status: OrderStatus) {
  if (["PENDING", "CONFIRMED", "READY", "READY_TO_DISPATCH"].includes(status)) return "ORDER_RECEIVED";
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
  return value ? istDateTimeToIso(`${value}T00:00`) : null;
}

function todayInputDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function addInputDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function monthStartInputDate(value: string) {
  return `${value.slice(0, 8)}01`;
}

function isDateBetween(value: string, from: string, to: string) {
  return value >= from && value <= to;
}

function dateFilterEndDate(dateFilter: DateFilter, fromDate: string, toDate: string) {
  const today = todayInputDate();
  if (dateFilter === "today") return today;
  if (dateFilter === "yesterday") return addInputDays(today, -1);
  if (dateFilter === "last7days") return today;
  if (dateFilter === "thisMonth") return today;
  if (dateFilter === "custom") return toDate || fromDate;
  return "";
}

function dateMatchesFilter(value: string, dateFilter: DateFilter, fromDate: string, toDate: string) {
  if (dateFilter === "all") return true;
  const today = todayInputDate();
  if (dateFilter === "today") return value === today;
  if (dateFilter === "yesterday") return value === addInputDays(today, -1);
  if (dateFilter === "last7days") return isDateBetween(value, addInputDays(today, -6), today);
  if (dateFilter === "thisMonth") return isDateBetween(value, monthStartInputDate(today), today);
  return Boolean(fromDate && toDate && isDateBetween(value, fromDate, toDate));
}

function latestActivityDate(order: OrderRow, status: OrderStatus) {
  return order.activities?.find((activity) => activity.newStatus === status)?.createdAt ?? null;
}

function statusEventDate(order: OrderRow, filter: string) {
  if (filter === "dispatched") return latestActivityDate(order, "DISPATCHED") ?? order.updatedAt ?? order.createdAt;
  if (filter === "delivered") return order.deliveredAt ?? latestActivityDate(order, "DELIVERED") ?? order.updatedAt ?? order.createdAt;
  if (filter === "cancelled") return order.cancelledAt ?? latestActivityDate(order, "CANCELLED") ?? order.updatedAt ?? order.createdAt;
  if (filter === "upcoming") return order.preferredDeliveryDate;
  return order.createdAt;
}

function orderMatchesDateFilter(order: OrderRow, filter: string, dateFilter: DateFilter, fromDate: string, toDate: string) {
  if (dateFilter === "all") return true;
  if (filter === "pending") {
    const endDate = dateFilterEndDate(dateFilter, fromDate, toDate);
    return Boolean(endDate && toInputDate(order.createdAt) <= endDate);
  }
  const filterDate = toInputDate(statusEventDate(order, filter));
  return Boolean(filterDate && dateMatchesFilter(filterDate, dateFilter, fromDate, toDate));
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isReceivedOrder(status: OrderStatus) {
  return normalizedStatus(status) === "ORDER_RECEIVED";
}

function isDispatchedOrder(status: OrderStatus) {
  return normalizedStatus(status) === "DISPATCHED";
}

function isActiveOrder(status: OrderStatus) {
  const normalized = normalizedStatus(status);
  return normalized !== "DELIVERED" && normalized !== "CANCELLED";
}

function orderMatchesFilter(order: OrderRow, filter: string) {
  if (filter === "pending") return isReceivedOrder(order.status);
  if (filter === "dispatched") return isDispatchedOrder(order.status);
  if (filter === "delivered") return normalizedStatus(order.status) === "DELIVERED";
  if (filter === "cancelled") return normalizedStatus(order.status) === "CANCELLED";
  if (filter === "high") return order.priority === "High";
  if (filter === "sales") return order.visitSource === "Sales Visit";
  if (filter === "lead") return order.visitSource === "New Lead Visit" || order.visitSource === "Prospect Visit";
  if (filter === "upcoming") {
    if (!order.preferredDeliveryDate || !isActiveOrder(order.status)) return false;
    const delivery = new Date(order.preferredDeliveryDate).getTime();
    const now = Date.now();
    return delivery >= now && delivery <= now + 7 * 24 * 60 * 60 * 1000;
  }
  return true;
}

function filterEmptyLabel(filter: string, dateFilter: DateFilter) {
  if (filter === "pending") return "No pending orders found.";
  if (filter === "dispatched" && dateFilter === "today") return "No orders dispatched today.";
  if (filter === "dispatched" && dateFilter === "yesterday") return "No orders dispatched yesterday.";
  if (filter === "dispatched") return "No dispatched orders found for selected date filter.";
  if (filter === "delivered" && dateFilter === "today") return "No orders delivered today.";
  if (filter === "delivered" && dateFilter === "yesterday") return "No orders delivered yesterday.";
  if (filter === "delivered") return "No delivered orders found for selected date filter.";
  if (filter === "cancelled") return "No cancelled orders found for selected date filter.";
  if (filter === "high") return "No high priority orders found for selected date filter.";
  if (filter === "upcoming") return "No upcoming delivery orders found for selected date filter.";
  if (filter === "sales") return "No sales visit orders found for selected date filter.";
  if (filter === "lead") return "No lead orders found for selected date filter.";
  return "No orders found for selected date filter.";
}

function orderSummaryContribution(order: OrderRow): Summary {
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const delivery = order.preferredDeliveryDate ? new Date(order.preferredDeliveryDate).getTime() : null;
  const now = Date.now();
  return {
    pendingOrders: isReceivedOrder(order.status) ? 1 : 0,
    dispatchedOrders: isDispatchedOrder(order.status) ? 1 : 0,
    highPriorityOrders: isActiveOrder(order.status) && order.priority === "High" ? 1 : 0,
    deliveredToday: normalizedStatus(order.status) === "DELIVERED" && deliveredAt && deliveredAt.getTime() >= todayStart ? 1 : 0,
    cancelledOrders: normalizedStatus(order.status) === "CANCELLED" ? 1 : 0,
    upcomingDeliveries: isActiveOrder(order.status) && delivery !== null && delivery >= now && delivery <= now + 7 * 24 * 60 * 60 * 1000 ? 1 : 0,
  };
}

function applySummaryChange(summary: Summary, before: OrderRow | null, after: OrderRow | null) {
  const remove = before ? orderSummaryContribution(before) : emptySummary;
  const add = after ? orderSummaryContribution(after) : emptySummary;
  return {
    pendingOrders: Math.max(0, summary.pendingOrders - remove.pendingOrders + add.pendingOrders),
    dispatchedOrders: Math.max(0, summary.dispatchedOrders - remove.dispatchedOrders + add.dispatchedOrders),
    highPriorityOrders: Math.max(0, summary.highPriorityOrders - remove.highPriorityOrders + add.highPriorityOrders),
    deliveredToday: Math.max(0, summary.deliveredToday - remove.deliveredToday + add.deliveredToday),
    cancelledOrders: Math.max(0, summary.cancelledOrders - remove.cancelledOrders + add.cancelledOrders),
    upcomingDeliveries: Math.max(0, summary.upcomingDeliveries - remove.upcomingDeliveries + add.upcomingDeliveries),
  };
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

function orderStatusRank(status: OrderStatus) {
  const normalized = normalizedStatus(status);
  if (normalized === "ORDER_RECEIVED") return 0;
  if (normalized === "DISPATCHED") return 1;
  if (normalized === "DELIVERED") return 2;
  if (normalized === "CANCELLED") return 3;
  return 4;
}

function orderCreatedAtTime(order: OrderRow) {
  const time = new Date(order.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function statusAwareSort(orders: OrderRow[]) {
  return [...orders].sort((left, right) => {
    const statusDifference = orderStatusRank(left.status) - orderStatusRank(right.status);
    if (statusDifference !== 0) return statusDifference;
    return orderCreatedAtTime(right) - orderCreatedAtTime(left);
  });
}

function orderCardClass(status: OrderStatus) {
  const base = "rounded-lg border p-4 shadow-sm transition-colors";
  const normalized = normalizedStatus(status);
  if (normalized === "ORDER_RECEIVED") {
    return `${base} border-emerald-100 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20`;
  }
  if (normalized === "DISPATCHED") {
    return `${base} border-slate-200 border-l-4 border-l-blue-200 bg-white dark:border-slate-800 dark:border-l-indigo-800 dark:bg-slate-900`;
  }
  if (normalized === "CANCELLED") {
    return `${base} border-rose-100 border-l-4 border-l-rose-200 bg-white opacity-80 dark:border-rose-950/70 dark:border-l-rose-900 dark:bg-slate-900`;
  }
  return `${base} border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900`;
}

function canEdit(order: OrderRow) {
  return ["ORDER_RECEIVED", "DISPATCHED"].includes(normalizedStatus(order.status));
}

function canDispatch(order: OrderRow) {
  return normalizedStatus(order.status) === "ORDER_RECEIVED";
}

function canClubOrder(order: OrderRow) {
  return normalizedStatus(order.status) === "ORDER_RECEIVED";
}

function isClubEligible(order: OrderRow) {
  const normalized = normalizedStatus(order.status);
  return normalized === "ORDER_RECEIVED" || normalized === "DISPATCHED";
}

function orderQuantity(order: OrderRow) {
  const structuredOrder = order as OrderRow & { quantity?: unknown; items?: { quantity?: unknown }[] };
  if (Array.isArray(structuredOrder.items)) {
    return structuredOrder.items.reduce((total, item) => {
      const quantity = Number(item.quantity);
      return total + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);
  }
  const quantity = Number(structuredOrder.quantity);
  if (Number.isFinite(quantity) && quantity > 0) return quantity;
  return extractOrderQuantity(order.orderDetails);
}

function cleanQty(value: string) {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function structuredItemsToText(items: StructuredOrderItem[]) {
  return items
    .map((item) => {
      const material = safeText(item.material);
      const qty = cleanQty(item.qty);
      return material && qty ? `${material} - ${qty}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function emptyStructuredItems(): StructuredOrderItem[] {
  return [{ material: "", qty: "" }];
}

function canDeliver(order: OrderRow) {
  return normalizedStatus(order.status) === "DISPATCHED";
}

function canCancel(order: OrderRow) {
  return !["DELIVERED", "CANCELLED"].includes(normalizedStatus(order.status));
}

function dateFilterLabel(filter: string) {
  if (filter === "pending") return "PENDING AS ON";
  if (filter === "dispatched") return "DISPATCH DATE";
  if (filter === "delivered") return "DELIVERY DATE";
  if (filter === "cancelled") return "CANCEL DATE";
  if (filter === "upcoming") return "DELIVERY DATE";
  return "ORDER DATE";
}

export default function OrderDeskPage() {
  const searchParams = useSearchParams();
  const highlightedId = searchParams.get("highlight");
  const initialDateFilter = dateFilterOptions.some((option) => option.value === searchParams.get("dateFilter"))
    ? searchParams.get("dateFilter") as DateFilter
    : "all";
  const initialFilter = filterValues.has(searchParams.get("filter") ?? "")
    ? searchParams.get("filter")!
    : "all";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [filter, setFilter] = useState(initialFilter);
  const [dateFilter, setDateFilter] = useState<DateFilter>(initialDateFilter);
  const [fromDate, setFromDate] = useState(searchParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(searchParams.get("toDate") ?? "");
  const [draftFromDate, setDraftFromDate] = useState(searchParams.get("fromDate") ?? "");
  const [draftToDate, setDraftToDate] = useState(searchParams.get("toDate") ?? "");
  const [customDateOpen, setCustomDateOpen] = useState(initialDateFilter === "custom");
  const [query, setQuery] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [cancelOrder, setCancelOrder] = useState<OrderRow | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<OrderRow | null>(null);
  const [deliveredDate, setDeliveredDate] = useState("");
  const [savingOrder, setSavingOrder] = useState(false);
  const [role, setRole] = useState("");
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; order?: OrderRow } | null>(null);
  const [sharePromptOrder, setSharePromptOrder] = useState<OrderRow | null>(null);
  const [clubOpen, setClubOpen] = useState(false);
  const [clubOrders, setClubOrders] = useState<OrderRow[]>([]);
  const [clubSelected, setClubSelected] = useState<Set<string>>(new Set());
  const [clubSearch, setClubSearch] = useState("");
  const [clubFilter, setClubFilter] = useState<ClubFilter>("all");
  const [clubLoading, setClubLoading] = useState(false);
  const [clubSaving, setClubSaving] = useState(false);
  const [clubError, setClubError] = useState("");
  const [publicLinkOpen, setPublicLinkOpen] = useState(false);
  const [publicOrderUrl, setPublicOrderUrl] = useState("");
  const [publicOrderEnabled, setPublicOrderEnabled] = useState(true);
  const [publicLinkLoading, setPublicLinkLoading] = useState(false);
  const [publicLinkSaving, setPublicLinkSaving] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState("");
  const [matchOrder, setMatchOrder] = useState<OrderRow | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchSaving, setMatchSaving] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [matchCustomers, setMatchCustomers] = useState<MatchCustomer[]>([]);
  const [selectedMatchCustomerId, setSelectedMatchCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [customerMode, setCustomerMode] = useState<CustomerMode>("existing");
  const [newCustomer, setNewCustomer] = useState({ partyName: "", contactNumber: "", address: "", area: "", gstNumber: "", notes: "" });
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [duplicateCustomer, setDuplicateCustomer] = useState<CustomerSuggestion | null>(null);
  const [orderDetails, setOrderDetails] = useState("");
  const [structuredItems, setStructuredItems] = useState<StructuredOrderItem[]>(emptyStructuredItems);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [priority, setPriority] = useState("Normal");
  const loadAbortRef = useRef<AbortController | null>(null);
  const cancelDialogRef = useRef<HTMLDivElement | null>(null);
  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canManageOrders = canUseOrders(role);
  const canCreateOrders = canManageOrders;
  const canAssignTasks = isShopAdminRole(role);

  function showToast(text: string, duration = 1800) {
    setToast(text);
    window.setTimeout(() => setToast((current) => current === text ? "" : current), duration);
  }

  async function copyOrder(order: OrderRow) {
    await navigator.clipboard.writeText(buildOrderShareText(order));
    showToast("Order copied");
  }

  async function shareOrderToWhatsApp(order: OrderRow) {
    const text = buildOrderShareText(order);
    if (!text) {
      showToast("Nothing to share");
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ text });
        showToast("Share options opened");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    const opened = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    showToast(opened ? "WhatsApp opened" : "Could not open WhatsApp");
  }

  const activeDateLabel = useMemo(() => {
    const label = dateFilterLabel(filter);
    if (dateFilter === "custom" && fromDate && toDate) return `${label}: ${formatDate(fromDate)} - ${formatDate(toDate)}`;
    const option = dateFilterOptions.find((item) => item.value === dateFilter);
    return `${label}: ${option?.label ?? "All Dates"}`;
  }, [dateFilter, filter, fromDate, toDate]);

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ filter, dateFilter });
      if (dateFilter === "custom") {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      }
      const res = await fetch(`/api/orders?${params.toString()}`, { signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok || data.success === false) {
        console.error("[Order Desk] load failed", { status: res.status, data });
        setMessage(data.error ?? "Could not load orders.");
        setOrders([]);
        setSummary(data.summary ?? emptySummary);
        return;
      }
      console.info("[Order Desk] load success", { count: data.orders?.length ?? 0, summary: data.summary });
      setMessage("");
      setOrders(data.orders ?? []);
      setSummary(data.summary ?? emptySummary);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setMessage("Could not load orders. Check your connection and retry.");
    } finally {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [dateFilter, filter, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!cancelOrder) return;
    cancelDialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && actionLoading !== `${cancelOrder.id}:CANCEL`) {
        setCancelOrder(null);
        cancelTriggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actionLoading, cancelOrder]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (filter === "all") params.delete("filter");
    else params.set("filter", filter);
    if (dateFilter === "all") {
      params.delete("dateFilter");
      params.delete("fromDate");
      params.delete("toDate");
    } else {
      params.set("dateFilter", dateFilter);
      if (dateFilter === "custom") {
        params.set("fromDate", fromDate);
        params.set("toDate", toDate);
      } else {
        params.delete("fromDate");
        params.delete("toDate");
      }
    }
    const queryString = params.toString();
    window.history.replaceState(window.history.state, "", queryString ? `/orders?${queryString}` : "/orders");
  }, [dateFilter, filter, fromDate, toDate]);

  useEffect(() => {
    if (!highlightedId || !orders.some((order) => order.id === highlightedId)) return;
    window.setTimeout(() => {
      document.getElementById(`order-${highlightedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, [highlightedId, orders]);

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
      [orderCustomerName(order), orderCustomerBatch(order), orderCustomerContact(order), order.orderDetails, order.createdBy.name, order.visitSource ?? "", displayStatus(order.status)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [orders, query]);
  const filteredOrders = useMemo(() => {
    const tag = batchFilter.trim().toLowerCase();
    const list = tag
      ? visibleOrders.filter((order) => orderCustomerBatch(order).toLowerCase().includes(tag))
      : visibleOrders;
    return statusAwareSort(list);
  }, [batchFilter, visibleOrders]);

  const clubVisibleOrders = useMemo(() => {
    const needle = clubSearch.trim().toLowerCase();
    return clubOrders.filter((order) => {
      if (!isClubEligible(order)) return false;
      const normalized = normalizedStatus(order.status);
      if (clubFilter === "pending" && normalized !== "ORDER_RECEIVED") return false;
      if (clubFilter === "dispatched" && normalized !== "DISPATCHED") return false;
      if (!needle) return true;
      return [orderCustomerName(order), orderCustomerContact(order), order.orderDetails]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [clubFilter, clubOrders, clubSearch]);

  const selectedClubOrders = useMemo(
    () => clubOrders.filter((order) => clubSelected.has(order.id)),
    [clubOrders, clubSelected]
  );
  const clubTotalQty = useMemo(
    () => selectedClubOrders.reduce((total, order) => total + orderQuantity(order), 0),
    [selectedClubOrders]
  );
  const orderDetailsQty = useMemo(() => extractOrderQuantity(orderDetails), [orderDetails]);

  async function openClubDispatch(seedOrder: OrderRow) {
    setClubOpen(true);
    setClubError("");
    setClubSearch("");
    setClubFilter("all");
    setClubSelected(new Set([seedOrder.id]));
    setClubOrders((current) => {
      const merged = new Map<string, OrderRow>();
      for (const order of [...orders, ...current, seedOrder]) {
        if (isClubEligible(order)) merged.set(order.id, order);
      }
      return Array.from(merged.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
    setClubLoading(true);
    try {
      const res = await fetch("/api/orders?filter=all");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClubError(data.error ?? "Could not load orders for club dispatch.");
        return;
      }
      const eligible = ((data.orders ?? []) as OrderRow[])
        .filter(isClubEligible)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setClubOrders(eligible);
      setClubSelected((current) => new Set(current.has(seedOrder.id) ? current : [seedOrder.id]));
    } catch {
      setClubError("Could not load orders for club dispatch. Check your connection and retry.");
    } finally {
      setClubLoading(false);
    }
  }

  function toggleClubOrder(orderId: string) {
    setClubSelected((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  async function submitClubDispatch() {
    if (clubSaving || clubSelected.size === 0) return;
    setClubSaving(true);
    setClubError("");
    try {
      const selectedOrderIds = Array.from(clubSelected);
      const res = await fetch("/api/orders/club-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrderIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        if (process.env.NODE_ENV !== "production" && data.debug) {
          console.info("[Club Dispatch] failure debug", data.debug);
        }
        setClubError(data.error ?? data.detail ?? "Could not dispatch selected orders.");
        return;
      }
      const updatedOrders = (data.orders ?? []) as OrderRow[];
      setOrders((current) =>
        current
          .map((order) => {
            const updated = updatedOrders.find((item) => item.id === order.id);
            return updated ? { ...order, ...updated, activities: order.activities } : order;
          })
          .filter((order) => orderMatchesFilter(order, filter) && orderMatchesDateFilter(order, filter, dateFilter, fromDate, toDate))
      );
      setSummary((current) => {
        let next = current;
        for (const updated of updatedOrders) {
          const before = clubOrders.find((order) => order.id === updated.id) ?? orders.find((order) => order.id === updated.id) ?? null;
          if (before && isReceivedOrder(before.status) && isDispatchedOrder(updated.status)) {
            next = applySummaryChange(next, before, updated);
          }
        }
        return next;
      });
      setClubOpen(false);
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      const updatedCount = Number(data.updatedCount ?? 0);
      const alreadyDispatchedCount = Number(data.alreadyDispatchedCount ?? 0);
      setToast(
        skippedCount > 0
          ? "Some orders were skipped"
          : updatedCount === 0 && alreadyDispatchedCount > 0
            ? "Selected orders are already dispatched"
            : "Selected orders dispatched"
      );
      window.setTimeout(() => setToast((current) => current ? "" : current), 2200);
    } catch {
      setClubError("Could not dispatch selected orders. Check your connection and retry.");
    } finally {
      setClubSaving(false);
    }
  }

  function updateStructuredItem(index: number, patch: Partial<StructuredOrderItem>) {
    setStructuredItems((current) => {
      const next = current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
      const generated = structuredItemsToText(next);
      if (generated) setOrderDetails(generated);
      return next;
    });
  }

  function addStructuredItem() {
    setStructuredItems((current) => [...current, { material: "", qty: "" }]);
  }

  function removeStructuredItem(index: number) {
    setStructuredItems((current) => {
      const next = current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : emptyStructuredItems();
      const generated = structuredItemsToText(next);
      if (generated) setOrderDetails(generated);
      return next;
    });
  }

  function openCreate() {
    setMessage("");
    setSelectedCustomer(null);
    setCustomerMode("existing");
    setCustomerQuery("");
    setCustomerResults([]);
    setNewCustomer({ partyName: "", contactNumber: "", address: "", area: "", gstNumber: "", notes: "" });
    setMoreDetailsOpen(false);
    setDuplicateCustomer(null);
    setOrderDetails("");
    setStructuredItems(emptyStructuredItems());
    setDeliveryDate("");
    setDeliveryLocation("");
    setPriority("Normal");
    setEditor({ mode: "create" });
  }

  function openEdit(order: OrderRow) {
    setMessage("");
    const status = normalizedStatus(order.status);
    if (status === "DELIVERED") {
      setMessage("Delivered orders cannot be edited.");
      return;
    }
    if (status === "CANCELLED") {
      setMessage("Cancelled orders cannot be edited.");
      return;
    }
    if (!canEdit(order)) {
      setMessage("Only pre-delivery orders can be edited.");
      return;
    }
    setOrderDetails(order.orderDetails);
    setStructuredItems(emptyStructuredItems());
    setDeliveryDate(toInputDate(order.preferredDeliveryDate));
    setDeliveryLocation(order.deliveryLocationText ?? order.deliveryLocationUrl ?? "");
    setPriority(order.priority);
    setMoreDetailsOpen(false);
    setEditor({ mode: "edit", order });
  }

  async function submitEditor() {
    if (!editor || savingOrder) return;
    setMessage("");
    setSavingOrder(true);
    const clientRequestId = crypto.randomUUID();
    const payload =
      editor.mode === "create"
        ? customerMode === "existing"
          ? {
              customerId: selectedCustomer?.id,
              customerMode: "EXISTING_CUSTOMER",
              orderDetails,
              preferredDeliveryDate: datePayload(deliveryDate),
              deliveryLocation,
              priority,
              clientRequestId,
            }
          : {
              customerMode: "NEW_CUSTOMER",
              newCustomer,
              orderDetails,
              preferredDeliveryDate: datePayload(deliveryDate),
              deliveryLocation,
              priority,
              clientRequestId,
            }
        : {
            orderId: editor.order?.id,
            action: "EDIT",
            orderDetails,
            preferredDeliveryDate: datePayload(deliveryDate),
            deliveryLocation,
            priority,
          };

    try {
      const res = await fetch("/api/orders", {
        method: editor.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.existingCustomer) {
          setDuplicateCustomer(data.existingCustomer);
        }
        setMessage(data.error ?? "Could not save order.");
        return;
      }
      setEditor(null);
      const savedOrder = data.order as OrderRow | undefined;
      if (savedOrder) {
        setOrders((current) => {
          if (editor.mode === "edit") {
            return current
              .map((order) => order.id === savedOrder.id ? { ...order, ...savedOrder, activities: order.activities } : order)
              .filter((order) => orderMatchesFilter(order, filter) && orderMatchesDateFilter(order, filter, dateFilter, fromDate, toDate));
          }
          return orderMatchesFilter(savedOrder, filter) && orderMatchesDateFilter(savedOrder, filter, dateFilter, fromDate, toDate) ? [savedOrder, ...current] : current;
        });
        setSummary((current) =>
          editor.mode === "create" && orderMatchesDateFilter(savedOrder, filter, dateFilter, fromDate, toDate)
            ? applySummaryChange(current, null, savedOrder)
            : current
        );
        if (editor.mode === "create") setSharePromptOrder(savedOrder);
      } else {
        await load();
      }
    } catch {
      setMessage("Could not save order. Check your connection and retry.");
    } finally {
      setSavingOrder(false);
    }
  }

  async function runAction(orderId: string, action: "DISPATCH" | "DELIVER" | "CANCEL", extraBody: Record<string, string> = {}) {
    if (actionLoading) return false;
    setMessage("");
    setActionLoading(`${orderId}:${action}`);
    console.info("[Order Desk] action start", { orderId, action });
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action, ...extraBody }),
      });
      const data = await res.json().catch(() => ({}));
      console.info("[Order Desk] action response", { orderId, action, ok: res.ok, status: res.status, data });
      if (!res.ok) {
        setMessage(data.error ?? (action === "CANCEL" ? "Could not cancel order. Please try again." : "Could not update order."));
        return false;
      }
      const updatedOrder = data.order as OrderRow | undefined;
      if (!updatedOrder) {
        await load();
        return true;
      }
      const previousOrder = orders.find((order) => order.id === orderId) ?? null;
      setOrders((current) => current
        .map((order) => order.id === orderId ? { ...order, ...updatedOrder, activities: order.activities } : order)
        .filter((order) => orderMatchesFilter(order, filter) && orderMatchesDateFilter(order, filter, dateFilter, fromDate, toDate)));
      setSummary((current) => applySummaryChange(current, previousOrder, updatedOrder));
      return true;
    } catch {
      setMessage(action === "CANCEL" ? "Could not cancel order. Check your connection and retry." : "Could not update order. Check your connection and retry.");
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  function closeCancelDialog() {
    if (cancelOrder && actionLoading === `${cancelOrder.id}:CANCEL`) return;
    setCancelOrder(null);
    window.setTimeout(() => cancelTriggerRef.current?.focus(), 0);
  }

  async function confirmCancel() {
    if (!cancelOrder || actionLoading) return;
    const cancelled = await runAction(cancelOrder.id, "CANCEL");
    if (!cancelled) return;
    setCancelOrder(null);
    showToast("Order cancelled.");
    window.setTimeout(() => cancelTriggerRef.current?.focus(), 0);
  }

  async function confirmDelivered() {
    if (!deliverOrder || !deliveredDate || actionLoading) return;
    const delivered = await runAction(deliverOrder.id, "DELIVER", { deliveredDate });
    if (!delivered) return;
    setDeliverOrder(null);
    showToast("Order marked delivered.");
  }

  function selectDateFilter(value: DateFilter) {
    if (value === "custom") {
      setCustomDateOpen(true);
      return;
    }
    setDateFilter(value);
    setFromDate("");
    setToDate("");
    setDraftFromDate("");
    setDraftToDate("");
    setCustomDateOpen(false);
  }

  function applyCustomDateFilter() {
    if (!draftFromDate || !draftToDate) {
      setMessage("Select both from and to dates.");
      return;
    }
    if (draftFromDate > draftToDate) {
      setMessage("From date cannot be after to date.");
      return;
    }
    setMessage("");
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setDateFilter("custom");
    setCustomDateOpen(false);
  }

  function clearDateFilter() {
    setDateFilter("all");
    setFromDate("");
    setToDate("");
    setDraftFromDate("");
    setDraftToDate("");
    setCustomDateOpen(false);
  }

  async function loadPublicOrderLink() {
    setPublicLinkOpen(true);
    setPublicLinkLoading(true);
    setPublicLinkError("");
    try {
      const res = await fetch("/api/orders/public-link");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setPublicLinkError(data.error ?? "Could not load customer order link.");
        return;
      }
      setPublicOrderUrl(data.url ?? "");
      setPublicOrderEnabled(Boolean(data.isEnabled));
    } catch {
      setPublicLinkError("Could not load customer order link. Check your connection and retry.");
    } finally {
      setPublicLinkLoading(false);
    }
  }

  async function copyPublicOrderLink() {
    if (!publicOrderUrl) return;
    await navigator.clipboard.writeText(publicOrderUrl);
    showToast("Order link copied");
  }

  async function sharePublicOrderLink() {
    if (!publicOrderUrl) return;
    if (navigator.share) {
      await navigator.share({ text: publicOrderUrl, url: publicOrderUrl });
      return;
    }
    await copyPublicOrderLink();
  }

  async function setPublicOrderLinkEnabled(isEnabled: boolean) {
    setPublicLinkSaving(true);
    setPublicLinkError("");
    try {
      const res = await fetch("/api/orders/public-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setPublicLinkError(data.error ?? "Could not update customer order link.");
        return;
      }
      setPublicOrderUrl(data.url ?? "");
      setPublicOrderEnabled(Boolean(data.isEnabled));
      showToast(isEnabled ? "Order link enabled" : "Order link disabled");
    } catch {
      setPublicLinkError("Could not update customer order link. Check your connection and retry.");
    } finally {
      setPublicLinkSaving(false);
    }
  }

  async function regeneratePublicOrderLink() {
    if (!window.confirm("Regenerate this customer order link? The old link will stop working.")) return;
    setPublicLinkSaving(true);
    setPublicLinkError("");
    try {
      const res = await fetch("/api/orders/public-link/regenerate", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setPublicLinkError(data.error ?? "Could not regenerate customer order link.");
        return;
      }
      setPublicOrderUrl(data.url ?? "");
      setPublicOrderEnabled(Boolean(data.isEnabled));
      showToast("Order link regenerated");
    } catch {
      setPublicLinkError("Could not regenerate customer order link. Check your connection and retry.");
    } finally {
      setPublicLinkSaving(false);
    }
  }

  async function openMatchCustomer(order: OrderRow) {
    setMatchOrder(order);
    setSelectedMatchCustomerId("");
    setMatchCustomers([]);
    setMatchError("");
    setMatchLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/customer-matches`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setMatchError(data.error ?? "Could not load customer matches.");
        return;
      }
      setMatchCustomers(data.matches ?? []);
      setSelectedMatchCustomerId(data.matches?.[0]?.id ?? "");
    } catch {
      setMatchError("Could not load customer matches. Check your connection and retry.");
    } finally {
      setMatchLoading(false);
    }
  }

  async function submitCustomerMatch(action: "LINK_EXISTING" | "CREATE_NEW" | "KEEP_UNLINKED") {
    if (!matchOrder || matchSaving) return;
    setMatchSaving(true);
    setMatchError("");
    try {
      const res = await fetch(`/api/orders/${matchOrder.id}/match-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, customerId: action === "LINK_EXISTING" ? selectedMatchCustomerId : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setMatchError(data.error ?? "Could not match customer.");
        return;
      }
      const updatedOrder = data.order as OrderRow;
      setOrders((current) => current.map((order) => order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order));
      setClubOrders((current) => current.map((order) => order.id === updatedOrder.id ? { ...order, ...updatedOrder } : order));
      setMatchOrder(null);
      showToast("Customer match updated");
    } catch {
      setMatchError("Could not match customer. Check your connection and retry.");
    } finally {
      setMatchSaving(false);
    }
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
          {canCreateOrders && (
            <button type="button" onClick={() => void loadPublicOrderLink()} className="inline-flex items-center gap-2 rounded-lg border border-brand-300 px-4 py-2 text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-200">
              Customer Order Link
            </button>
          )}
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {toast && (
        <div className="fixed bottom-20 left-4 right-4 z-50 rounded-lg bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg sm:left-auto sm:right-6 sm:w-72">
          {toast}
        </div>
      )}
      {sharePromptOrder && (
        <div className="fixed bottom-20 left-4 right-4 z-40 rounded-lg border border-emerald-200 bg-white p-3 shadow-lg dark:border-emerald-900 dark:bg-slate-950 sm:left-auto sm:right-6 sm:w-80">
          <p className="text-sm font-semibold">Order saved</p>
          <p className="mt-1 text-xs text-slate-500">Share this order manually to a WhatsApp group or contact.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void shareOrderToWhatsApp(sharePromptOrder)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white">
              <Share2 className="h-4 w-4" />
              Share to WhatsApp Group
            </button>
            <button type="button" onClick={() => setSharePromptOrder(null)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">
              Close
            </button>
          </div>
        </div>
      )}
      {publicLinkOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-950 sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Customer Order Link</h2>
                <p className="text-sm text-slate-500">Share this link with customers to place orders directly.</p>
              </div>
              <button type="button" onClick={() => setPublicLinkOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close customer order link">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            {publicLinkError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{publicLinkError}</div>}
            {publicLinkLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading link...
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold">Public order link</span>
                  <input readOnly value={publicOrderUrl} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm font-semibold dark:border-slate-800">
                  <span>{publicOrderEnabled ? "Link enabled" : "Link disabled"}</span>
                  <input type="checkbox" checked={publicOrderEnabled} disabled={publicLinkSaving} onChange={(event) => void setPublicOrderLinkEnabled(event.target.checked)} className="h-5 w-5" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void copyPublicOrderLink()} disabled={!publicOrderUrl || publicLinkSaving} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                    Copy Order Link
                  </button>
                  <button type="button" onClick={() => void sharePublicOrderLink()} disabled={!publicOrderUrl || publicLinkSaving} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60 dark:border-slate-700">
                    Share Order Link
                  </button>
                  <button type="button" onClick={() => void regeneratePublicOrderLink()} disabled={publicLinkSaving} className="col-span-2 min-h-11 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-60 dark:border-red-900 dark:text-red-300">
                    {publicLinkSaving ? "Saving..." : "Regenerate Link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {matchOrder && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-950 sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Match Customer</h2>
                <p className="text-sm text-slate-500">Review the submitted customer before linking this order.</p>
              </div>
              <button type="button" onClick={() => setMatchOrder(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close customer match">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
              <p className="font-bold">{matchOrder.submittedCustomerName ?? orderCustomerName(matchOrder)}</p>
              <p>{matchOrder.submittedCustomerMobile ?? orderCustomerContact(matchOrder)}</p>
              {matchOrder.submittedAddress && <p className="mt-1 text-slate-500">{matchOrder.submittedAddress}</p>}
            </div>
            {matchError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{matchError}</div>}
            {matchLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading matches...
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {matchCustomers.length > 0 ? (
                  <div className="space-y-2">
                    {matchCustomers.map((customer) => (
                      <label key={customer.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                        <input type="radio" name="matchCustomer" checked={selectedMatchCustomerId === customer.id} onChange={() => setSelectedMatchCustomerId(customer.id)} className="mt-1" />
                        <span>
                          <span className="font-bold">{customer.partyName}</span>
                          {customer.batchTag && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{customer.batchTag}</span>}
                          <span className="block text-slate-500">{customer.contactNumber}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">No matching customers found for this mobile.</p>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  <button type="button" onClick={() => void submitCustomerMatch("LINK_EXISTING")} disabled={matchSaving || !selectedMatchCustomerId} className="min-h-11 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
                    Link Selected
                  </button>
                  <button type="button" onClick={() => void submitCustomerMatch("CREATE_NEW")} disabled={matchSaving} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-60 dark:border-slate-700">
                    Create New
                  </button>
                  <button type="button" onClick={() => void submitCustomerMatch("KEEP_UNLINKED")} disabled={matchSaving} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-60 dark:border-slate-700">
                    Keep Unlinked
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-2 sm:grid-cols-[minmax(12rem,16rem)_auto] sm:items-end">
            <label className="block">
              <span className="text-xs font-bold uppercase text-slate-500">{dateFilterLabel(filter)}</span>
              <select
                value={customDateOpen && dateFilter !== "custom" ? "custom" : dateFilter}
                onChange={(event) => selectDateFilter(event.target.value as DateFilter)}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
              >
                {dateFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-200">{activeDateLabel}</span>
              {dateFilter !== "all" && (
                <button type="button" onClick={clearDateFilter} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">
                  Clear Date Filter
                </button>
              )}
            </div>
          </div>
          {customDateOpen && (
            <div className="grid gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-950 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
              <AppDatePicker label="From Date" value={draftFromDate} onChange={setDraftFromDate} />
              <AppDatePicker label="To Date" value={draftToDate} onChange={setDraftToDate} />
              <button type="button" onClick={applyCustomDateFilter} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white">
                Apply
              </button>
              <button type="button" onClick={clearDateFilter} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700">
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-4">
        <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search orders, customers, mobile, staff" className="min-h-12 w-full rounded-lg border py-3 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
      </div>
      <input value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} placeholder="Filter by firm / batch" className="mt-3 min-h-11 w-full rounded-lg border px-3 text-sm dark:border-slate-700 dark:bg-slate-900 sm:max-w-xs" />

      <div className="mt-4 space-y-3">
        {loading && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">Loading orders...</div>}
        {!loading && filteredOrders.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">
            {dateFilter === "all" ? "No orders found." : filterEmptyLabel(filter, dateFilter)}
          </div>
        )}
        {filteredOrders.map((order) => (
          <article
            id={`order-${order.id}`}
            key={order.id}
            className={`${orderCardClass(order.status)} ${highlightedId === order.id ? "ring-2 ring-brand-500" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-bold">{orderCustomerName(order)}</h2>
                  {orderCustomerBatch(order) && <span className="rounded-full bg-sky-100 px-2 py-1 text-[11px] font-bold text-sky-700">{orderCustomerBatch(order)}</span>}
                  <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${order.sourceModule === "NEW_CUSTOMER_ORDER" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}>
                    {order.sourceModule === "NEW_CUSTOMER_ORDER" ? "New" : "Existing"}
                  </span>
                  {orderMatchLabel(order.customerMatchStatus) && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">{orderMatchLabel(order.customerMatchStatus)}</span>}
                </div>
                <p className="text-sm text-slate-500">{orderCustomerContact(order)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityClass(order.priority)}`}>{order.priority}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(order.status)}`}>{displayStatus(order.status)}</span>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{order.orderDetails}</p>
            {deliveryLocationLabel(order) && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                <p className="font-bold text-slate-700 dark:text-slate-200">Delivery Location</p>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap">{deliveryLocationLabel(order)}</p>
                {order.deliveryLocationUrl && (
                  <a href={order.deliveryLocationUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-brand-700 dark:border-slate-700 dark:text-brand-200">
                    Open Map
                  </a>
                )}
              </div>
            )}
            <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-6">
              <span>Qty: {orderQuantity(order)}</span>
              <span>Delivery: {formatDate(order.preferredDeliveryDate)}</span>
              <span>Created By: {order.createdBy.name}</span>
              <span>Last Updated By: {order.activities?.[0]?.user.name ?? order.createdBy.name}</span>
              <span>Source: {order.visitSource ?? order.sourceModule ?? "Field visit"}</span>
              <span>Order date: {formatDateTime(order.createdAt)}</span>
            </div>
            {canManageOrders && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyOrder(order)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">
                  <Copy className="h-4 w-4" />
                  Copy Order
                </button>
                <button type="button" onClick={() => void shareOrderToWhatsApp(order)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300 px-3 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                  <Share2 className="h-4 w-4" />
                  Share WhatsApp
                </button>
                {order.customerMatchStatus === "REVIEW_REQUIRED" && (
                  <button type="button" onClick={() => void openMatchCustomer(order)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800">
                    Match Customer
                  </button>
                )}
                {canAssignTasks && order.customer && (
                  <AssignTaskButton
                    label="Assign Follow-up"
                    seed={{
                      customerId: order.customer.id,
                      customerName: order.customer.partyName,
                      taskType: "ORDER_FOLLOW_UP",
                      title: "Order Follow-up",
                      notes: order.orderDetails,
                      priority: order.priority === "Urgent" ? "URGENT" : order.priority === "High" ? "HIGH" : "MEDIUM",
                      dueDate: order.preferredDeliveryDate ? `${toInputDate(order.preferredDeliveryDate)}T10:00` : undefined,
                      sourceEntityType: "ORDER",
                      sourceEntityId: order.id,
                      referenceUrl: `/customers/${order.customer.id}`,
                    }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-300 px-3 text-xs font-semibold text-brand-700"
                  />
                )}
                {canEdit(order) && (
                  <button type="button" onClick={() => openEdit(order)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    Edit Order
                  </button>
                )}
                {normalizedStatus(order.status) === "DELIVERED" && (
                  <button type="button" onClick={() => openEdit(order)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 dark:border-slate-800" title="Delivered orders cannot be edited.">
                    Edit Locked
                  </button>
                )}
                {normalizedStatus(order.status) === "CANCELLED" && (
                  <button type="button" onClick={() => openEdit(order)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 dark:border-slate-800" title="Cancelled orders cannot be edited.">
                    Edit Locked
                  </button>
                )}
                {canClubOrder(order) && (
                  <button type="button" onClick={() => void openClubDispatch(order)} className="rounded-lg border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:text-blue-300">
                    Club
                  </button>
                )}
                {canDispatch(order) && (
                  <button type="button" disabled={actionLoading === `${order.id}:DISPATCH`} onClick={() => runAction(order.id, "DISPATCH")} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                    {actionLoading === `${order.id}:DISPATCH` ? "Dispatching..." : "Dispatch Order"}
                  </button>
                )}
                {canDeliver(order) && (
                  <button type="button" disabled={Boolean(actionLoading)} onClick={() => { setMessage(""); setDeliveredDate(currentIstDate()); setDeliverOrder(order); }} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                    Mark Delivered
                  </button>
                )}
                {canCancel(order) && (
                  <button type="button" onClick={(event) => { cancelTriggerRef.current = event.currentTarget; setCancelOrder(order); }} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">
                    Cancel Order
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {clubOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-slate-950 sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-2xl">
            <div className="border-b border-slate-200 p-4 pt-[max(1rem,env(safe-area-inset-top))] dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Club Dispatch</h2>
                  <p className="text-sm text-slate-500">Select pending and dispatched orders for one vehicle/load plan.</p>
                </div>
                <button type="button" onClick={() => setClubOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close club dispatch">
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
              {clubError && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{clubError}</div>}
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input value={clubSearch} onChange={(e) => setClubSearch(e.target.value)} placeholder="Search customer, mobile, order" className="min-h-11 w-full rounded-lg border py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-900">
                  {(["all", "pending", "dispatched"] as ClubFilter[]).map((item) => (
                    <button key={item} type="button" onClick={() => setClubFilter(item)} className={`rounded-md px-2 py-2 ${clubFilter === item ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>
                      {item === "all" ? "All" : item === "pending" ? "Pending" : "Dispatched"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pb-28 sm:p-4">
              {clubLoading && <div className="rounded-lg border border-dashed p-5 text-center text-sm text-slate-500">Loading eligible orders...</div>}
              {!clubLoading && clubVisibleOrders.length === 0 && <div className="rounded-lg border border-dashed p-5 text-center text-sm text-slate-500">No eligible orders found.</div>}
              {clubVisibleOrders.map((order) => {
                const selected = clubSelected.has(order.id);
                return (
                  <label key={order.id} className={`block rounded-lg border p-3 ${selected ? "border-brand-400 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/30" : "border-slate-200 dark:border-slate-800"}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={selected} onChange={() => toggleClubOrder(order.id)} className="mt-1 h-5 w-5 rounded border-slate-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold">{orderCustomerName(order)}</h3>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusClass(order.status)}`}>{displayStatus(order.status)}</span>
                        </div>
                        {cleanContact(orderCustomerContact(order)) && <p className="mt-1 text-xs text-slate-500">{cleanContact(orderCustomerContact(order))}</p>}
                        <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{order.orderDetails}</p>
                        {deliveryLocationLabel(order) && (
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                            Delivery Location: {deliveryLocationLabel(order)}
                            {order.deliveryLocationUrl && (
                              <a href={order.deliveryLocationUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-bold text-brand-700 dark:text-brand-200">Open Map</a>
                            )}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                          <span>Qty: {orderQuantity(order)}</span>
                          <span>Created: {formatDateTime(order.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-bold">Selected: {clubSelected.size} order{clubSelected.size === 1 ? "" : "s"}</p>
                  <p className="text-slate-500">Total Qty: {clubTotalQty}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button type="button" onClick={() => setClubOpen(false)} disabled={clubSaving} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60 dark:border-slate-700">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void submitClubDispatch()} disabled={clubSaving || clubSelected.size === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                    {clubSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {clubSaving ? "Dispatching..." : "Dispatch Selected"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {cancelOrder && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeCancelDialog(); }}
        >
          <div
            ref={cancelDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-order-title"
            aria-describedby="cancel-order-description"
            tabIndex={-1}
            className="w-full rounded-t-2xl bg-white p-5 shadow-xl outline-none dark:bg-slate-950 sm:max-w-md sm:rounded-2xl"
          >
            <h2 id="cancel-order-title" className="text-lg font-bold">Cancel Order?</h2>
            <p id="cancel-order-description" className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Are you sure you want to cancel this order? This action cannot be undone.
            </p>
            {message && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{message}</div>}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" onClick={closeCancelDialog} disabled={actionLoading === `${cancelOrder.id}:CANCEL`} className="min-h-12 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-60 dark:border-slate-700">
                Keep Order
              </button>
              <button type="button" onClick={() => void confirmCancel()} disabled={actionLoading === `${cancelOrder.id}:CANCEL`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                {actionLoading === `${cancelOrder.id}:CANCEL` && <Loader2 className="h-4 w-4 animate-spin" />}
                {actionLoading === `${cancelOrder.id}:CANCEL` ? "Cancelling..." : "Yes, Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deliverOrder && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !actionLoading) setDeliverOrder(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="deliver-order-title" aria-describedby="deliver-order-description" className="ui-surface-elevated w-full rounded-t-2xl border p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-2xl">
            <h2 id="deliver-order-title" className="text-lg font-bold">Mark Order Delivered</h2>
            <p id="deliver-order-description" className="mt-2 text-sm text-[var(--foreground-muted)]">Select the delivery date for this order.</p>
            <AppDatePicker className="mt-5" label="Delivery Date" value={deliveredDate} onChange={setDeliveredDate} required disabled={Boolean(actionLoading)} max={currentIstDate()} />
            {message && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" disabled={Boolean(actionLoading)} onClick={() => setDeliverOrder(null)} className="ui-control min-h-12 rounded-lg border font-semibold disabled:opacity-50">Cancel</button>
              <button type="button" disabled={Boolean(actionLoading) || !deliveredDate} onClick={() => void confirmDelivered()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-50">
                {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {actionLoading ? "Marking Delivered..." : "Mark Delivered"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editor && (
        <div className="fixed inset-0 z-50 flex items-start bg-black/40 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-slate-950 sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 pt-[max(1rem,env(safe-area-inset-top))] dark:border-slate-800">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">{editor.mode === "create" ? "New Order" : "Edit Order"}</h2>
                  {editor.mode === "edit" && editor.order && (
                    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${statusClass(editor.order.status)}`}>
                      {displayStatus(editor.order.status)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500">Use free-text order details for fast field and counter entry.</p>
              </div>
              <button type="button" onClick={() => setEditor(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close order form">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-24">
              {editor.mode === "edit" && editor.order && normalizedStatus(editor.order.status) === "DISPATCHED" && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                  This order is dispatched. Changes will update the order but will not mark it delivered.
                </div>
              )}
              {editor.mode === "create" && (
                <div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
                    <button type="button" onClick={() => { setCustomerMode("existing"); setDuplicateCustomer(null); }} className={`min-h-10 rounded-md text-sm font-semibold ${customerMode === "existing" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>
                      Existing Customer
                    </button>
                    <button type="button" onClick={() => { setCustomerMode("new"); setSelectedCustomer(null); setCustomerResults([]); }} className={`min-h-10 rounded-md text-sm font-semibold ${customerMode === "new" ? "bg-white text-brand-700 shadow-sm dark:bg-slate-800" : "text-slate-600 dark:text-slate-300"}`}>
                      New Customer Order
                    </button>
                  </div>

                  {customerMode === "existing" ? (
                    <div className="mt-3">
                      <label className="text-sm font-semibold">Customer</label>
                      <input value={customerQuery} onChange={(e) => { setCustomerQuery(e.target.value); setSelectedCustomer(null); }} placeholder="Search customer or mobile" className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                      {selectedCustomer && <p className="mt-2 text-xs font-semibold text-emerald-700">Selected: {selectedCustomer.partyName}{selectedCustomer.batchTag ? ` [${selectedCustomer.batchTag}]` : ""} - {selectedCustomer.contactNumber}</p>}
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
                              {customer.batchTag && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{customer.batchTag}</span>}
                              <span className="block text-xs text-slate-500">{customer.contactNumber}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {!selectedCustomer && customerQuery.trim() && customerResults.length === 0 && (
                        <button type="button" onClick={() => { setCustomerMode("new"); setNewCustomer((current) => ({ ...current, partyName: customerQuery.trim() })); }} className="mt-2 w-full rounded-lg border border-dashed border-brand-300 px-3 py-3 text-left text-sm font-semibold text-brand-700">
                          Create new customer with &quot;{customerQuery.trim()}&quot;
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="text-sm font-semibold">Customer Name *</label>
                          <input value={newCustomer.partyName} onChange={(e) => setNewCustomer((current) => ({ ...current, partyName: e.target.value }))} placeholder="Fresh customer name" className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">Contact Number *</label>
                          <input value={newCustomer.contactNumber} onChange={(e) => setNewCustomer((current) => ({ ...current, contactNumber: e.target.value }))} placeholder="Mobile number" inputMode="tel" className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                        </div>
                        <div>
                          <label className="text-sm font-semibold">Area</label>
                          <input value={newCustomer.area} onChange={(e) => setNewCustomer((current) => ({ ...current, area: e.target.value }))} placeholder="Area / Location" className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                        </div>
                      </div>
                      <button type="button" onClick={() => setMoreDetailsOpen((value) => !value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-semibold dark:border-slate-700">
                        More Details {moreDetailsOpen ? "▲" : "▼"}
                      </button>
                      {moreDetailsOpen && (
                        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                          <input value={newCustomer.gstNumber} onChange={(e) => setNewCustomer((current) => ({ ...current, gstNumber: e.target.value }))} placeholder="GST optional" className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                          <input value={newCustomer.address} onChange={(e) => setNewCustomer((current) => ({ ...current, address: e.target.value }))} placeholder="Address optional" className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                          <textarea value={newCustomer.notes} onChange={(e) => setNewCustomer((current) => ({ ...current, notes: e.target.value }))} placeholder="Customer notes optional" rows={2} className="w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
                        </div>
                      )}
                      {duplicateCustomer && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          Existing customer found: <strong>{duplicateCustomer.partyName}</strong> - {duplicateCustomer.contactNumber}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(duplicateCustomer);
                              setCustomerQuery(`${duplicateCustomer.partyName} - ${duplicateCustomer.contactNumber}`);
                              setCustomerMode("existing");
                              setDuplicateCustomer(null);
                            }}
                            className="mt-2 block rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Use Existing Customer
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Item rows</p>
                    <p className="text-xs text-slate-500">Optional. These rows fill the order text below.</p>
                  </div>
                  <button type="button" onClick={addStructuredItem} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    Add Item
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {structuredItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                      <input value={item.material} onChange={(e) => updateStructuredItem(index, { material: e.target.value })} placeholder="Material / size" className="min-h-10 rounded-lg border px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                      <input value={item.qty} onChange={(e) => updateStructuredItem(index, { qty: cleanQty(e.target.value) })} placeholder="Qty" inputMode="decimal" className="min-h-10 rounded-lg border px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                      <button type="button" onClick={() => removeStructuredItem(index)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700" aria-label="Remove item">
                        X
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold">Order Details</label>
                <textarea value={orderDetails} onChange={(e) => setOrderDetails(e.target.value)} rows={3} placeholder="Example: 100 bags cement + 20 steel rods" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
                <p className="mt-1 text-xs font-semibold text-slate-500">Total Qty: {orderDetailsQty}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <AppDatePicker label="Delivery Preferred Date" value={deliveryDate} onChange={setDeliveryDate} />
                <div>
                  <label className="text-sm font-semibold">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
                    <option>Normal</option>
                    <option>High</option>
                    <option>Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold">Delivery Location</label>
                <textarea value={deliveryLocation} onChange={(e) => setDeliveryLocation(e.target.value)} maxLength={1000} rows={2} placeholder="Area / address / Google Maps link" className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
              </div>
            </div>

            <div className="sticky bottom-0 z-10 flex gap-2 border-t border-slate-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-950">
              <button type="button" onClick={() => setEditor(null)} disabled={savingOrder} className="min-h-12 flex-1 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50 dark:border-slate-700">
                Cancel
              </button>
              <button type="button" onClick={submitEditor} disabled={savingOrder || !orderDetails.trim() || (editor.mode === "create" && (customerMode === "existing" ? !selectedCustomer : !newCustomer.partyName.trim() || !newCustomer.contactNumber.trim()))} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {savingOrder && <Loader2 className="h-4 w-4 animate-spin" />}
                {savingOrder ? "Saving..." : editor.mode === "edit" ? "Save Changes" : "Save Order"}
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
