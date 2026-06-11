"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { paymentReminderMessage, whatsappHref, whatsappShareText } from "@/lib/whatsapp";

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
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Due Today" },
  { value: "overdue", label: "Overdue" },
  { value: "promise", label: "Promise To Pay" },
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

type PrimaryFollowUpAction = "PAYMENT_UPDATE" | "FOLLOW_UP_LATER" | "NO_RESPONSE" | "COMPLETED";

const PRIMARY_ACTIONS: { value: PrimaryFollowUpAction; label: string; description: string }[] = [
  { value: "PAYMENT_UPDATE", label: "Payment Update", description: "Promise, payment, or cheque" },
  { value: "FOLLOW_UP_LATER", label: "Follow-up Later", description: "Reschedule with reminder" },
  { value: "NO_RESPONSE", label: "No Response", description: "Not reachable or busy" },
  { value: "COMPLETED", label: "Completed", description: "Close this follow-up" },
];

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

const REMINDERS = [
  { label: "In 1 hour", minutes: 60 },
  { label: "In 2 hours", minutes: 120 },
  { label: "Tomorrow 10 AM", tomorrowHour: 10 },
  { label: "Tomorrow 5 PM", tomorrowHour: 17 },
];

const APP_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

function istParts(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function reminderInputFromDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const parts = istParts(value);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function reminderInputToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60000;
  return new Date(utcMs).toISOString();
}

