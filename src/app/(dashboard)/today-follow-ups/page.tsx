"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  Copy,
  History,
  IndianRupee,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  ShieldAlert,
  SkipForward,
  StickyNote,
  TimerReset,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CustomerStatus, FollowUpPriority, FollowUpStatus } from "@prisma/client";
import { formatCurrency, cn } from "@/lib/utils";
import { displayPhone, telHref } from "@/lib/phone";
import { openWhatsAppUrl, paymentReminderMessage, whatsappHref } from "@/lib/whatsapp";
import { isShopAdminRole, roleLabel } from "@/lib/operational-roles";
import { AssignTaskButton } from "@/components/AssignTaskDialog";
import { AppDatePicker, AppTimePicker } from "@/components/AppDateTimePicker";
import { followUpTypeLabel, isOrderFollowUp, ORDER_FOLLOW_UP } from "@/lib/follow-up-types";
import {
  APP_TIME_ZONE,
  combineDateTimeValue,
  currentIstDate,
  isoToIstDateTime,
  istDateTimeToIso,
  reminderPresets,
  splitDateTimeValue,
} from "@/lib/app-date-time";

type QueueStatus =
  | "PENDING"
  | "CALLBACK"
  | "FOLLOW_UP_REQUIRED"
  | "CONTACTED"
  | "NOT_REACHABLE"
  | "PAYMENT_PROMISED"
  | "PARTIAL_PAID"
  | "PAID"
  | "RESCHEDULED"
  | "WRONG_NUMBER"
  | "COMPLETED";

type FollowUpItem = {
  id: string;
  followupDate: string;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  notes: string | null;
  reminderNotes: string | null;
  customerResponse: string | null;
  nextFollowupDate: string | null;
  nextFollowUpDateTime?: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  rescheduledAt?: string | null;
  actionLoggedAt?: string;
  followUpType?: string | null;
  summary?: string | null;
  createdBy: { name: string };
};

type FollowUpHistoryResponse = {
  success: boolean;
  items: FollowUpItem[];
  pagination: { skip: number; take: number; hasMore: boolean; nextSkip: number };
  error?: string;
};

type QueueCustomer = {
  id: string;
  partyName: string;
  contactNumber: string;
  batchTag?: string | null;
  outstandingBalance: number;
  lastFollowupDate: string | null;
  nextFollowupDate: string | null;
  status: CustomerStatus;
  notes: string | null;
  balanceAsOfDate: string;
  queueRank?: number;
  followUps: FollowUpItem[];
  payments: {
    id: string;
    amount: number;
    paidAt: string;
    method: string | null;
    notes: string | null;
    createdBy: { name: string };
  }[];
  todayAction?: FollowUpItem;
  touchedAt?: string;
  optimisticStatus?: QueueStatus;
  smartPriority?: FollowUpPriority;
  smartPriorityLabel?: string;
  queueScore?: number;
  section?: "urgent" | "today" | "recent";
};

type ScheduledQueueCustomer = QueueCustomer & {
  scheduledFollowUp: {
    id: string;
    scheduledAt: string;
    followUpType: string;
    notes: string | null;
    reminderNotes: string | null;
    customerResponse: string | null;
    assignedTo: string;
    assignedToId: string | null;
    reminderEnabled: boolean;
    manualReminder: boolean;
    promiseToPay: boolean;
    overdue: boolean;
    task: {
      id: string;
      taskType: string;
      taskTypeLabel: string;
      status: string;
      priority: string;
      dueDate: string;
      notes: string | null;
      progressNotes: string | null;
      assignedTo: string;
    } | null;
  };
};

type TodayResponse = {
  scheduled: ScheduledQueueCustomer[];
  pending: QueueCustomer[];
  done: QueueCustomer[];
  summary: {
    totalCustomers: number;
    totalPendingCustomers: number;
    totalPendingAmount: number;
    totalToday: number;
    pending: number;
    completed: number;
    actionedToday: number;
    callsCompleted: number;
    recoveryToday: number;
    overdue: number;
    scheduled: number;
    scheduledOverdue: number;
    autoCreated: number;
    staffPerformance: { staffId: string; name: string; actions: number }[];
  };
  sections: { urgent: number; today: number; recent: number; done: number };
  pagination: { skip: number; take: number; hasMore: boolean };
  performance?: { lightweightMode: boolean; threshold: number; totalActiveCustomers: number };
};

type SortKey =
  | "amount_desc"
  | "amount_asc"
  | "overdue_desc"
  | "oldest_followup"
  | "newest_followup"
  | "last_contacted"
  | "never_contacted"
  | "priority_desc"
  | "priority_asc"
  | "az"
  | "za";

type FilterKey =
  | "all"
  | "overdue"
  | "today"
  | "high_amount"
  | "no_followup"
  | "done"
  | "pending"
  | "promise"
  | "not_answering"
  | "urgent";

type ScheduledFilterKey = "all" | "today" | "upcoming" | "overdue" | "promise" | "reminder" | "payment" | "order" | "task_linked";

const PAGE_SIZE = 30;
const HIGH_AMOUNT = 50000;
const COMPLETE_STATUSES: QueueStatus[] = ["PAID", "COMPLETED", "WRONG_NUMBER"];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "amount_desc", label: "Highest Pending Amount" },
  { value: "amount_asc", label: "Lowest Pending Amount" },
  { value: "overdue_desc", label: "Most Overdue" },
  { value: "oldest_followup", label: "Oldest Follow-up" },
  { value: "newest_followup", label: "Newest Follow-up" },
  { value: "last_contacted", label: "Last Contacted" },
  { value: "never_contacted", label: "Never Contacted" },
  { value: "priority_desc", label: "Priority High to Low" },
  { value: "priority_asc", label: "Priority Low to High" },
  { value: "az", label: "Alphabetical A-Z" },
  { value: "za", label: "Alphabetical Z-A" },
];

const FILTERS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "high_amount", label: "High Amount" },
  { value: "no_followup", label: "No Follow-up Yet" },
  { value: "done", label: "Follow-up Done Today" },
  { value: "pending", label: "Pending Only" },
  { value: "promise", label: "Promise to Pay" },
  { value: "not_answering", label: "Not Answering" },
  { value: "urgent", label: "Urgent Recovery" },
];

const SCHEDULED_FILTERS: { value: ScheduledFilterKey; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Due Today" },
  { value: "overdue", label: "Overdue" },
  { value: "promise", label: "Promise To Pay" },
  { value: "payment", label: "Payment Follow-up" },
  { value: "order", label: "Order Follow-up" },
  { value: "task_linked", label: "Task-linked" },
];

