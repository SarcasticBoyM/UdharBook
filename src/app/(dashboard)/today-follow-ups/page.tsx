"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  IndianRupee,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  ShieldAlert,
  StickyNote,
  TimerReset,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CustomerStatus, FollowUpPriority, FollowUpStatus } from "@prisma/client";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { displayPhone, telHref } from "@/lib/phone";
import { paymentReminderMessage, whatsappHref } from "@/lib/whatsapp";

type QueueStatus =
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
  scheduledAt: string | null;
  completedAt: string | null;
  rescheduledAt?: string | null;
  actionLoggedAt?: string;
  createdBy: { name: string };
};

type QueueCustomer = {
  id: string;
  partyName: string;
  contactNumber: string;
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
    followUpType: FollowUpStatus;
    notes: string | null;
    reminderNotes: string | null;
    customerResponse: string | null;
    assignedTo: string;
    reminderEnabled: boolean;
    manualReminder: boolean;
    promiseToPay: boolean;
    overdue: boolean;
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

type ScheduledFilterKey = "all" | "today" | "upcoming" | "overdue" | "promise" | "reminder";

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
  { value: "all", label: "All Scheduled" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "promise", label: "Promise To Pay" },
  { value: "reminder", label: "Reminder Set" },
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

const NOTE_TEMPLATES = [
  "Customer promised payment today.",
  "Asked to call again in evening.",
  "Not reachable after multiple attempts.",
  "WhatsApp reminder sent.",
  "Payment collector visit required.",
  "Wrong number confirmed.",
];

const REMINDERS = [
  { label: "In 1 hour", minutes: 60 },
  { label: "In 2 hours", minutes: 120 },
  { label: "Tomorrow 10 AM", tomorrowHour: 10 },
  { label: "Tomorrow 5 PM", tomorrowHour: 17 },
];

function formatDateTime(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function nextReminderDate(minutes?: number, tomorrowHour?: number) {
  const date = new Date();
  if (minutes) date.setMinutes(date.getMinutes() + minutes);
  if (tomorrowHour !== undefined) {
    date.setDate(date.getDate() + 1);
    date.setHours(tomorrowHour, 0, 0, 0);
  }
  return date.toISOString().slice(0, 16);
}

function latestFollowUp(customer: QueueCustomer) {
  return customer.followUps[0] ?? null;
}

function daysOverdue(customer: QueueCustomer) {
  if (!customer.nextFollowupDate) return 0;
  return Math.max(0, Math.floor((startOfToday().getTime() - new Date(customer.nextFollowupDate).getTime()) / 86400000));
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

function scheduledCountdown(date: string | Date) {
  const target = new Date(date);
  const diff = target.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.max(1, Math.round(abs / 60000));
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const unit = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : hours >= 1 ? `${hours}h` : `${minutes}m`;
  if (diff < 0) return `Overdue by ${unit}`;

  const tomorrow = startOfToday();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);
  if (target >= tomorrow && target <= tomorrowEnd) {
    return `Tomorrow ${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(target)}`;
  }
  return `Due in ${unit}`;
}

function matchesScheduledFilter(item: ScheduledQueueCustomer, filter: ScheduledFilterKey) {
  const scheduledAt = new Date(item.scheduledFollowUp.scheduledAt);
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  if (filter === "today") return scheduledAt >= todayStart && scheduledAt <= todayEnd;
  if (filter === "upcoming") return scheduledAt > todayEnd;
  if (filter === "overdue") return scheduledAt < todayStart || scheduledAt.getTime() < Date.now();
  if (filter === "promise") return item.scheduledFollowUp.promiseToPay;
  if (filter === "reminder") return item.scheduledFollowUp.manualReminder || item.scheduledFollowUp.reminderEnabled;
  return true;
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("priority_desc");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledFilterKey>("all");
  const [scheduledCollapsed, setScheduledCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const notifiedIds = useRef<Set<string>>(new Set());

  const mergeQueue = useCallback((data: TodayResponse, reset: boolean) => {
    setScheduled(data.scheduled);
    setPending((current) => {
      const map = new Map((reset ? [] : current).map((customer) => [customer.id, customer]));
      for (const customer of data.pending) map.set(customer.id, { ...map.get(customer.id), ...customer });
      return Array.from(map.values());
    });
    setDone(data.done);
    setSummary(data.summary);
    setSections(data.sections);
    setHasMore(data.pagination.hasMore);
  }, []);

  const loadPage = useCallback(
    async (skip: number, reset = false) => {
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
        const res = await fetch(`/api/today-follow-ups?${params.toString()}`);
        const data = (await res.json()) as TodayResponse;
        mergeQueue(data, reset);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedQuery, filter, mergeQueue, sort]
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
    () => scheduled.filter((customer) => matchesScheduledFilter(customer, scheduledFilter)),
    [scheduled, scheduledFilter]
  );

  const playAlert = useCallback(() => {
    if (!soundEnabled) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 820;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.18);
  }, [soundEnabled]);

  useEffect(() => {
    const checkDue = async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const res = await fetch("/api/notifications/due");
      if (!res.ok) return;
      const data = (await res.json()) as {
        reminders: { id: string; customerId: string; partyName: string; amount: number; scheduledAt: string | null; callbackNote?: string | null; missed: boolean }[];
      };
      const now = Date.now();
      for (const reminder of data.reminders) {
        if (!reminder.scheduledAt || new Date(reminder.scheduledAt).getTime() > now) continue;
        if (notifiedIds.current.has(reminder.id)) continue;
        notifiedIds.current.add(reminder.id);
        playAlert();
        const notification = new Notification(`Follow-up due: ${reminder.partyName}`, {
          body: `${reminder.missed ? "Missed callback." : "Callback time."} Balance ${formatCurrency(reminder.amount)}${reminder.callbackNote ? `. ${reminder.callbackNote}` : ""}`,
          icon: "/icon.svg",
        });
        notification.onclick = () => {
          window.focus();
          setSelectedId(reminder.customerId);
        };
      }
    };
    checkDue();
    const timer = window.setInterval(checkDue, 60000);
    return () => window.clearInterval(timer);
  }, [playAlert]);

  const applyOptimisticAction = (customer: QueueCustomer, status: QueueStatus, notes: string, nextDate: string | null, paidAmount = 0) => {
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
      scheduledAt: nextDate,
      completedAt: COMPLETE_STATUSES.includes(status) ? now : null,
      rescheduledAt: status === "RESCHEDULED" ? now : null,
      actionLoggedAt: now,
      createdBy: { name: "You" },
    };
    const nextBalance = status === "PAID" ? 0 : Math.max(0, customer.outstandingBalance - paidAmount);
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

    const shouldLeaveQueue =
      COMPLETE_STATUSES.includes(status) ||
      status === "RESCHEDULED" ||
      (nextDate ? new Date(nextDate) > endOfToday() : false);

    setPending((current) => (shouldLeaveQueue ? current.filter((item) => item.id !== customer.id) : current.map((item) => (item.id === customer.id ? updated : item))));
    setScheduled((current) => current.filter((item) => item.id !== customer.id));
    setDone((current) => [updated, ...current.filter((item) => item.id !== customer.id)]);
    setSummary((current) => ({
      ...current,
      pending: shouldLeaveQueue ? Math.max(0, current.pending - 1) : current.pending,
      completed: current.completed + 1,
      recoveryToday: current.recoveryToday + paidAmount,
    }));
  };

  const quickSave = async (customer: QueueCustomer, status: QueueStatus, notes: string) => {
    const nextDate = status === "RESCHEDULED" ? nextReminderDate(undefined, 10) : customer.nextFollowupDate;
    const paidAmount = status === "PAID" ? customer.outstandingBalance : 0;
    applyOptimisticAction(customer, status, notes, nextDate, paidAmount);
    await fetch("/api/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        status,
        priority: derivedPriority(customer),
        notes,
        scheduledAt: nextDate,
        nextFollowupDate: nextDate,
        paidAmount,
      }),
    });
  };

  return (
    <div className="mx-auto max-w-7xl pb-24">
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

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="space-y-5">
          <ScheduledQueueSection
            customers={visibleScheduled}
            total={scheduled.length}
            overdueCount={summary.scheduledOverdue}
            selectedId={selectedId}
            filter={scheduledFilter}
            collapsed={scheduledCollapsed}
            onFilterChange={setScheduledFilter}
            onToggle={() => setScheduledCollapsed((value) => !value)}
            onSelect={setSelectedId}
            onQuickSave={quickSave}
          />

          {loading ? (
            <div className="flex min-h-56 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          ) : pending.length === 0 && filter !== "done" ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              No pending customers match this view.
            </div>
          ) : (
            <>
              <QueueSection
                title="Urgent Recovery"
                count={sections.urgent}
                customers={pendingSections.urgent}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onQuickSave={quickSave}
              />
              <QueueSection
                title="Today's Follow-ups"
                count={sections.today}
                customers={pendingSections.today}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onQuickSave={quickSave}
              />
              <QueueSection
                title="Recently Contacted"
                count={sections.recent}
                customers={pendingSections.recent}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onQuickSave={quickSave}
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
            <div className="space-y-3">
              {done.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                  Completed actions will appear here as staff works the queue.
                </div>
              ) : (
                done.map((customer) => (
                  <DoneCard key={`${customer.id}-${customer.todayAction?.id ?? "done"}`} customer={customer} onOpen={() => setSelectedId(customer.id)} />
                ))
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

        <ActionPanel
          customer={selected}
          onClose={() => setSelectedId(null)}
          onOptimistic={applyOptimisticAction}
          onSaved={() => {
            setSelectedId(null);
            loadPage(0, true);
          }}
        />
      </div>
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
  onToggle,
  onSelect,
  onQuickSave,
}: {
  customers: ScheduledQueueCustomer[];
  total: number;
  overdueCount: number;
  selectedId: string | null;
  filter: ScheduledFilterKey;
  collapsed: boolean;
  onFilterChange: (filter: ScheduledFilterKey) => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-sm dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-700 dark:text-blue-300" />
            <h2 className="text-lg font-bold">Scheduled Follow-ups</h2>
          </div>
          <p className="mt-1 text-sm text-blue-900/70 dark:text-blue-100/70">
            {total} manually scheduled, {overdueCount} overdue
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {SCHEDULED_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onFilterChange(item.value)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-2 text-xs font-semibold",
                  filter === item.value
                    ? "border-blue-700 bg-blue-700 text-white"
                    : "border-blue-200 bg-white text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {customers.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-blue-300 bg-white/80 p-5 text-center text-sm text-blue-900/70 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100/70">
              No scheduled follow-ups match this view.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {customers.map((customer) => (
                <ScheduledFollowUpCard
                  key={customer.scheduledFollowUp.id}
                  customer={customer}
                  active={selectedId === customer.id}
                  onOpen={() => onSelect(customer.id)}
                  onQuickSave={onQuickSave}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ScheduledFollowUpCard({
  customer,
  active,
  onOpen,
  onQuickSave,
}: {
  customer: ScheduledQueueCustomer;
  active: boolean;
  onOpen: () => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
}) {
  const scheduled = customer.scheduledFollowUp;
  const dueAt = new Date(scheduled.scheduledAt);
  const overdue = dueAt.getTime() < Date.now();
  const latest = latestFollowUp(customer);
  const notes = scheduled.notes || scheduled.customerResponse || scheduled.reminderNotes || latest?.notes || customer.notes || "No notes added.";

  return (
    <article
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition dark:bg-slate-900",
        active && "ring-2 ring-blue-500",
        overdue ? "border-red-300 dark:border-red-900" : "border-blue-200 dark:border-blue-900"
      )}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-bold">{customer.partyName}</h3>
            {scheduled.promiseToPay && <Badge tone="violet">Promise to pay</Badge>}
            {(scheduled.manualReminder || scheduled.reminderEnabled) && <Badge tone="blue">Reminder set</Badge>}
            {overdue && <Badge tone="red">Overdue</Badge>}
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{displayPhone(customer.contactNumber)}</p>
          <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{notes}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-4 lg:grid-cols-2">
          <Info label="Balance" value={formatCurrency(customer.outstandingBalance)} />
          <Info label="Scheduled" value={formatDateTime(dueAt)} />
          <Info label="Type" value={statusLabel(scheduled.followUpType)} />
          <Info label="Assigned" value={scheduled.assignedTo || "Staff"} />
        </div>

        <div className="flex flex-col gap-2 lg:min-w-40">
          <span className={cn("rounded-full px-3 py-1 text-center text-xs font-bold", overdue ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100" : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100")}>
            {scheduledCountdown(dueAt)}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <QuickButton label="Open" onClick={onOpen} />
            <QuickButton label="Called" onClick={() => onQuickSave(customer, "CONTACTED", "Marked called from scheduled queue.")} />
            <QuickButton label="Reschedule" onClick={onOpen} />
            <QuickButton label="Complete" onClick={() => onQuickSave(customer, "COMPLETED", "Completed scheduled follow-up.")} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "red" | "violet" }) {
  const classes = {
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100",
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-100",
  }[tone];
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", classes)}>{children}</span>;
}

function QueueSection({
  title,
  count,
  customers,
  selectedId,
  onSelect,
  onQuickSave,
}: {
  title: string;
  count: number;
  customers: QueueCustomer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
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
        <div className="space-y-3">
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              active={selectedId === customer.id}
              onOpen={() => onSelect(customer.id)}
              onQuickSave={onQuickSave}
            />
          ))}
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
  const lastPayment = customer.payments[0];
  const priority = customer.smartPriority ?? derivedPriority(customer);
  const priorityName = customer.smartPriorityLabel ?? (priority === "URGENT" ? "Critical" : statusLabel(priority));
  const tone = cardTone(customer);
  const overdue = daysOverdue(customer);

  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (dy > 45 || Math.abs(dx) < 80) return;
    if (dx > 0) onQuickSave(customer, "COMPLETED", "Marked done from mobile swipe.");
    else onQuickSave(customer, "RESCHEDULED", "Rescheduled from mobile swipe.");
  };

  return (
    <article
      onClick={onOpen}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={handleTouchEnd}
      className={cn(
        "cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition dark:bg-slate-900",
        active && "ring-2 ring-brand-500",
        tone === "red" && "border-red-200 dark:border-red-900",
        tone === "yellow" && "border-amber-200 dark:border-amber-900",
        tone === "green" && "border-emerald-200 dark:border-emerald-900"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 h-3 w-3 shrink-0 rounded-full",
            tone === "red" && "bg-red-500",
            tone === "yellow" && "bg-amber-400",
            tone === "green" && "bg-emerald-500"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold">{customer.partyName}</h3>
              <p className="truncate text-sm text-slate-500">Business/shop: {customer.partyName}</p>
              <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{displayPhone(customer.contactNumber)}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-extrabold">{formatCurrency(customer.outstandingBalance)}</p>
              <span className={cn("mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", priorityClass(priority))}>
                {priorityName}
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Last payment" value={lastPayment ? `${formatCurrency(lastPayment.amount)} / ${formatDate(lastPayment.paidAt)}` : "-"} />
            <Info label="Last follow-up" value={formatDateTime(customer.lastFollowupDate ?? latest?.followupDate)} />
            <Info label="Next follow-up" value={formatDateTime(customer.nextFollowupDate ?? latest?.nextFollowupDate)} />
            <Info label="Overdue" value={overdue ? `${overdue} day${overdue === 1 ? "" : "s"}` : "Due today"} />
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/70">
            <p className="line-clamp-2">
              <span className="font-semibold">Last notes: </span>
              {latest?.notes || customer.notes || "No follow-up notes yet."}
            </p>
            <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
              <span>Status: {statusLabel(customer.optimisticStatus ?? latest?.status)}</span>
              <span>Promise: {latest?.customerResponse || "-"}</span>
              <span>Staff: {latest?.createdBy.name || "Unassigned"}</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={telHref(customer.contactNumber)}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-950 sm:flex-none"
            >
              <Phone className="h-4 w-4" />
              Call
            </a>
            <a
              href={whatsappHref(customer.contactNumber, paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white sm:flex-none"
            >
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </a>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onQuickSave(customer, "COMPLETED", "Marked done from queue.");
              }}
              className="hidden min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700 sm:inline-flex"
            >
              <CheckCircle2 className="h-4 w-4" />
              Done
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <QuickButton label="Paid" onClick={() => onQuickSave(customer, "PAID", "Paid from quick action.")} />
            <QuickButton label="Call Later" onClick={() => onQuickSave(customer, "RESCHEDULED", "Customer asked to call later.")} />
            <QuickButton label="Promise" onClick={() => onQuickSave(customer, "PAYMENT_PROMISED", "Customer promised payment.")} />
            <QuickButton label="No Answer" onClick={() => onQuickSave(customer, "NOT_REACHABLE", "Customer not responding.")} />
            <QuickButton label="Reschedule" onClick={() => onQuickSave(customer, "RESCHEDULED", "Rescheduled from queue.")} />
            <QuickButton label="Complete" onClick={() => onQuickSave(customer, "COMPLETED", "Marked completed from queue.")} />
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400 sm:hidden">Swipe right to mark done, left to reschedule.</p>
        </div>
      </div>
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
      className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
      onClick={onOpen}
      className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-bold">{customer.partyName}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">{statusLabel(action?.status)} by {action?.createdBy.name ?? "Staff"}</p>
        </div>
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{formatDateTime(action?.completedAt ?? action?.actionLoggedAt ?? action?.followupDate)}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{action?.notes || action?.customerResponse || "Completed today."}</p>
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
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
  onClose,
  onOptimistic,
  onSaved,
}: {
  customer: QueueCustomer | null;
  onClose: () => void;
  onOptimistic: (customer: QueueCustomer, status: QueueStatus, notes: string, nextDate: string | null, paidAmount?: number) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<QueueStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [priority, setPriority] = useState<FollowUpPriority>("MEDIUM");
  const [paidAmount, setPaidAmount] = useState("");
  const [setReminder, setSetReminder] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer) return;
    setStatus("CONTACTED");
    setNotes("");
    setCustomerResponse("");
    setPaidAmount("");
    setSetReminder(false);
    setPriority(derivedPriority(customer));
    setNextDate(customer.nextFollowupDate ? new Date(customer.nextFollowupDate).toISOString().slice(0, 16) : "");
  }, [customer]);

  if (!customer) {
    return (
      <aside className="hidden rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 xl:block">
        Select a party to record the next follow-up action.
      </aside>
    );
  }

  const latest = latestFollowUp(customer);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const scheduledAt = nextDate ? new Date(nextDate).toISOString() : null;
    const amount = status === "PARTIAL_PAID" ? Number(paidAmount) || 0 : status === "PAID" ? customer.outstandingBalance : 0;
    onOptimistic(customer, status, notes, scheduledAt, amount);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          status,
          priority,
          notes: notes || undefined,
          reminderNotes: setReminder && nextDate ? `Callback reminder set for ${formatDateTime(scheduledAt)}` : undefined,
          customerResponse: customerResponse || undefined,
          manualReminder: setReminder,
          reminderEnabled: setReminder,
          nextFollowUpDateTime: setReminder && scheduledAt ? scheduledAt : null,
          scheduledAt: setReminder ? scheduledAt : null,
          nextFollowupDate: scheduledAt,
          paidAmount: amount,
        }),
      });
      if (!res.ok) throw new Error("Could not save follow-up");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-3 xl:sticky xl:top-4 xl:z-0 xl:block xl:h-[calc(100vh-2rem)] xl:bg-transparent xl:p-0">
      <div className="ml-auto flex min-h-full w-full max-w-lg flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 xl:min-h-0 xl:shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-bold">{customer.partyName}</h2>
            <p className="text-sm text-slate-500">{formatCurrency(customer.outstandingBalance)} outstanding</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-2">
              <a
                href={telHref(customer.contactNumber)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
              >
                <Phone className="h-4 w-4" />
                Call
              </a>
              <a
                href={whatsappHref(customer.contactNumber, paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Quick status</p>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 text-sm font-semibold",
                      status === option.value
                        ? option.tone
                        : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

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
              <label className="text-sm font-semibold">Promised payment / response</label>
              <input
                value={customerResponse}
                onChange={(event) => setCustomerResponse(event.target.value)}
                placeholder="Example: promised Rs 10,000 by 6 PM"
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Next date and exact time</label>
                <input
                  type="datetime-local"
                  value={nextDate}
                  onChange={(event) => setNextDate(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="text-sm font-semibold">Reminder priority</label>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as FollowUpPriority)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as FollowUpPriority[]).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {REMINDERS.map((reminder) => (
                <button
                  key={reminder.label}
                  type="button"
                  onClick={() => setNextDate(nextReminderDate(reminder.minutes, reminder.tomorrowHour))}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium dark:bg-slate-800"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {reminder.label}
                </button>
              ))}
            </div>

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
                  if (checked && status !== "CALLBACK" && status !== "FOLLOW_UP_REQUIRED") setStatus("CALLBACK");
                }}
                className="mt-1 h-4 w-4"
              />
              <span>
                <span className="block font-semibold">Set Reminder Notification</span>
                <span className="text-xs text-slate-500">Notification will send once at the selected callback time only.</span>
              </span>
            </label>

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
                {customer.followUps.length === 0 ? (
                  <li className="text-sm text-slate-500">No follow-up history yet.</li>
                ) : (
                  customer.followUps.map((item) => (
                    <li key={item.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                      <p className="text-sm font-semibold">{statusLabel(item.status)}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(item.followupDate)} by {item.createdBy.name}
                      </p>
                      {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
                      {item.customerResponse && <p className="mt-1 text-sm">Promise: {item.customerResponse}</p>}
                    </li>
                  ))
                )}
              </ol>
            </div>
          </div>

          <div className="sticky bottom-0 grid grid-cols-[1fr_auto] gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save and next
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