function todayReminderDateValue() {
  return reminderDatePart(reminderInputFromDate(new Date()));
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

function nextReminderDate(minutes?: number, tomorrowHour?: number) {
  const date = new Date(Date.now() + (minutes ?? 0) * 60000);
  if (tomorrowHour !== undefined) {
    const current = istParts(new Date());
    const utcMs = Date.UTC(current.year, current.month - 1, current.day + 1, tomorrowHour, 0) - IST_OFFSET_MINUTES * 60000;
    return reminderInputFromDate(new Date(utcMs));
  }
  return reminderInputFromDate(date);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function reminderDatePart(value: string) {
  return value ? value.slice(0, 10) : "";
}

function reminderTimePart(value: string) {
  return value ? value.slice(11, 16) : "";
}

function combineReminderDateTime(date: string, time: string) {
  if (!date) return "";
  return `${date}T${time || "10:00"}`;
}

function monthStart(value: string) {
  const base = value ? new Date(`${reminderDatePart(value)}T00:00:00`) : new Date();
  return new Date(base.getFullYear(), base.getMonth(), 1);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(date);
}

function dateButtonLabel(value: string) {
  if (!value) return "Select date";
  const [year, month, day] = reminderDatePart(value).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function timeButtonLabel(value: string) {
  const time = reminderTimePart(value);
  if (!time) return "Select time";
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function calendarCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = first.getDay();
  const cells: { value: string; label: number; muted: boolean }[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(first);
    date.setDate(index - offset + 1);
    cells.push({
      value: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      label: date.getDate(),
      muted: date.getMonth() !== month.getMonth(),
    });
  }
  return cells;
}

const REMINDER_TIME_OPTIONS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
];

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
  const [scheduledCollapsed, setScheduledCollapsed] = useState(false);
  const [lightweightMode, setLightweightMode] = useState(false);
  const [totalActiveCustomers, setTotalActiveCustomers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const notifiedIds = useRef<Set<string>>(new Set());

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
        const res = await fetch(`/api/today-follow-ups?${params.toString()}`);
        const data = (await res.json()) as TodayResponse;
        mergeQueue(data, reset);
      } finally {
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
    const nextDate = status === "RESCHEDULED" ? reminderInputToIso(nextReminderDate(undefined, 10)) : customer.nextFollowupDate;
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
    <div className="mx-auto w-full max-w-none pb-24">
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

      <div className="mt-4 grid w-full min-w-0 gap-5 xl:grid-cols-[minmax(680px,68fr)_minmax(320px,32fr)]">
        <main className="min-w-0 space-y-5">
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
          ) : lightweightMode ? (
            <>
              <CompactQueueSection
                customers={pending}
                total={summary.pending}
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
  const grouped = {
    overdue: customers.filter((customer) => scheduledGroupFor(customer) === "overdue"),
    today: customers.filter((customer) => scheduledGroupFor(customer) === "today"),
    upcoming: customers.filter((customer) => scheduledGroupFor(customer) === "upcoming"),
  };

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,auto)] lg:items-start">
        <div className="min-w-0 max-w-3xl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate whitespace-nowrap text-xl font-bold leading-tight text-slate-950 dark:text-white">Scheduled Follow-ups</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {total} scheduled recovery reminders, sorted by what needs attention next.
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
          <div className="mt-5 overflow-x-auto pb-1">
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
            <div className="mt-5 space-y-5">
              <ScheduledGroup
                title="Overdue"
                description="Missed reminder time. Work these first."
                customers={grouped.overdue}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
              />
              <ScheduledGroup
                title="Due Today"
                description="Sorted by nearest reminder time."
                customers={grouped.today}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
              />
              <ScheduledGroup
                title="Upcoming"
                description="Future reminders stay here until due."
                customers={grouped.upcoming}
                selectedId={selectedId}
                onSelect={onSelect}
                onQuickSave={onQuickSave}
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
}: {
  title: string;
  description: string;
  customers: ScheduledQueueCustomer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
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
      <div className="min-w-0 space-y-3">
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
    </div>
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
  const overdue = scheduled.overdue || isPastDue(dueAt);
  const group = scheduledGroupFor(customer);
  const latest = latestFollowUp(customer);
  const notes = scheduled.notes || scheduled.customerResponse || scheduled.reminderNotes || latest?.notes || customer.notes || "No notes added.";
  const isPromise = Boolean(scheduled.promiseToPay);
  const isReminder = Boolean(scheduled.manualReminder || scheduled.reminderEnabled);
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
      onClick={onOpen}
      className={cn(
        "min-w-0 cursor-pointer overflow-hidden rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 sm:p-5",
        cardTone,
        active && "ring-2 ring-brand-500"
      )}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(190px,220px)_150px] 2xl:grid-cols-[minmax(360px,1fr)_minmax(220px,260px)_170px] xl:items-stretch">
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-lg font-extrabold text-slate-950 dark:text-white">{customer.partyName}</h3>
                <BatchBadge tag={customer.batchTag} />
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{displayPhone(customer.contactNumber)}</p>
            </div>
          </div>
          <p className="line-clamp-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{notes}</p>
          <div className="flex flex-wrap gap-2">
            {isPromise && <Badge tone="violet">Promise to pay</Badge>}
            {isReminder && <Badge tone="blue">Reminder set</Badge>}
            <Badge tone="slate">{statusLabel(scheduled.followUpType)}</Badge>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-white/80 bg-white/80 p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Outstanding</p>
              <p className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{formatCurrency(customer.outstandingBalance)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">
                {isPromise ? "Payment Expected" : "Scheduled For"}
              </p>
              <p className="mt-1 text-sm font-bold leading-5 text-slate-800 dark:text-slate-100">{formatDateTime(dueAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Priority: {customer.smartPriorityLabel || statusLabel(customer.smartPriority)}
              </span>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                By {scheduled.assignedTo || "Staff"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 xl:min-w-[150px] 2xl:min-w-[170px]">
          <Badge tone={stateTone}>{stateLabel}</Badge>
          <span className={cn("rounded-xl px-3 py-2 text-center text-xs font-extrabold leading-5", badgeToneClass(stateTone))}>
            {followUpTimingLabel(dueAt, scheduled.promiseToPay)}
          </span>
          <QuickButton label="Open Follow-up" onClick={onOpen} />
          <QuickButton label="Quick Complete" onClick={() => onQuickSave(customer, "COMPLETED", "Completed scheduled follow-up.")} />
        </div>
      </div>
      <div className="mt-4 flex min-w-0 items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
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
}: {
  customers: QueueCustomer[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickSave: (customer: QueueCustomer, status: QueueStatus, notes: string) => Promise<void>;
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
        {customers.map((customer) => (
          <CompactCustomerCard
            key={customer.id}
            customer={customer}
            active={selectedId === customer.id}
            onOpen={() => onSelect(customer.id)}
            onQuickSave={onQuickSave}
          />
        ))}
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
      onClick={onOpen}
      className={cn(
        "grid min-h-20 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 transition [contain-intrinsic-size:96px] [content-visibility:auto] hover:bg-slate-50 dark:hover:bg-slate-800/60 sm:grid-cols-[minmax(220px,1fr)_150px_150px_160px]",
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
          className="min-h-10 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white"
        >
          Open
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onQuickSave(customer, "COMPLETED", "Marked completed from compact queue.");
          }}
          className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-bold dark:border-slate-700"
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
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-lg font-bold">{customer.partyName}</h3>
                <BatchBadge tag={customer.batchTag} />
              </div>
              <p className="truncate text-sm text-slate-500">Ledger: {customer.batchTag ?? customer.partyName}</p>
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
            <Info label="Timing" value={followUpTimingLabel(customer.nextFollowupDate ?? latest?.nextFollowupDate, latest?.status === "PAYMENT_PROMISED")} />
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

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white"
            >
              Open Follow-up
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onQuickSave(customer, "COMPLETED", "Marked completed from queue.");
              }}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700"
            >
              <CheckCircle2 className="h-4 w-4" />
              Quick Complete
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400 sm:hidden">Swipe right to quick complete, left to open details.</p>
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
      className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:text-brand-200"
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
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-bold">{customer.partyName}</h3>
            <BatchBadge tag={customer.batchTag} />
          </div>
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
  const [primaryAction, setPrimaryAction] = useState<PrimaryFollowUpAction>("PAYMENT_UPDATE");
  const [status, setStatus] = useState<QueueStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [priority, setPriority] = useState<FollowUpPriority>("MEDIUM");
  const [paidAmount, setPaidAmount] = useState("");
  const [setReminder, setSetReminder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [whatsAppMessage, setWhatsAppMessage] = useState("");
  const [visibleReminderMonth, setVisibleReminderMonth] = useState(() => monthStart(""));

  useEffect(() => {
    if (!customer) return;
    setPrimaryAction("PAYMENT_UPDATE");
    setStatus("PAYMENT_PROMISED");
    setNotes("");
    setCustomerResponse("");
    setPaidAmount("");
    setSetReminder(false);
    setPriority(derivedPriority(customer));
    const existingDate = reminderInputFromDate(customer.nextFollowupDate);
    setNextDate(existingDate);
    setVisibleReminderMonth(monthStart(existingDate));
    setDatePickerOpen(false);
    setTimePickerOpen(false);
    setWhatsAppMessage("");
  }, [customer]);

  if (!customer) {
    return (
      <aside className="hidden w-full rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 xl:block">
        Select a party to record the next follow-up action.
      </aside>
    );
  }

  const latest = latestFollowUp(customer);
  const selectedTone = STATUS_OPTIONS.find((option) => option.value === status)?.tone ?? "border-slate-200 bg-slate-50 text-slate-800";
  const showScheduleFields = primaryAction === "FOLLOW_UP_LATER" || primaryAction === "NO_RESPONSE" || status === "PAYMENT_PROMISED";
  const selectedReminderDate = reminderDatePart(nextDate);
  const selectedReminderTime = reminderTimePart(nextDate);
  const todayValue = todayReminderDateValue();
  const visibleCalendarCells = calendarCells(visibleReminderMonth);
  const updateReminderDate = (date: string) => {
    setNextDate(combineReminderDateTime(date, selectedReminderTime || "10:00"));
    setVisibleReminderMonth(monthStart(`${date}T${selectedReminderTime || "10:00"}`));
    setSetReminder(true);
    setDatePickerOpen(false);
  };

  const updateReminderTime = (time: string) => {
    setNextDate(combineReminderDateTime(selectedReminderDate || todayValue, time));
    setSetReminder(true);
    setTimePickerOpen(false);
  };

  const reminderMessage = paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate);
  const reminderWhatsAppUrl = whatsappHref(customer.contactNumber, reminderMessage);

  const sendWhatsAppReminder = async () => {
    setWhatsAppMessage("");
    setPrimaryAction("FOLLOW_UP_LATER");
    setStatus("RESCHEDULED");
    setSetReminder(true);
    if (!notes) setNotes("WhatsApp reminder sent.");
    if (!customerResponse) setCustomerResponse("WhatsApp reminder sent");
    if (!nextDate) setNextDate(nextReminderDate(undefined, 10));

    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && navigator.share) {
      try {
        await navigator.share({
          title: `Reminder for ${customer.partyName}`,
          text: whatsappShareText(customer.contactNumber, reminderMessage),
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWhatsAppMessage("Could not open Android share chooser. Opening WhatsApp Web instead.");
      }
    }
    window.open(reminderWhatsAppUrl, "_blank", "noopener,noreferrer");
  };

  const selectPrimaryAction = (action: PrimaryFollowUpAction) => {
    setPrimaryAction(action);
    if (action === "PAYMENT_UPDATE") {
      setStatus("PAYMENT_PROMISED");
      setSetReminder(true);
      if (!nextDate) setNextDate(nextReminderDate(undefined, 10));
    }
    if (action === "FOLLOW_UP_LATER") {
      setStatus("RESCHEDULED");
      setSetReminder(true);
      if (!nextDate) setNextDate(nextReminderDate(undefined, 10));
    }
    if (action === "NO_RESPONSE") {
      setStatus("NOT_REACHABLE");
      setSetReminder(true);
      if (!nextDate) setNextDate(nextReminderDate(undefined, 10));
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
      if (!nextDate) setNextDate(nextReminderDate(undefined, 10));
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const closesQueue = COMPLETE_STATUSES.includes(status);
    const scheduledAt = !closesQueue && nextDate ? reminderInputToIso(nextDate) : null;
    const amount = status === "PARTIAL_PAID" ? Number(paidAmount) || 0 : status === "PAID" ? customer.outstandingBalance : 0;
    const finalNotes =
      notes ||
      (status === "RESCHEDULED" && scheduledAt ? `Follow-up rescheduled to ${formatDateTime(scheduledAt)}.` : "") ||
      (status === "COMPLETED" ? "Follow-up completed." : "") ||
      (status === "PAYMENT_PROMISED" ? "Customer promised payment." : "") ||
      (status === "NOT_REACHABLE" ? "Customer was not reachable." : "") ||
      "Follow-up action recorded.";
    onOptimistic(customer, status, finalNotes, scheduledAt, amount);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          status,
          priority,
          notes: finalNotes,
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
    <aside className="fixed inset-0 z-40 overflow-y-auto bg-black/40 p-3 xl:sticky xl:top-5 xl:z-0 xl:block xl:h-[calc(100vh-2.5rem)] xl:w-full xl:min-w-0 xl:overflow-visible xl:bg-transparent xl:p-0">
      <div className="ml-auto flex min-h-full w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 xl:h-full xl:min-h-0 xl:max-w-none xl:overflow-hidden xl:shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
          <div>
            <p className="text-xs font-bold uppercase text-brand-600 dark:text-brand-300">What happened?</p>
            <h2 className="mt-1 text-xl font-bold">{customer.partyName}</h2>
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
              <button
                type="button"
                onClick={sendWhatsAppReminder}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                Send WhatsApp Reminder
              </button>
            </div>
            {whatsAppMessage && <p className="-mt-2 text-xs font-semibold text-amber-700">{whatsAppMessage}</p>}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Choose the recovery outcome</p>
              <div className="grid grid-cols-2 gap-2">
                {PRIMARY_ACTIONS.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    onClick={() => selectPrimaryAction(action.value)}
                    className={cn(
                      "min-h-20 rounded-xl border bg-white px-3 py-3 text-left transition dark:bg-slate-900",
                      primaryAction === action.value
                        ? "border-brand-500 bg-brand-50 text-brand-900 ring-1 ring-brand-500 dark:bg-brand-950 dark:text-brand-100"
                        : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      )}
                    >
                      {outcome.label}
                    </button>
                  ))}
                </div>
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
              <label className="text-sm font-semibold">{primaryAction === "FOLLOW_UP_LATER" ? "Reminder notes" : "Promised payment / response"}</label>
              <input
                value={customerResponse}
                onChange={(event) => setCustomerResponse(event.target.value)}
                placeholder={primaryAction === "FOLLOW_UP_LATER" ? "Example: customer asked callback tomorrow morning" : "Example: promised Rs 10,000 by 6 PM"}
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
                  <div className="relative min-w-0">
                    <label className="text-sm font-semibold">Reminder Date</label>
                    <button
                      type="button"
                      onClick={() => {
                        setDatePickerOpen((open) => !open);
                        setTimePickerOpen(false);
                      }}
                      className="mt-2 flex min-h-12 w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-3 text-left text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                    >
                      <span>{dateButtonLabel(nextDate)}</span>
                      <CalendarClock className="h-4 w-4 text-brand-600" />
                    </button>
                    {datePickerOpen && (
                      <div className="absolute left-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:w-80">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setVisibleReminderMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                            aria-label="Previous month"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{monthLabel(visibleReminderMonth)}</p>
                          <button
                            type="button"
                            onClick={() => setVisibleReminderMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-sm font-bold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                            aria-label="Next month"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400">
                          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
                        </div>
                        <div className="mt-2 grid grid-cols-7 gap-1">
                          {visibleCalendarCells.map((day) => (
                            <button
                              key={day.value}
                              type="button"
                              onClick={() => updateReminderDate(day.value)}
                              className={cn(
                                "flex aspect-square min-h-9 items-center justify-center rounded-lg text-sm font-bold transition",
                                day.value === selectedReminderDate
                                  ? "bg-brand-600 text-white"
                                  : day.value === todayValue
                                    ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
                                    : "hover:bg-slate-100 dark:hover:bg-slate-800",
                                day.muted && day.value !== selectedReminderDate ? "text-slate-300 dark:text-slate-600" : ""
                              )}
                            >
                              {day.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative min-w-0">
                    <label className="text-sm font-semibold">Reminder Time</label>
                    <button
                      type="button"
                      onClick={() => {
                        setTimePickerOpen((open) => !open);
                        setDatePickerOpen(false);
                      }}
                      className="mt-2 flex min-h-12 w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-3 text-left text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                    >
                      <span>{timeButtonLabel(nextDate)}</span>
                      <Clock3 className="h-4 w-4 text-brand-600" />
                    </button>
                    {timePickerOpen && (
                      <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-[280px] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:w-80">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold uppercase text-slate-500">Pick callback time</p>
                            <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-white">{timeButtonLabel(nextDate)}</p>
                          </div>
                          <Clock3 className="h-5 w-5 text-brand-600" />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {REMINDER_TIME_OPTIONS.map((time) => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => updateReminderTime(time)}
                              className={cn(
                                "min-h-11 rounded-lg border px-3 text-sm font-bold transition",
                                time === selectedReminderTime
                                  ? "border-brand-500 bg-brand-600 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                              )}
                            >
                              {timeButtonLabel(`2000-01-01T${time}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {REMINDERS.map((reminder) => (
                    <button
                      key={reminder.label}
                      type="button"
                      onClick={() => {
                        const reminderDate = nextReminderDate(reminder.minutes, reminder.tomorrowHour);
                        setNextDate(reminderDate);
                        setVisibleReminderMonth(monthStart(reminderDate));
                        setSetReminder(true);
                        setDatePickerOpen(false);
                        setTimePickerOpen(false);
                      }}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:text-brand-700 dark:bg-slate-900 dark:text-slate-200"
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