const STATUS_OPTIONS: { value: QueueStatus; label: string; tone: string }[] = [
  { value: "CALLBACK", label: "Call Back", tone: "border-indigo-200 bg-indigo-50 text-indigo-800" },
  { value: "FOLLOW_UP_REQUIRED", label: "Follow-up required", tone: "border-blue-200 bg-blue-50 text-blue-800" },
  { value: "CONTACTED", label: "Called", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  { value: "NOT_REACHABLE", label: "Not reachable", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  { value: "PAYMENT_PROMISED", label: "Payment promised", tone: "border-violet-200 bg-violet-50 text-violet-800" },
  { value: "PARTIAL_PAID", label: "Paid partially", tone: "border-teal-200 bg-teal-50 text-teal-800" },
  { value: "PAID", label: "Paid fully", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  { value: "RESCHEDULED", label: "Follow-up later", tone: "border-slate-200 bg-slate-50 text-slate-800" },
  { value: "WRONG_NUMBER", label: "Wrong number", tone: "border-red-200 bg-red-50 text-red-800" },
  { value: "COMPLETED", label: "Done", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
];

type PrimaryFollowUpAction = "PAYMENT_UPDATE" | typeof ORDER_FOLLOW_UP | "FOLLOW_UP_LATER" | "NO_RESPONSE" | "COMPLETED";

const PRIMARY_ACTIONS: { value: PrimaryFollowUpAction; label: string; description: string }[] = [
  { value: "PAYMENT_UPDATE", label: "Payment Update", description: "Promise, payment, or cheque" },
  { value: ORDER_FOLLOW_UP, label: "Order Follow-up", description: "Schedule a call for a new order" },
  { value: "FOLLOW_UP_LATER", label: "Follow-up Later", description: "Reschedule with reminder" },
  { value: "NO_RESPONSE", label: "No Response", description: "Not reachable or busy" },
  { value: "COMPLETED", label: "Completed", description: "Close this follow-up" },
];

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

const PAYMENT_OUTCOMES: { value: QueueStatus; label: string; notes: string; response?: string }[] = [
  { value: "PAYMENT_PROMISED", label: "Payment Promised", notes: "Customer promised payment.", response: "Payment promised" },
  { value: "PARTIAL_PAID", label: "Paid Partially", notes: "Partial payment received." },
  { value: "PAID", label: "Paid Fully", notes: "Full payment received." },
  { value: "FOLLOW_UP_REQUIRED", label: "Cheque Collected", notes: "Cheque collected during follow-up.", response: "Cheque collected" },
];

const NO_RESPONSE_OUTCOMES: { value: QueueStatus; label: string; notes: string; response?: string }[] = [
  { value: "NOT_REACHABLE", label: "Call not answered", notes: "Call was not answered." },
  { value: "CALLBACK", label: "Replied with Text", notes: "Customer replied with text; callback required.", response: "Replied with text" },
  { value: "CALLBACK", label: "Customer Busy", notes: "Customer was busy; callback required.", response: "Customer busy" },
  { value: "CALLBACK", label: "Call Back Requested", notes: "Customer requested callback.", response: "Callback requested" },
];

const FOLLOW_UP_LATER_OUTCOMES: { value: QueueStatus; label: string; notes: string; response?: string }[] = [
  { value: "RESCHEDULED", label: "WhatsApp Reminder Sent", notes: "WhatsApp reminder sent.", response: "WhatsApp reminder sent" },
];

const NOTE_TEMPLATES = [
  "Customer promised payment today.",
  "Asked to call again in evening.",
  "Not reachable after multiple attempts.",
  "WhatsApp reminder sent.",
  "Payment collector visit required.",
];

function reminderInputFromDate(value: Date | string | null | undefined) {
  return isoToIstDateTime(value);
}

function reminderInputToIso(value: string) {
  return istDateTimeToIso(value);
}

function todayReminderDateValue() {
  return currentIstDate();
}

function formatDateTime(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function startOfToday() {
  return new Date(reminderInputToIso(`${todayReminderDateValue()}T00:00`) ?? new Date());
}

function endOfToday() {
  return new Date(reminderInputToIso(`${todayReminderDateValue()}T23:59`) ?? new Date());
}

function reminderDatePart(value: string) {
  return splitDateTimeValue(value).date;
}

function reminderTimePart(value: string) {
  return splitDateTimeValue(value).time;
}

function combineReminderDateTime(date: string, time: string) {
  return combineDateTimeValue(date, time || "10:00");
}

async function schedulePwaFollowUpNotification(input: {
  followUpId?: string;
  customerId: string;
  partyName: string;
  amount: number;
  scheduledAt: string | null;
  note?: string;
}) {
  if (!input.scheduledAt || typeof window === "undefined") return;
  if (input.amount <= 0) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  const timestamp = new Date(input.scheduledAt).getTime();
  if (!Number.isFinite(timestamp)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const target = registration?.active ?? navigator.serviceWorker.controller;
  target?.postMessage({
    type: "UDHARBOOK_SCHEDULE_NOTIFY",
    scheduledAt: timestamp,
    title: `Follow-up due: ${input.partyName}`,
    body: `Call ${input.partyName} regarding ${formatCurrency(input.amount)} balance.${input.note ? ` Note: ${input.note}` : ""}`,
    url: `/today-follow-ups?followUpId=${encodeURIComponent(input.followUpId ?? input.customerId)}`,
    tag: `follow-up-${input.followUpId ?? input.customerId}-${timestamp}`,
    requireInteraction: true,
  });
}

function defaultReminderDate() {
  return reminderPresets().find((preset) => preset.id === "tomorrow-10-am")?.value ?? "";
}

function latestFollowUp(customer: QueueCustomer) {
  return customer.followUps[0] ?? null;
}

function daysOverdue(customer: QueueCustomer) {
  if (!customer.nextFollowupDate) return 0;
  return Math.max(0, Math.ceil((Date.now() - new Date(customer.nextFollowupDate).getTime()) / 86400000));
}

function isPastDue(date: string | Date | null | undefined) {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}

function followUpTimingLabel(date: string | Date | null | undefined, promiseToPay = false) {
  if (!date) return "-";
  const target = new Date(date);
  const diff = target.getTime() - Date.now();
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(target);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const tomorrowStart = startOfToday();
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);
  const dateText = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(target);

  if (diff < 0) {
    const abs = Math.abs(diff);
    const minutes = Math.max(1, Math.round(abs / 60000));
    const hours = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);
    const unit = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : hours >= 1 ? `${hours}h` : `${minutes}m`;
    return promiseToPay ? `Overdue after missed promise by ${unit}` : `Overdue by ${unit}`;
  }
  if (target >= todayStart && target <= todayEnd) return promiseToPay ? `Payment expected today ${time}` : `Due today ${time}`;
  if (target >= tomorrowStart && target <= tomorrowEnd) return promiseToPay ? `Payment expected tomorrow ${time}` : `Upcoming tomorrow ${time}`;
  return promiseToPay ? `Payment expected on ${dateText}` : `Upcoming ${dateText}`;
}

function derivedPriority(customer: QueueCustomer): FollowUpPriority {
  const latest = latestFollowUp(customer);
  if (customer.status === "HIGH_RISK" || daysOverdue(customer) > 1) return "URGENT";
  if (latest?.priority) return latest.priority;
  if (customer.outstandingBalance >= HIGH_AMOUNT) return "HIGH";
  if (customer.nextFollowupDate && new Date(customer.nextFollowupDate) <= endOfToday()) return "MEDIUM";
  return "LOW";
}

function cardTone(customer: QueueCustomer, done = false) {
  if (done || customer.status === "CLEARED" || customer.optimisticStatus === "PAID") return "green";
  if (derivedPriority(customer) === "URGENT" || daysOverdue(customer) > 0) return "red";
  return "yellow";
}

function statusLabel(status: string | null | undefined) {
  return status ? status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : "-";
}

function matchesScheduledFilter(item: ScheduledQueueCustomer, filter: ScheduledFilterKey) {
  const scheduledAt = new Date(item.scheduledFollowUp.scheduledAt);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  if (filter === "today") return scheduledAt >= todayStart && scheduledAt <= todayEnd;
  if (filter === "upcoming") return scheduledAt > todayEnd;
  if (filter === "overdue") return isPastDue(scheduledAt);
  if (filter === "promise") return item.scheduledFollowUp.promiseToPay;
  if (filter === "reminder") return item.scheduledFollowUp.manualReminder || item.scheduledFollowUp.reminderEnabled;
  if (filter === "payment") return item.scheduledFollowUp.followUpType === "PAYMENT_FOLLOW_UP";
  if (filter === "order") return isOrderFollowUp(item.scheduledFollowUp.followUpType);
  if (filter === "task_linked") return Boolean(item.scheduledFollowUp.task);
  return true;
}

function scheduledGroupFor(item: ScheduledQueueCustomer): "overdue" | "today" | "upcoming" {
  const scheduledAt = new Date(item.scheduledFollowUp.scheduledAt);
  if (isPastDue(scheduledAt)) return "overdue";
  if (scheduledAt >= startOfToday() && scheduledAt <= endOfToday()) return "today";
  return "upcoming";
}

export default function TodayFollowUpsPage() {
  const [scheduled, setScheduled] = useState<ScheduledQueueCustomer[]>([]);
  const [pending, setPending] = useState<QueueCustomer[]>([]);
  const [done, setDone] = useState<QueueCustomer[]>([]);
  const [summary, setSummary] = useState<TodayResponse["summary"]>({
    totalCustomers: 0,
    totalPendingCustomers: 0,
    totalPendingAmount: 0,
    totalToday: 0,
    pending: 0,
    completed: 0,
    actionedToday: 0,
    callsCompleted: 0,
    recoveryToday: 0,
    overdue: 0,
    scheduled: 0,
    scheduledOverdue: 0,
    autoCreated: 0,
    staffPerformance: [],
  });
  const [sections, setSections] = useState<TodayResponse["sections"]>({ urgent: 0, today: 0, recent: 0, done: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("priority_desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledFilterKey>("all");
  const [scheduledAssigneeId, setScheduledAssigneeId] = useState("");
  const [scheduledCollapsed, setScheduledCollapsed] = useState(false);
  const [lightweightMode, setLightweightMode] = useState(false);
  const [totalActiveCustomers, setTotalActiveCustomers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [currentRole, setCurrentRole] = useState("");
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [linkedFollowUpId, setLinkedFollowUpId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const sheetHistoryActiveRef = useRef(false);
  const restoreFocusIdRef = useRef<string | null>(null);
  const [mobileSheet, setMobileSheet] = useState(false);
  const [showGoToTop, setShowGoToTop] = useState(false);

  const restoreListFocus = useCallback(() => {
    const customerId = restoreFocusIdRef.current;
    if (!customerId) return;
    window.setTimeout(() => {
      const target = listRef.current?.querySelector<HTMLElement>(`[data-customer-id="${CSS.escape(customerId)}"]`) ?? null;
      target?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const openCustomer = useCallback((customerId: string) => {
    restoreFocusIdRef.current = customerId;
    setSelectedId(customerId);
  }, []);

  const closeCustomer = useCallback(() => {
    if (sheetHistoryActiveRef.current) {
      window.history.back();
      return;
    }
    setSelectedId(null);
    restoreListFocus();
  }, [restoreListFocus]);

  const scrollListElementIntoView = useCallback((element: HTMLElement | null) => {
    if (!element || !window.matchMedia("(min-width: 1280px)").matches) return;
    const elementRect = element.getBoundingClientRect();
    const topOffset = 96;
    const bottomOffset = 120;
    const comfortableBottom = window.innerHeight - bottomOffset;
    const alreadyAligned =
      elementRect.top >= topOffset &&
      elementRect.bottom <= comfortableBottom &&
      elementRect.top <= window.innerHeight * 0.45;
    if (alreadyAligned) return;

    window.scrollTo({
      top: Math.max(0, window.scrollY + elementRect.top - topOffset),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    setLinkedFollowUpId(new URLSearchParams(window.location.search).get("followUpId"));
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setCurrentRole(data?.user?.role ?? ""))
      .catch(() => setCurrentRole(""));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setMobileSheet(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShowGoToTop(window.scrollY > 400);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!selectedId || mobileSheet) return;
    window.setTimeout(() => {
      const target = listRef.current?.querySelector<HTMLElement>(`[data-customer-id="${CSS.escape(selectedId)}"]`) ?? null;
      scrollListElementIntoView(target);
    }, 0);
  }, [mobileSheet, scrollListElementIntoView, selectedId]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const customerId = event.state?.todayFollowUpsSheetCustomerId as string | undefined;
      if (customerId) {
        sheetHistoryActiveRef.current = true;
        restoreFocusIdRef.current = customerId;
        setSelectedId(customerId);
        return;
      }
      if (sheetHistoryActiveRef.current) {
        sheetHistoryActiveRef.current = false;
        setSelectedId(null);
        restoreListFocus();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restoreListFocus]);

  useEffect(() => {
    if (!mobileSheet || !selectedId) return;
    if (sheetHistoryActiveRef.current) {
      window.history.replaceState(
        { ...window.history.state, todayFollowUpsSheetCustomerId: selectedId },
        "",
        window.location.href,
      );
      return;
    }
    window.history.pushState(
      { ...window.history.state, todayFollowUpsSheetCustomerId: selectedId },
      "",
      window.location.href,
    );
    sheetHistoryActiveRef.current = true;
  }, [mobileSheet, selectedId]);

  useEffect(() => {
    if (!isShopAdminRole(currentRole)) {
      setStaffOptions([]);
      return;
    }
    fetch("/api/users")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setStaffOptions((data?.users ?? []).filter((user: StaffOption) =>
        ["SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"].includes(user.role),
      )))
      .catch(() => setStaffOptions([]));
  }, [currentRole]);

  useEffect(() => {
    if (!linkedFollowUpId || scheduled.length === 0) return;
    const linked = scheduled.find((customer) => customer.scheduledFollowUp.id === linkedFollowUpId);
    if (!linked) return;
    openCustomer(linked.id);
    window.setTimeout(() => {
      scrollListElementIntoView(document.getElementById(`scheduled-follow-up-${linkedFollowUpId}`));
    }, 100);
  }, [linkedFollowUpId, openCustomer, scheduled, scrollListElementIntoView]);

  const mergeQueue = useCallback((data: TodayResponse, reset: boolean) => {
    if (reset || data.scheduled.length > 0) setScheduled(data.scheduled);
    setPending((current) => {
      const map = new Map((reset ? [] : current).map((customer) => [customer.id, customer]));
      for (const customer of data.pending) map.set(customer.id, { ...map.get(customer.id), ...customer });
      return Array.from(map.values());
    });
    if (reset || data.done.length > 0) setDone(data.done);
    if (reset || data.pagination.skip === 0) {
      setSummary(data.summary);
      setSections(data.sections);
    }
    setHasMore(data.pagination.hasMore);
    if (data.performance) {
      setLightweightMode(Boolean(data.performance.lightweightMode));
      setTotalActiveCustomers(data.performance.totalActiveCustomers);
    }
  }, []);

  const loadPage = useCallback(
    async (skip: number, reset = false) => {
      if (reset) loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const params = new URLSearchParams({
          take: String(PAGE_SIZE),
          skip: String(skip),
          sort,
          filter,
          search: debouncedQuery,
        });
        if (batchTag.trim()) params.set("batchTag", batchTag.trim());
        const res = await fetch(`/api/today-follow-ups?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Could not load follow-up queue.");
        const data = (await res.json()) as TodayResponse;
        if (controller.signal.aborted) return;
        mergeQueue(data, reset);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("today_followups_load_failed", error);
      } finally {
        if (loadAbortRef.current === controller) loadAbortRef.current = null;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [batchTag, debouncedQuery, filter, mergeQueue, sort]
  );

  useEffect(() => {
    loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    const saved = window.localStorage.getItem("udharbook_today_followups_sort") as SortKey | null;
    if (saved && SORT_OPTIONS.some((option) => option.value === saved)) setSort(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("udharbook_today_followups_sort", sort);
  }, [sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPending([]);
  }, [debouncedQuery, filter, sort]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loadingMore) loadPage(pending.length, false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadPage, loadingMore, pending.length]);

  const selected = useMemo(
    () =>
      scheduled.find((customer) => customer.id === selectedId) ??
      pending.find((customer) => customer.id === selectedId) ??
      done.find((customer) => customer.id === selectedId) ??
      null,
    [done, pending, scheduled, selectedId]
  );

  const pendingSections = useMemo(
    () => ({
      urgent: pending.filter((customer) => customer.section === "urgent"),
      today: pending.filter((customer) => customer.section === "today" || !customer.section),
      recent: pending.filter((customer) => customer.section === "recent"),
    }),
    [pending]
  );

  const visibleScheduled = useMemo(
    () => scheduled.filter((customer) => {
      if (!matchesScheduledFilter(customer, scheduledFilter)) return false;
      if (scheduledAssigneeId && customer.scheduledFollowUp.assignedToId !== scheduledAssigneeId) return false;
      if (!debouncedQuery) return true;
      const task = customer.scheduledFollowUp.task;
      const haystack = [
        customer.partyName,
        customer.contactNumber,
        customer.batchTag,
        customer.scheduledFollowUp.notes,
        customer.scheduledFollowUp.reminderNotes,
        task?.taskTypeLabel,
        task?.notes,
        task?.progressNotes,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(debouncedQuery.toLowerCase());
    }),
    [debouncedQuery, scheduled, scheduledAssigneeId, scheduledFilter]
  );

  const queueOrder = useMemo(
    () => [...visibleScheduled.map((customer) => customer.id), ...pending.map((customer) => customer.id), ...done.map((customer) => customer.id)],
    [done, pending, visibleScheduled]
  );

  const pendingQueueOrder = useMemo(
    () => [...visibleScheduled.map((customer) => customer.id), ...pending.map((customer) => customer.id)],
    [pending, visibleScheduled]
  );

  const applyOptimisticAction = (customer: QueueCustomer, status: QueueStatus, notes: string, nextDate: string | null, paidAmount = 0, addToDone = true) => {
    const now = new Date().toISOString();
    const action: FollowUpItem = {
      id: `optimistic-${now}`,
      followupDate: now,
      status: status as FollowUpStatus,
      priority: derivedPriority(customer),
      notes,
      reminderNotes: nextDate ? `Reminder set for ${formatDateTime(nextDate)}` : null,
      customerResponse: null,
      nextFollowupDate: nextDate,
      nextFollowUpDateTime: nextDate,
      scheduledAt: nextDate,
      completedAt: COMPLETE_STATUSES.includes(status) ? now : null,
      rescheduledAt: status === "RESCHEDULED" ? now : null,
      actionLoggedAt: now,
      createdBy: { name: "You" },
    };
    const nextBalance = status === "PAID" ? 0 : Math.max(0, customer.outstandingBalance - paidAmount);
    const existingScheduled = (customer as Partial<ScheduledQueueCustomer>).scheduledFollowUp;
    const wasScheduledOverdue = Boolean(existingScheduled?.overdue);
    const updated: QueueCustomer = {
      ...customer,
      outstandingBalance: nextBalance,
      status: status === "PAID" ? "CLEARED" : customer.status,
      lastFollowupDate: now,
      nextFollowupDate: nextDate,
      touchedAt: now,
      optimisticStatus: status,
      todayAction: action,
      followUps: [action, ...customer.followUps],
    };
    const shouldShowScheduled = Boolean(nextDate && !COMPLETE_STATUSES.includes(status));
    const scheduledUpdate: ScheduledQueueCustomer | null = shouldShowScheduled && nextDate
      ? {
          ...updated,
          section: "today",
          scheduledFollowUp: {
            id: action.id,
            scheduledAt: nextDate,
            followUpType: status,
            notes,
            reminderNotes: action.reminderNotes,
            customerResponse: null,
            assignedTo: "You",
            assignedToId: null,
            reminderEnabled: true,
            manualReminder: true,
            promiseToPay: status === "PAYMENT_PROMISED",
            overdue: isPastDue(nextDate),
            task: null,
          },
        }
      : null;

    const shouldLeaveQueue =
      COMPLETE_STATUSES.includes(status) ||
      status === "RESCHEDULED" ||
      Boolean(nextDate) ||
      (nextDate ? new Date(nextDate) > endOfToday() : false);

    setPending((current) => (shouldLeaveQueue ? current.filter((item) => item.id !== customer.id) : current.map((item) => (item.id === customer.id ? updated : item))));
    setScheduled((current) => {
      const withoutCustomer = current.filter((item) => item.id !== customer.id);
      return scheduledUpdate ? [scheduledUpdate, ...withoutCustomer].sort((a, b) => new Date(a.scheduledFollowUp.scheduledAt).getTime() - new Date(b.scheduledFollowUp.scheduledAt).getTime()) : withoutCustomer;
    });
    setDone((current) => addToDone ? [updated, ...current.filter((item) => item.id !== customer.id)] : current.filter((item) => item.id !== customer.id));
    setSummary((current) => ({
      ...current,
      pending: shouldLeaveQueue ? Math.max(0, current.pending - 1) : current.pending,
      scheduled: Math.max(0, current.scheduled - (existingScheduled ? 1 : 0) + (scheduledUpdate ? 1 : 0)),
      scheduledOverdue: Math.max(0, current.scheduledOverdue - (wasScheduledOverdue ? 1 : 0) + (scheduledUpdate?.scheduledFollowUp.overdue ? 1 : 0)),
      overdue: Math.max(0, current.overdue - (wasScheduledOverdue ? 1 : 0) + (scheduledUpdate?.scheduledFollowUp.overdue ? 1 : 0)),
      completed: addToDone ? current.completed + 1 : current.completed,
      actionedToday: addToDone ? current.actionedToday + 1 : current.actionedToday,
      recoveryToday: current.recoveryToday + paidAmount,
    }));
  };

  const quickSave = async (customer: QueueCustomer, status: QueueStatus, notes: string, supersedesFollowUpId?: string) => {
    const nextDate = status === "RESCHEDULED" ? reminderInputToIso(defaultReminderDate()) : customer.nextFollowupDate;
    const paidAmount = status === "PAID" ? customer.outstandingBalance : 0;
    const response = await fetch("/api/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        status,
        priority: derivedPriority(customer),
        notes,
        supersedesFollowUpId,
        manualReminder: status === "RESCHEDULED",
        reminderEnabled: status === "RESCHEDULED",
        nextFollowUpDateTime: status === "RESCHEDULED" ? nextDate : null,
        scheduledAt: status === "RESCHEDULED" ? nextDate : null,
        nextFollowupDate: status === "RESCHEDULED" ? nextDate : null,
        paidAmount,
      }),
    });
    if (!response.ok) throw new Error("Could not save follow-up");
    applyOptimisticAction(customer, status, notes, nextDate, paidAmount);
  };

  const cancelScheduled = async (followUpId: string) => {
    const response = await fetch("/api/follow-ups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: followUpId, action: "CANCEL" }),
    });
    if (!response.ok) throw new Error("Could not cancel follow-up");
    setScheduled((current) => current.filter((customer) => customer.scheduledFollowUp.id !== followUpId));
    setSummary((current) => ({
      ...current,
      pending: Math.max(0, current.pending - 1),
      scheduled: Math.max(0, current.scheduled - 1),
      totalPendingCustomers: Math.max(0, current.totalPendingCustomers - 1),
    }));
  };

  const updateLinkedTask = async (customer: ScheduledQueueCustomer, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => {
    const task = customer.scheduledFollowUp.task;
    if (!task) return;
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status }),
    });
    if (!response.ok) throw new Error("Could not update linked task");
    setScheduled((current) =>
      current.map((item) =>
        item.scheduledFollowUp.task?.id === task.id
          ? {
              ...item,
              scheduledFollowUp: {
                ...item.scheduledFollowUp,
                task: item.scheduledFollowUp.task
                  ? { ...item.scheduledFollowUp.task, status }
                  : item.scheduledFollowUp.task,
              },
            }
          : item,
      ),
    );
    if (status === "COMPLETED" || status === "CANCELLED") {
      setScheduled((current) => current.filter((item) => item.scheduledFollowUp.task?.id !== task.id));
    }
  };

  const handleSaved = useCallback(
    async (customerId: string) => {
      const currentIndex = queueOrder.indexOf(customerId);
      const nextId = queueOrder[currentIndex + 1] ?? queueOrder[currentIndex - 1] ?? null;
      if (nextId) openCustomer(nextId);
      else closeCustomer();
      if (nextId) {
        window.setTimeout(() => {
          const target = listRef.current?.querySelector<HTMLElement>(`[data-customer-id="${CSS.escape(nextId)}"]`) ?? null;
          scrollListElementIntoView(target);
        }, 0);
      }
    },
    [closeCustomer, openCustomer, queueOrder, scrollListElementIntoView]
  );

  const handleSkip = useCallback(
    (customerId: string) => {
      const currentIndex = pendingQueueOrder.indexOf(customerId);
      const nextId = pendingQueueOrder[currentIndex + 1]
        ?? pendingQueueOrder.find((id) => id !== customerId)
        ?? null;
      if (nextId) openCustomer(nextId);
      else closeCustomer();
    },
    [closeCustomer, openCustomer, pendingQueueOrder]
  );

  const selectedPanel = selected ? (
    <ActionPanel
      key={selected.id}
      customer={selected}
      canAssignTask={isShopAdminRole(currentRole)}
      canAssignFollowUp={isShopAdminRole(currentRole)}
      staffOptions={staffOptions}
      onClose={closeCustomer}
      onOptimistic={applyOptimisticAction}
      onSaved={handleSaved}
      onSkip={handleSkip}
    />
  ) : null;

  return (
    <div className="mx-auto w-full max-w-none pb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Daily recovery queue</p>
          <h1 className="text-2xl font-bold sm:text-3xl">Today Follow-ups</h1>
          <p className="mt-1 text-sm text-slate-500">Work from top to bottom. Actioned parties move down automatically.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((value) => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            Alerts
          </button>
          <button
            type="button"
            onClick={() => loadPage(0, true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
          >
            <TimerReset className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-9">
        <Metric label="Pending customers" value={summary.totalPendingCustomers} icon={Clock3} />
        <Metric label="Pending amount" value={formatCurrency(summary.totalPendingAmount)} icon={IndianRupee} />
        <Metric label="Scheduled" value={summary.scheduled} icon={CalendarClock} tone={summary.scheduledOverdue > 0 ? "red" : "yellow"} />
        <Metric label="Overdue" value={summary.overdue} icon={ShieldAlert} tone="red" />
        <Metric label="Completed today" value={summary.completed} icon={CheckCircle2} tone="green" />
        <Metric label="Recovery today" value={formatCurrency(summary.recoveryToday)} icon={IndianRupee} tone="green" />
        <Metric label="Actioned today" value={summary.actionedToday} icon={History} tone="green" />
        <Metric label="Calls done" value={summary.callsCompleted} icon={Phone} />
        <Metric label="Auto queued" value={summary.autoCreated} icon={Bell} tone="yellow" />
      </section>
      {lightweightMode && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
          Lightweight mode active for {totalActiveCustomers} active customers. Showing compact cards for faster loading and smoother scrolling.
        </div>
      )}

      <div className="sticky top-0 z-20 -mx-4 mt-4 space-y-3 border-y border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search party, mobile, notes, or amount"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <input
          value={batchTag}
          onChange={(event) => {
            setBatchTag(event.target.value);
            setPending([]);
          }}
          placeholder="Filter by firm / batch"
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 sm:max-w-xs"
        />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setFilter(item.value);
                  setPending([]);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold",
                  filter === item.value
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            Sort
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortKey);
                setPending([]);
              }}
              className="bg-transparent font-semibold outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4 w-full min-w-0 overflow-x-hidden">
        <main ref={listRef} className="min-w-0 space-y-4 scroll-smooth">
          <ScheduledQueueSection
            customers={visibleScheduled}
            total={scheduled.length}
            overdueCount={summary.scheduledOverdue}
            selectedId={selectedId}
            filter={scheduledFilter}
            collapsed={scheduledCollapsed}
            onFilterChange={setScheduledFilter}
            assignedToId={scheduledAssigneeId}
            staffOptions={staffOptions}
            onAssignedToChange={setScheduledAssigneeId}
            onToggle={() => setScheduledCollapsed((value) => !value)}
            onSelect={openCustomer}
            onQuickSave={quickSave}
            onCancel={cancelScheduled}
            onTaskStatus={updateLinkedTask}
            selectedPanel={selectedPanel}
          />

          {loading ? (
            <div className="flex min-h-56 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          ) : pending.length === 0 && filter !== "done" ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              {debouncedQuery ? "No matching outstanding customers found for this search." : "No pending customers match this view."}
            </div>
          ) : lightweightMode ? (
            <>
              <CompactQueueSection
                customers={pending}
                total={summary.pending}
                selectedId={selectedId}
                onSelect={openCustomer}
                onQuickSave={quickSave}
                selectedPanel={selectedPanel}
              />
              <div ref={sentinelRef} className="h-4" />
              {loadingMore && (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                </div>
              )}
            </>
          ) : (
            <>
              <QueueSection
                title="Urgent Recovery"
                count={sections.urgent}
                customers={pendingSections.urgent}
                selectedId={selectedId}
                onSelect={openCustomer}
                onQuickSave={quickSave}
                selectedPanel={selectedPanel}
              />
              <QueueSection
                title="Today's Follow-ups"
                count={sections.today}
                customers={pendingSections.today}
                selectedId={selectedId}
                onSelect={openCustomer}
                onQuickSave={quickSave}
                selectedPanel={selectedPanel}
              />
              <QueueSection
                title="Recently Contacted"
                count={sections.recent}
                customers={pendingSections.recent}
                selectedId={selectedId}
                onSelect={openCustomer}
                onQuickSave={quickSave}
                selectedPanel={selectedPanel}
              />
              <div ref={sentinelRef} className="h-4" />
              {loadingMore && (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                </div>
              )}
            </>
          )}

          <section className="border-t border-slate-200 pt-5 dark:border-slate-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Follow-up Done Today</h2>
              <span className="text-sm text-slate-500">{done.length} actioned</span>
            </div>
            <div className="space-y-2">
              {done.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                  Completed actions will appear here as staff works the queue.
                </div>
              ) : (
                done.map((customer) => {
                  const card = <DoneCard customer={customer} onOpen={() => openCustomer(customer.id)} />;
                  return selectedId === customer.id && selectedPanel ? (
                    <SelectedPartyRow key={`${customer.id}-${customer.todayAction?.id ?? "done"}`} panel={selectedPanel}>
                      {card}
                    </SelectedPartyRow>
                  ) : (
                    <div key={`${customer.id}-${customer.todayAction?.id ?? "done"}`}>{card}</div>
                  );
                })
              )}
            </div>
          </section>

          {summary.staffPerformance.length > 0 && (
            <section className="border-t border-slate-200 pt-5 dark:border-slate-800">
              <h2 className="mb-3 text-lg font-bold">Staff Performance</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {summary.staffPerformance.map((staff) => (
                  <div key={staff.staffId} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p className="font-semibold">{staff.name}</p>
                    <p className="text-sm text-slate-500">{staff.actions} action{staff.actions === 1 ? "" : "s"} today</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
      {showGoToTop && (
        <button
          type="button"
          aria-label="Go to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-950 px-3 text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 sm:px-4 xl:bottom-6"
        >
          <ChevronUp className="h-5 w-5" />
          <span className="hidden sm:inline">Top</span>
        </button>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  tone?: "slate" | "red" | "yellow" | "green";
}) {
  const toneClass = {
    slate: "bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100",
    red: "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
    yellow: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    green: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-slate-200 p-3 shadow-sm dark:border-slate-800", toneClass)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function ScheduledQueueSection({
  customers,
  total,
  overdueCount,
  selectedId,
  filter,
  collapsed,
  onFilterChange,
  assignedToId,
  staffOptions,
  onAssignedToChange,
  onToggle,
  onSelect,
  onQuickSave,
  onCancel,
  onTaskStatus,
  selectedPanel,
}: {
  customers: ScheduledQueueCustomer[];
  total: number;
  overdueCount: number;
  selectedId: string | null;
  filter: ScheduledFilterKey;
  collapsed: boolean;
  onFilterChange: (filter: ScheduledFilterKey) => void;
  assignedToId: string;
  staffOptions: StaffOption[];
  onAssignedToChange: (assignedToId: string) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string, supersedesFollowUpId?: string) => Promise<void>;
  onCancel: (followUpId: string) => Promise<void>;
  onTaskStatus: (customer: ScheduledQueueCustomer, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => Promise<void>;
  selectedPanel?: React.ReactNode;
}) {
  const grouped = {
    overdue: customers.filter((customer) => scheduledGroupFor(customer) === "overdue"),
    today: customers.filter((customer) => scheduledGroupFor(customer) === "today"),
    upcoming: customers.filter((customer) => scheduledGroupFor(customer) === "upcoming"),
  };

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,auto)] lg:items-start">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate whitespace-nowrap text-xl font-bold leading-tight text-slate-950 dark:text-white">Scheduled Follow-ups</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {total} scheduled reminders, sorted by what needs attention next.
              </p>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
          <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:w-auto sm:min-w-[360px]">
            <ScheduledMetric label="Upcoming" value={grouped.upcoming.length} tone="blue" />
            <ScheduledMetric label="Due Today" value={grouped.today.length} tone="amber" />
            <ScheduledMetric label="Overdue" value={overdueCount} tone="red" />
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="overflow-x-auto pb-1">
            <div className="inline-flex min-w-max max-w-full rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950">
              {SCHEDULED_FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onFilterChange(item.value)}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-2 text-xs font-bold transition sm:px-4",
                    filter === item.value
                      ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                      : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            </div>
            {staffOptions.length > 0 && (
              <select
                value={assignedToId}
                onChange={(event) => onAssignedToChange(event.target.value)}
                aria-label="Filter scheduled follow-ups by assigned staff"
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">All assigned staff</option>
                {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select>
            )}
          </div>

          {customers.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-950/50">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm dark:bg-slate-900">
                <CalendarClock className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-white">No scheduled follow-ups here</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                New reminders, promises, and rescheduled recovery tasks will appear in this queue when they match the selected view.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <ScheduledGroup
                title="Overdue"
                description="Missed reminder time. Work these first."
                customers={grouped.overdue}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
                onCancel={onCancel}
                onTaskStatus={onTaskStatus}
                selectedPanel={selectedPanel}
              />
              <ScheduledGroup
                title="Due Today"
                description="Sorted by nearest reminder time."
                customers={grouped.today}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
                onCancel={onCancel}
                onTaskStatus={onTaskStatus}
                selectedPanel={selectedPanel}
              />
              <ScheduledGroup
                title="Upcoming"
                description="Future reminders stay here until due."
                customers={grouped.upcoming}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
                onCancel={onCancel}
                onTaskStatus={onTaskStatus}
                selectedPanel={selectedPanel}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ScheduledMetric({ label, value, tone }: { label: string; value: number; tone: "blue" | "amber" | "red" }) {
  const classes = {
    blue: "border-blue-100 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100",
    amber: "border-amber-100 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
    red: "border-red-100 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
  }[tone];
  return (
    <div className={cn("min-w-0 rounded-xl border px-3 py-2 text-center", classes)}>
      <p className="text-lg font-extrabold leading-none">{value}</p>
      <p className="mt-1 truncate whitespace-nowrap text-[11px] font-semibold uppercase text-current/70">{label}</p>
    </div>
  );
}

function ScheduledGroup({
  title,
  description,
  customers,
  selectedId,
  onSelect,
  onQuickSave,
  onCancel,
  onTaskStatus,
  selectedPanel,
}: {
  title: string;
  description: string;
  customers: ScheduledQueueCustomer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string, supersedesFollowUpId?: string) => Promise<void>;
  onCancel: (followUpId: string) => Promise<void>;
  onTaskStatus: (customer: ScheduledQueueCustomer, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => Promise<void>;
  selectedPanel?: React.ReactNode;
}) {
  if (customers.length === 0) return null;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-bold uppercase text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{customers.length}</span>
      </div>
      <div className="min-w-0 space-y-2">
        {customers.map((customer) => {
          const card = (
            <ScheduledFollowUpCard
              customer={customer}
              active={selectedId === customer.id}
              onOpen={() => onSelect(customer.id)}
              onQuickSave={onQuickSave}
              onCancel={onCancel}
              onTaskStatus={onTaskStatus}
            />
          );
          return selectedId === customer.id && selectedPanel ? (
            <SelectedPartyRow key={customer.scheduledFollowUp.id} panel={selectedPanel}>
              {card}
            </SelectedPartyRow>
          ) : (
            <div key={customer.scheduledFollowUp.id}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}

function SelectedPartyRow({ children, panel }: { children: React.ReactNode; panel: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
      <div className="min-w-0">{children}</div>
      {panel}
    </div>
  );
}

function ScheduledFollowUpCard({
  customer,
  active,
  onOpen,
  onQuickSave,
  onCancel,
  onTaskStatus,
}: {
  customer: ScheduledQueueCustomer;
  active: boolean;
  onOpen: () => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string, supersedesFollowUpId?: string) => Promise<void>;
  onCancel: (followUpId: string) => Promise<void>;
  onTaskStatus: (customer: ScheduledQueueCustomer, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") => Promise<void>;
}) {
  const scheduled = customer.scheduledFollowUp;
  const dueAt = new Date(scheduled.scheduledAt);
  const overdue = scheduled.overdue || isPastDue(dueAt);
  const group = scheduledGroupFor(customer);
  const latest = latestFollowUp(customer);
  const notes = scheduled.notes || scheduled.customerResponse || scheduled.reminderNotes || latest?.notes || customer.notes || "No notes added.";
  const isPromise = Boolean(scheduled.promiseToPay);
  const isReminder = Boolean(scheduled.manualReminder || scheduled.reminderEnabled);
  const linkedTask = scheduled.task;
  const stateLabel = overdue ? "Overdue" : group === "today" ? "Due Today" : "Upcoming";
  const stateTone = overdue ? "red" : group === "today" ? "amber" : "blue";
  const cardTone =
    overdue
      ? "border-red-200 bg-red-50/40 hover:border-red-300 dark:border-red-900 dark:bg-red-950/10"
      : group === "today"
        ? "border-amber-200 bg-amber-50/40 hover:border-amber-300 dark:border-amber-900 dark:bg-amber-950/10"
        : "border-blue-200 bg-blue-50/30 hover:border-blue-300 dark:border-blue-900 dark:bg-blue-950/10";

  return (
    <article
      id={`scheduled-follow-up-${scheduled.id}`}
      data-customer-id={customer.id}
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "min-w-0 cursor-pointer overflow-hidden rounded-lg border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900",
        cardTone,
        active && "ring-2 ring-brand-500"
      )}
    >
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(150px,190px)_132px] xl:items-center">
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-extrabold text-slate-950 dark:text-white">{customer.partyName}</h3>
                <BatchBadge tag={customer.batchTag} />
              </div>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{displayPhone(customer.contactNumber)}</p>
            </div>
          </div>
          <p className="line-clamp-1 text-xs leading-5 text-slate-700 dark:text-slate-300">{notes}</p>
          <div className="flex flex-wrap gap-1.5">
            {isPromise && <Badge tone="violet">Promise to pay</Badge>}
            {isReminder && <Badge tone="blue">Reminder set</Badge>}
            <Badge tone={isOrderFollowUp(scheduled.followUpType) ? "amber" : "slate"}>{followUpTypeLabel(scheduled.followUpType)}</Badge>
            {linkedTask && <Badge tone="violet">Task • {linkedTask.taskTypeLabel}</Badge>}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-white/80 bg-white/80 p-2.5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Outstanding</p>
              <p className="text-base font-extrabold text-slate-950 dark:text-white">{formatCurrency(customer.outstandingBalance)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">
                {isPromise ? "Payment Expected" : "Scheduled For"}
              </p>
              <p className="text-xs font-bold leading-5 text-slate-800 dark:text-slate-100">{formatDateTime(dueAt)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:col-span-2 xl:col-span-1">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Priority: {customer.smartPriorityLabel || statusLabel(customer.smartPriority)}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                By {scheduled.assignedTo || "Staff"}
              </span>
              {linkedTask && (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Task: {statusLabel(linkedTask.status)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5 xl:min-w-[132px]">
          <Badge tone={stateTone}>{stateLabel}</Badge>
          <span className={cn("rounded-lg px-2 py-1 text-center text-[11px] font-extrabold leading-4", badgeToneClass(stateTone))}>
            {followUpTimingLabel(dueAt, scheduled.promiseToPay)}
          </span>
          <QuickButton label="Open Follow-up" onClick={onOpen} />
          {linkedTask && (
            <Link
              href={`/tasks?taskId=${encodeURIComponent(linkedTask.id)}`}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Open Task
            </Link>
          )}
          <Link
            href={`/customers/${customer.id}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Open Customer
          </Link>
          {linkedTask?.status === "PENDING" && <QuickButton label="Start Task" onClick={() => onTaskStatus(customer, "IN_PROGRESS")} />}
          <QuickButton
            label={linkedTask ? "Mark Completed" : "Quick Complete"}
            onClick={() => linkedTask
              ? onTaskStatus(customer, "COMPLETED")
              : onQuickSave(customer, "COMPLETED", "Completed scheduled follow-up.", scheduled.id)}
          />
          {(linkedTask || isOrderFollowUp(scheduled.followUpType)) && (
            <QuickButton
              label="Cancel"
              onClick={() => linkedTask ? onTaskStatus(customer, "CANCELLED") : onCancel(scheduled.id)}
            />
          )}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 items-start gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span className="min-w-0 break-words">{isPromise ? "Payment reminder" : "Reminder"} scheduled for {formatDateTime(dueAt)}</span>
      </div>
    </article>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "red" | "violet" | "amber" | "green" | "slate" }) {
  return <span className={cn("inline-flex w-fit max-w-full shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold uppercase", badgeToneClass(tone))}>{children}</span>;
}

function BatchBadge({ tag }: { tag?: string | null }) {
  if (!tag) return null;
  return <span className="inline-flex w-fit shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-extrabold uppercase text-sky-700 dark:bg-sky-950 dark:text-sky-200">{tag}</span>;
}

function badgeToneClass(tone: "blue" | "red" | "violet" | "amber" | "green" | "slate") {
  const classes = {
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100",
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-100",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  }[tone];
  return classes;
}

function CompactQueueSection({
  customers,
  total,
  selectedId,
  onSelect,
  onQuickSave,
  selectedPanel,
}: {
  customers: QueueCustomer[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
  selectedPanel?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold">Operational Follow-up Queue</h2>
          <p className="text-xs text-slate-500">Compact fast-loading view</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {customers.length} / {total}
        </span>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {customers.map((customer) => {
          const card = (
            <CompactCustomerCard
              customer={customer}
              active={selectedId === customer.id}
              onOpen={() => onSelect(customer.id)}
              onQuickSave={onQuickSave}
            />
          );
          return selectedId === customer.id && selectedPanel ? (
            <SelectedPartyRow key={customer.id} panel={selectedPanel}>
              {card}
            </SelectedPartyRow>
          ) : (
            <div key={customer.id}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}

const CompactCustomerCard = memo(function CompactCustomerCard({
  customer,
  active,
  onOpen,
  onQuickSave,
}: {
  customer: QueueCustomer;
  active: boolean;
  onOpen: () => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
}) {
  const latest = latestFollowUp(customer);
  const priority = customer.smartPriority ?? derivedPriority(customer);
  const nextAt = customer.nextFollowupDate ?? latest?.nextFollowupDate ?? null;
  const status = statusLabel(customer.optimisticStatus ?? latest?.status ?? customer.status);
  return (
    <article
      data-customer-id={customer.id}
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "grid min-h-16 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 transition [contain-intrinsic-size:72px] [content-visibility:auto] hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:grid-cols-[minmax(220px,1fr)_130px_130px_136px] sm:items-center",
        active && "bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-950/30"
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", priority === "URGENT" ? "bg-red-500" : priority === "HIGH" ? "bg-orange-500" : "bg-amber-400")} />
          <h3 className="truncate text-sm font-extrabold text-slate-950 dark:text-white">{customer.partyName}</h3>
          <BatchBadge tag={customer.batchTag} />
        </div>
        <p className="mt-1 truncate text-xs font-semibold text-slate-500">{displayPhone(customer.contactNumber)}</p>
      </div>
      <div className="text-right sm:text-left">
        <p className="text-sm font-extrabold">{formatCurrency(customer.outstandingBalance)}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">{status}</p>
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <p className="truncate text-xs font-bold text-slate-700 dark:text-slate-200">{followUpTimingLabel(nextAt, latest?.status === "PAYMENT_PROMISED")}</p>
        <p className="mt-1 truncate text-[11px] text-slate-500">{formatDateTime(nextAt ?? latest?.followupDate)}</p>
      </div>
      <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="min-h-9 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white"
        >
          Open
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onQuickSave(customer, "COMPLETED", "Marked completed from compact queue.");
          }}
          className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-bold dark:border-slate-700"
        >
          Done
        </button>
      </div>
    </article>
  );
});

function QueueSection({
  title,
  count,
  customers,
  selectedId,
  onSelect,
  onQuickSave,
  selectedPanel,
}: {
  title: string;
  count: number;
  customers: QueueCustomer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
  selectedPanel?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        <span className="text-sm text-slate-500">{count} total</span>
      </div>
      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
          No customers in this section.
        </div>
      ) : (
        <div className="space-y-2">
          {customers.map((customer) => {
            const card = (
              <CustomerCard
                customer={customer}
                active={selectedId === customer.id}
                onOpen={() => onSelect(customer.id)}
                onQuickSave={onQuickSave}
              />
            );
            return selectedId === customer.id && selectedPanel ? (
              <SelectedPartyRow key={customer.id} panel={selectedPanel}>
                {card}
              </SelectedPartyRow>
            ) : (
              <div key={customer.id}>{card}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CustomerCard({
  customer,
  active,
  onOpen,
  onQuickSave,
}: {
  customer: QueueCustomer;
  active: boolean;
  onOpen: () => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const latest = latestFollowUp(customer);
  const priority = customer.smartPriority ?? derivedPriority(customer);
  const priorityName = customer.smartPriorityLabel ?? (priority === "URGENT" ? "Critical" : statusLabel(priority));
  const tone = cardTone(customer);

  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (dy > 45 || Math.abs(dx) < 80) return;
    if (dx > 0) onQuickSave(customer, "COMPLETED", "Marked done from mobile swipe.");
    else onOpen();
  };

  return (
    <article
      data-customer-id={customer.id}
      tabIndex={-1}
      onClick={onOpen}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition [content-visibility:auto] [contain-intrinsic-size:112px] dark:bg-slate-900",
        active && "ring-2 ring-brand-500",
        tone === "red" && "border-red-200 dark:border-red-900",
        tone === "yellow" && "border-amber-200 dark:border-amber-900",
        tone === "green" && "border-emerald-200 dark:border-emerald-900"
      )}
    >
      <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(260px,1fr)_minmax(300px,1.1fr)_170px] lg:items-center">
        <div className="flex min-w-0 items-start gap-2">
        <span
          className={cn(
            "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
            tone === "red" && "bg-red-500",
            tone === "yellow" && "bg-amber-400",
            tone === "green" && "bg-emerald-500"
          )}
        />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base font-bold">{customer.partyName}</h3>
              <BatchBadge tag={customer.batchTag} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
              <span>{displayPhone(customer.contactNumber)}</span>
              <span className="truncate">Ledger: {customer.batchTag ?? customer.partyName}</span>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid gap-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <Info label="Last follow-up" value={formatDateTime(customer.lastFollowupDate ?? latest?.followupDate)} />
            <Info label="Timing" value={followUpTimingLabel(customer.nextFollowupDate ?? latest?.nextFollowupDate, latest?.status === "PAYMENT_PROMISED")} />
          </div>
          <div className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs dark:bg-slate-800/70">
            <p className="line-clamp-1">
              <span className="font-semibold">Last notes: </span>
              {latest?.notes || customer.notes || "No follow-up notes yet."}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>Status: {statusLabel(customer.optimisticStatus ?? latest?.status)}</span>
              <span>Next: {formatDateTime(customer.nextFollowupDate ?? latest?.nextFollowupDate)}</span>
              <span className="truncate">Promise: {latest?.customerResponse || "-"}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-right dark:bg-slate-800/70 lg:text-left">
            <div>
              <p className="text-sm font-extrabold">{formatCurrency(customer.outstandingBalance)}</p>
              <span className={cn("mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", priorityClass(priority))}>
                {priorityName}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white"
            >
              Open Follow-up
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onQuickSave(customer, "COMPLETED", "Marked completed from queue.");
              }}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Quick Complete
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-center text-[11px] text-slate-400 sm:hidden">Swipe right to quick complete, left to open details.</p>
    </article>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:text-brand-200"
    >
      {label}
    </button>
  );
}

function DoneCard({ customer, onOpen }: { customer: QueueCustomer; onOpen: () => void }) {
  const action = customer.todayAction ?? latestFollowUp(customer);
  return (
    <button
      type="button"
      data-customer-id={customer.id}
      onClick={onOpen}
      className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-bold">{customer.partyName}</h3>
            <BatchBadge tag={customer.batchTag} />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">{statusLabel(action?.status)} by {action?.createdBy.name ?? "Staff"}</p>
        </div>
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{formatDateTime(action?.completedAt ?? action?.actionLoggedAt ?? action?.followupDate)}</span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs">{action?.notes || action?.customerResponse || "Completed today."}</p>
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function priorityClass(priority: FollowUpPriority) {
  if (priority === "URGENT") return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100";
  if (priority === "HIGH") return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-100";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function ActionPanel({
  customer,
  canAssignTask,
  canAssignFollowUp,
  staffOptions,
  onClose,
  onOptimistic,
  onSaved,
  onSkip,
}: {
  customer: QueueCustomer | null;
  canAssignTask: boolean;
  canAssignFollowUp: boolean;
  staffOptions: StaffOption[];
  onClose: () => void;
  onOptimistic: (customer: QueueCustomer, status: QueueStatus, notes: string, nextDate: string | null, paidAmount?: number, addToDone?: boolean) => void;
  onSaved: (customerId: string) => Promise<void>;
  onSkip: (customerId: string) => void;
}) {
  const [primaryAction, setPrimaryAction] = useState<PrimaryFollowUpAction>("PAYMENT_UPDATE");
  const [status, setStatus] = useState<QueueStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [priority, setPriority] = useState<FollowUpPriority>("MEDIUM");
  const [paidAmount, setPaidAmount] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [setReminder, setSetReminder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [whatsAppMessage, setWhatsAppMessage] = useState("");
  const [taskMessage, setTaskMessage] = useState("");
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [timelineItems, setTimelineItems] = useState<FollowUpItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const swipeStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const timelineAbortRef = useRef<AbortController | null>(null);

  const loadTimeline = useCallback(async (skip = 0) => {
    if (!customer) return;
    timelineAbortRef.current?.abort();
    const controller = new AbortController();
    timelineAbortRef.current = controller;
    if (skip === 0) {
      setTimelineLoading(true);
      setTimelineItems([]);
    } else {
      setTimelineLoadingMore(true);
    }
    setTimelineError("");
    try {
      const params = new URLSearchParams({ view: "history", customerId: customer.id, skip: String(skip), take: "50" });
      const response = await fetch(`/api/follow-ups?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({})) as Partial<FollowUpHistoryResponse>;
      if (!response.ok || data.success === false || !data.items || !data.pagination) throw new Error(data.error ?? "Could not load follow-up history.");
      if (controller.signal.aborted) return;
      setTimelineItems((current) => skip === 0 ? data.items! : [...current, ...data.items!]);
      setTimelineHasMore(data.pagination.hasMore);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTimelineError(error instanceof Error ? error.message : "Could not load follow-up history.");
    } finally {
      if (timelineAbortRef.current === controller) {
        timelineAbortRef.current = null;
        setTimelineLoading(false);
        setTimelineLoadingMore(false);
      }
    }
  }, [customer]);

  useEffect(() => {
    void loadTimeline(0);
    return () => timelineAbortRef.current?.abort();
  }, [loadTimeline]);

  useEffect(() => {
    if (!customer) return;
    const scheduledSource = "scheduledFollowUp" in customer
      ? (customer as ScheduledQueueCustomer).scheduledFollowUp
      : null;
    const editingOrderFollowUp = isOrderFollowUp(scheduledSource?.followUpType);
    setPrimaryAction(editingOrderFollowUp ? ORDER_FOLLOW_UP : "PAYMENT_UPDATE");
    setStatus(editingOrderFollowUp ? "PENDING" : "PAYMENT_PROMISED");
    setNotes("");
    setCustomerResponse("");
    setPaidAmount("");
    setAssignedToId(editingOrderFollowUp ? scheduledSource?.assignedToId ?? "" : "");
    setSetReminder(false);
    setSaveError("");
    setPriority(derivedPriority(customer));
    const existingDate = reminderInputFromDate(editingOrderFollowUp ? scheduledSource?.scheduledAt : customer.nextFollowupDate);
    setNextDate(existingDate);
    setWhatsAppMessage("");
    setTaskMessage("");
    setSwipeOffset(0);
  }, [customer]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 1279px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!customer) {
    return (
      <aside className="hidden w-full rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 xl:block">
        Select a party to record the next follow-up action.
      </aside>
    );
  }

  const latest = latestFollowUp(customer);
  const scheduledSource = "scheduledFollowUp" in customer
    ? (customer as ScheduledQueueCustomer).scheduledFollowUp
    : null;
  const selectedTone = STATUS_OPTIONS.find((option) => option.value === status)?.tone ?? "border-slate-200 bg-slate-50 text-slate-800";
  const orderFollowUp = primaryAction === ORDER_FOLLOW_UP;
  const showScheduleFields = orderFollowUp || primaryAction === "FOLLOW_UP_LATER" || primaryAction === "NO_RESPONSE" || status === "PAYMENT_PROMISED";
  const selectedReminderDate = reminderDatePart(nextDate);
  const selectedReminderTime = reminderTimePart(nextDate);
  const todayValue = todayReminderDateValue();
  const updateReminderDate = (date: string) => {
    setNextDate(combineReminderDateTime(date, selectedReminderTime || "10:00"));
    setSetReminder(true);
  };

  const updateReminderTime = (time: string) => {
    setNextDate(combineReminderDateTime(selectedReminderDate || todayValue, time));
    setSetReminder(true);
  };

  const reminderMessage = paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate);
  const reminderWhatsAppUrl = whatsappHref(customer.contactNumber, reminderMessage);

  const sendWhatsAppReminder = () => {
    if (!reminderWhatsAppUrl) {
      setWhatsAppMessage("Customer WhatsApp number is missing or invalid.");
      return;
    }

    setPrimaryAction("FOLLOW_UP_LATER");
    setStatus("RESCHEDULED");
    setSetReminder(true);
    if (!notes) setNotes("WhatsApp reminder sent.");
    if (!customerResponse) setCustomerResponse("WhatsApp reminder sent");
    if (!nextDate) setNextDate(defaultReminderDate());

    openWhatsAppUrl(reminderWhatsAppUrl);
    setWhatsAppMessage("WhatsApp opened. Please tap Send.");
  };

  const copyWhatsAppReminder = async () => {
    try {
      await navigator.clipboard.writeText(reminderMessage);
      setWhatsAppMessage("Reminder message copied.");
    } catch {
      setWhatsAppMessage("Could not copy the reminder message.");
    }
  };

  const startSwipe = (event: React.TouchEvent) => {
    if (saving || (event.target as HTMLElement).closest("button, a, input, textarea, select, [role='dialog']")) return;
    const touch = event.touches[0];
    if (touch) swipeStartRef.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  };

  const moveSwipe = (event: React.TouchEvent) => {
    const start = swipeStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (dx > 0 && dx > dy * 1.35) setSwipeOffset(Math.min(dx, 180));
  };

  const endSwipe = (event: React.TouchEvent) => {
    const start = swipeStartRef.current;
    const touch = event.changedTouches[0];
    swipeStartRef.current = null;
    if (!start || !touch) {
      setSwipeOffset(0);
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    const elapsed = Math.max(1, Date.now() - start.at);
    const safeDistance = Math.max(96, Math.min(window.innerWidth * 0.24, 140));
    if (dx >= safeDistance && dx > dy * 1.5 && (elapsed < 900 || dx / elapsed > 0.25)) {
      onSkip(customer.id);
    }
    setSwipeOffset(0);
  };

  const selectPrimaryAction = (action: PrimaryFollowUpAction) => {
    setPrimaryAction(action);
    if (action === "PAYMENT_UPDATE") {
      setStatus("PAYMENT_PROMISED");
      setSetReminder(true);
      if (!nextDate) setNextDate(defaultReminderDate());
    }
    if (action === ORDER_FOLLOW_UP) {
      setStatus("PENDING");
      setSetReminder(true);
      if (!nextDate) setNextDate(defaultReminderDate());
      if (!notes) setNotes("Call customer for a new order.");
    }
    if (action === "FOLLOW_UP_LATER") {
      setStatus("RESCHEDULED");
      setSetReminder(true);
      if (!nextDate) setNextDate(defaultReminderDate());
    }
    if (action === "NO_RESPONSE") {
      setStatus("NOT_REACHABLE");
      setSetReminder(true);
      if (!nextDate) setNextDate(defaultReminderDate());
    }
    if (action === "COMPLETED") {
      setStatus("COMPLETED");
      setSetReminder(false);
    }
  };

  const applyOutcome = (outcome: { value: QueueStatus; notes: string; response?: string }) => {
    setStatus(outcome.value);
    if (!notes) setNotes(outcome.notes);
    if (outcome.response && !customerResponse) setCustomerResponse(outcome.response);
    if (outcome.value === "PAYMENT_PROMISED" || outcome.value === "CALLBACK" || outcome.value === "NOT_REACHABLE") {
      setSetReminder(true);
      if (!nextDate) setNextDate(defaultReminderDate());
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaveError("");
    setSaving(true);
    const closesQueue = COMPLETE_STATUSES.includes(status);
    const scheduledAt = !closesQueue && setReminder && nextDate ? reminderInputToIso(nextDate) : null;
    const amount = status === "PARTIAL_PAID" ? Number(paidAmount) || 0 : status === "PAID" ? customer.outstandingBalance : 0;
    const finalNotes =
      notes ||
      (orderFollowUp && scheduledAt ? `Call customer for a new order on ${formatDateTime(scheduledAt)}.` : "") ||
      (status === "RESCHEDULED" && scheduledAt ? `Follow-up rescheduled to ${formatDateTime(scheduledAt)}.` : "") ||
      (status === "COMPLETED" ? "Follow-up completed." : "") ||
      (status === "PAYMENT_PROMISED" ? "Customer promised payment." : "") ||
      (status === "NOT_REACHABLE" ? "Customer was not reachable." : "") ||
      "Follow-up action recorded.";
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          status,
          priority,
          notes: finalNotes,
          reminderNotes: setReminder && nextDate
            ? orderFollowUp
              ? customerResponse || finalNotes
              : `Callback reminder set for ${formatDateTime(scheduledAt)}`
            : undefined,
          customerResponse: customerResponse || undefined,
          manualReminder: setReminder,
          reminderEnabled: setReminder,
          nextFollowUpDateTime: scheduledAt,
          scheduledAt: setReminder ? scheduledAt : null,
          nextFollowupDate: scheduledAt,
          paidAmount: amount,
          followUpType: orderFollowUp ? ORDER_FOLLOW_UP : undefined,
          assignedToId: orderFollowUp && assignedToId ? assignedToId : undefined,
          sourceModule: "TODAY_FOLLOWUPS",
          summary: orderFollowUp ? "Order Follow-up" : undefined,
          activitySource: orderFollowUp ? "scheduled-order-follow-up" : undefined,
          supersedesFollowUpId: orderFollowUp ? scheduledSource?.id : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save follow-up");
      if (setReminder && scheduledAt) {
        await schedulePwaFollowUpNotification({
          followUpId: data?.followUp?.id ?? data?.data?.followUp?.id,
          customerId: customer.id,
          partyName: customer.partyName,
          amount: customer.outstandingBalance,
          scheduledAt,
          note: customerResponse || finalNotes,
        });
      }
      if (!orderFollowUp) onOptimistic(customer, status, finalNotes, scheduledAt, amount);
      else onOptimistic(customer, "COMPLETED", finalNotes, scheduledAt, 0, false);
      await onSaved(customer.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save follow-up");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="fixed inset-0 z-[60] bg-black/40 xl:relative xl:inset-auto xl:z-0 xl:h-auto xl:w-full xl:min-w-0 xl:self-start xl:bg-transparent">
      <div
        className="ui-surface-elevated ml-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-lg touch-pan-y flex-col overflow-hidden border shadow-xl transition-transform duration-150 xl:max-h-[calc(100dvh-2rem)] xl:min-h-0 xl:max-w-none xl:translate-x-0 xl:rounded-xl xl:shadow-sm"
        style={{ transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined }}
        onTouchStart={startSwipe}
        onTouchMove={moveSwipe}
        onTouchEnd={endSwipe}
        onTouchCancel={() => { swipeStartRef.current = null; setSwipeOffset(0); }}
      >
        <div className="ui-surface-muted grid shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:flex lg:items-start lg:justify-between lg:gap-3 lg:p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close follow-up and return to customer list"
            className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-lg border lg:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-bold uppercase text-brand-600 dark:text-brand-300">What happened?</p>
            <h2 className="mt-1 truncate text-base font-bold sm:text-lg lg:text-xl">{customer.partyName}</h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400 lg:text-sm">{formatCurrency(customer.outstandingBalance)} outstanding</p>
          </div>
          <span className="h-11 w-11 lg:hidden" aria-hidden="true" />
          <div className="hidden items-center gap-2 lg:flex">
            {canAssignTask && (
              <AssignTaskButton
                label="Assign To Staff"
                seed={{
                  customerId: customer.id,
                  customerName: customer.partyName,
                  taskType: orderFollowUp ? "ORDER_FOLLOW_UP" : "PAYMENT_COLLECTION",
                  title: `Follow up with ${customer.partyName}`,
                  notes: `Follow up with ${customer.partyName}\nOutstanding: ${formatCurrency(customer.outstandingBalance)}\n${latest?.notes ?? customer.notes ?? ""}`.trim(),
                  priority: derivedPriority(customer),
                  dueDate: reminderInputFromDate(scheduledSource?.scheduledAt ?? customer.nextFollowupDate) || undefined,
                  sourceEntityType: "FOLLOW_UP",
                  sourceEntityId: scheduledSource?.id ?? latest?.id,
                  referenceUrl: `/customers/${customer.id}`,
                }}
                onAssigned={() => setTaskMessage("Task assigned successfully.")}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-300 px-3 text-xs font-semibold text-brand-700"
              />
            )}
            <button type="button" onClick={onClose} aria-label="Close follow-up" className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-lg border">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
            <div className="grid grid-cols-2 gap-2">
              <a
                href={telHref(customer.contactNumber)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
              >
                <Phone className="h-4 w-4" />
                Call
              </a>
              <button
                type="button"
                onClick={sendWhatsAppReminder}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                Send WhatsApp Reminder
              </button>
              {!reminderWhatsAppUrl && (
                <button
                  type="button"
                  onClick={copyWhatsAppReminder}
                  className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                >
                  <Copy className="h-4 w-4" />
                  Copy Message
                </button>
              )}
              {canAssignTask && (
                <AssignTaskButton
                  seed={{
                    customerId: customer.id,
                    customerName: customer.partyName,
                    taskType: orderFollowUp ? "ORDER_FOLLOW_UP" : "PAYMENT_COLLECTION",
                    title: `Follow up with ${customer.partyName}`,
                    notes: `Follow up with ${customer.partyName}\nOutstanding: ${formatCurrency(customer.outstandingBalance)}\n${latest?.notes ?? customer.notes ?? ""}`.trim(),
                    priority: derivedPriority(customer),
                    dueDate: reminderInputFromDate(scheduledSource?.scheduledAt ?? customer.nextFollowupDate) || undefined,
                    sourceEntityType: "FOLLOW_UP",
                    sourceEntityId: scheduledSource?.id ?? latest?.id,
                    referenceUrl: `/customers/${customer.id}`,
                  }}
                  onAssigned={() => setTaskMessage("Task assigned successfully.")}
                  className="ui-control col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold xl:hidden"
                />
              )}
            </div>
            {whatsAppMessage && (
              <p className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl" role="status">
                {whatsAppMessage}
              </p>
            )}
            {taskMessage && (
              <p className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-xl" role="status">
                {taskMessage}
              </p>
            )}
            {saveError && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                {saveError}
              </div>
            )}

            <div className="ui-surface-muted rounded-xl border p-3">
              <p className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Choose the follow-up outcome</p>
              <div className="grid grid-cols-2 gap-2">
                {PRIMARY_ACTIONS.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    onClick={() => selectPrimaryAction(action.value)}
                    aria-pressed={primaryAction === action.value}
                    className={cn(
                      "min-h-20 rounded-xl border px-3 py-3 text-left transition",
                      primaryAction === action.value
                        ? "ui-control-selected ring-1 ring-[var(--selected-border)]"
                        : "ui-control"
                    )}
                  >
                    <span className="block text-sm font-bold">{action.label}</span>
                    <span className="mt-1 block text-xs opacity-75">{action.description}</span>
                  </button>
                ))}
              </div>
              <div className={cn("mt-3 rounded-xl border px-3 py-2 text-sm font-bold", selectedTone)}>
                Selected outcome: {statusLabel(status)}
              </div>
            </div>

            {primaryAction === "PAYMENT_UPDATE" && (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-sm font-semibold">Payment outcome</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {PAYMENT_OUTCOMES.map((outcome) => (
                    <button
                      key={outcome.label}
                      type="button"
                      onClick={() => applyOutcome(outcome)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm font-semibold",
                        status === outcome.value && notes === outcome.notes
                          ? "border-emerald-500 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-100"
                          : "ui-control"
                      )}
                    >
                      {outcome.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {primaryAction === "NO_RESPONSE" && (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-sm font-semibold">No response reason</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {NO_RESPONSE_OUTCOMES.map((outcome) => (
                    <button
                      key={outcome.label}
                      type="button"
                      onClick={() => applyOutcome(outcome)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm font-semibold",
                        status === outcome.value && notes === outcome.notes
                          ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-100"
                          : "ui-control"
                      )}
                    >
                      {outcome.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {primaryAction === "FOLLOW_UP_LATER" && (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-sm font-semibold">Follow-up action</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {FOLLOW_UP_LATER_OUTCOMES.map((outcome) => (
                    <button
                      key={outcome.label}
                      type="button"
                      onClick={() => applyOutcome(outcome)}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-sm font-semibold",
                        status === outcome.value && notes === outcome.notes
                          ? "border-brand-300 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-100"
                          : "ui-control"
                      )}
                    >
                      {outcome.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {orderFollowUp && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Schedule a call to ask this customer about their next order. This does not create or change an Order Desk order.
              </div>
            )}

            {primaryAction === "COMPLETED" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                This will close the follow-up for this customer. Add a note below if the operator needs context later.
              </div>
            )}

            {(status === "PARTIAL_PAID" || status === "PAID") && (
              <div>
                <label className="text-sm font-semibold">Amount received</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={status === "PAID" ? String(customer.outstandingBalance) : paidAmount}
                  onChange={(event) => setPaidAmount(event.target.value)}
                  disabled={status === "PAID"}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            )}

            <div>
              <label className="text-sm font-semibold">Quick notes</label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Add final call note"
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {NOTE_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    type="button"
                    onClick={() => setNotes(template)}
                    className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                  >
                    {template}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold">{orderFollowUp || primaryAction === "FOLLOW_UP_LATER" ? "Reminder notes" : "Promised payment / response"}</label>
              <input
                value={customerResponse}
                onChange={(event) => setCustomerResponse(event.target.value)}
                placeholder={orderFollowUp ? "Example: ask for next cement requirement" : primaryAction === "FOLLOW_UP_LATER" ? "Example: customer asked callback tomorrow morning" : "Example: promised Rs 10,000 by 6 PM"}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            {showScheduleFields && (
              <div className={cn("rounded-xl border p-3", primaryAction === "FOLLOW_UP_LATER" ? "border-brand-300 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/40" : "border-slate-200 dark:border-slate-800")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-brand-600" />
                    <p className="text-sm font-bold">Next Follow-up Reminder</p>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm dark:bg-slate-900">IST</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <AppDatePicker label="Reminder Date" value={selectedReminderDate} onChange={updateReminderDate} min={todayValue} required />
                  <AppTimePicker label="Reminder Time" value={selectedReminderTime} onChange={updateReminderTime} required />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reminderPresets().map((reminder) => (
                    <button
                      key={reminder.id}
                      type="button"
                      disabled={reminder.disabled}
                      onClick={() => {
                        setNextDate(reminder.value);
                        setSetReminder(true);
                      }}
                      className="ui-control inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm transition disabled:cursor-not-allowed"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      {reminder.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <label className="text-sm font-semibold">Priority</label>
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as FollowUpPriority)}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                  >
                    {(["LOW", "MEDIUM", "HIGH", "URGENT"] as FollowUpPriority[]).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {orderFollowUp && canAssignFollowUp && (
              <label className="block">
                <span className="text-sm font-semibold">Assigned staff</span>
                <select
                  value={assignedToId}
                  onChange={(event) => setAssignedToId(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">Assign to me</option>
                  {staffOptions.map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.name} - {roleLabel(staff.role)}</option>
                  ))}
                </select>
              </label>
            )}

            {showScheduleFields && (
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <input
                  type="checkbox"
                  checked={setReminder}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSetReminder(checked);
                    if (checked && "Notification" in window && Notification.permission === "default") {
                      Notification.requestPermission().catch(() => undefined);
                    }
                  }}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block font-semibold">Set Reminder Notification</span>
                  <span className="text-xs text-slate-500">Notification will send once at the selected callback time only.</span>
                </span>
              </label>
            )}

            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold">Latest follow-up details</p>
              </div>
              <p className="mt-2 text-sm">{latest?.notes || latest?.customerResponse || "No previous note available."}</p>
              <p className="mt-1 text-xs text-slate-500">
                {latest ? `${statusLabel(latest.status)} / ${formatDateTime(latest.followupDate)} / ${latest.createdBy.name}` : "No previous activity"}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <History className="h-4 w-4 text-slate-500" />
                <p className="text-sm font-semibold">Follow-up timeline</p>
              </div>
              <ol className="space-y-3">
                {timelineLoading ? (
                  <li className="flex items-center gap-2 py-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading full follow-up history...</li>
                ) : timelineError ? (
                  <li className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"><p>{timelineError}</p><button type="button" onClick={() => void loadTimeline(0)} className="mt-2 font-semibold underline">Retry</button></li>
                ) : timelineItems.length === 0 ? (
                  <li className="text-sm text-slate-500">No follow-up history yet.</li>
                ) : (
                  timelineItems.map((item) => (
                    <li key={item.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                      <p className="text-sm font-semibold">{item.summary || statusLabel(item.status)}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(item.actionLoggedAt || item.followupDate)} by {item.createdBy.name}
                      </p>
                      {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
                      {item.customerResponse && <p className="mt-1 text-sm">Promise: {item.customerResponse}</p>}
                      {item.reminderNotes && <p className="mt-1 text-sm">Reminder: {item.reminderNotes}</p>}
                      {item.nextFollowUpDateTime && <p className="mt-1 text-xs text-slate-500">Scheduled for {formatDateTime(item.nextFollowUpDateTime)}</p>}
                      {item.completedAt && <p className="mt-1 text-xs text-emerald-700">Completed {formatDateTime(item.completedAt)}</p>}
                      {item.rescheduledAt && <p className="mt-1 text-xs text-slate-500">Rescheduled {formatDateTime(item.rescheduledAt)}</p>}
                    </li>
                  ))
                )}
              </ol>
              {!timelineLoading && !timelineError && timelineHasMore && (
                <button type="button" disabled={timelineLoadingMore} onClick={() => void loadTimeline(timelineItems.length)} className="ui-control mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50">
                  {timelineLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  {timelineLoadingMore ? "Loading..." : "Load more history"}
                </button>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 grid shrink-0 grid-cols-[1fr_auto_auto] gap-2 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_20px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-900">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save and next
            </button>
            <button
              type="button"
              onClick={() => onSkip(customer.id)}
              disabled={saving}
              className="ui-control inline-flex min-h-12 items-center justify-center gap-1 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50"
              aria-label="Skip this follow-up without saving and show the next pending follow-up"
            >
              <SkipForward className="h-4 w-4" />
              <span className="hidden sm:inline">Skip</span>
            </button>
            <Link
              href={`/customers/${customer.id}`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700"
            >
              Profile
            </Link>
          </div>
        </form>
      </div>
    </aside>
  );
}
