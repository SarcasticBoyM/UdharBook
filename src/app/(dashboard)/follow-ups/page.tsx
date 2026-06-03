"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
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
import { formatCurrency, formatDate } from "@/lib/utils";
import { displayPhone, telHref } from "@/lib/phone";
import { paymentReminderMessage, whatsappHref } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

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
  totalCallsMade: number;
  balanceAsOfDate: string;
  followUps: FollowUpItem[];
  payments: {
    id: string;
    amount: number;
    paidAt: string;
    method: string | null;
    notes: string | null;
    createdBy: { name: string };
  }[];
  queueCompleted?: boolean;
  optimisticStatus?: FollowUpStatus;
};

type QueueResponse = {
  customers: QueueCustomer[];
  total: number;
  skip: number;
  take: number;
  hasMore: boolean;
};

type QuickStatus = "CONTACTED" | "NOT_REACHABLE" | "PAYMENT_PROMISED" | "PAID" | "RESCHEDULED" | "COMPLETED";

const PAGE_SIZE = 30;
const HIGH_AMOUNT = 50000;

const QUICK_STATUSES: { value: QuickStatus; label: string; tone: string }[] = [
  { value: "CONTACTED", label: "Called", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  { value: "NOT_REACHABLE", label: "Not reachable", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  { value: "PAYMENT_PROMISED", label: "Payment promised", tone: "border-violet-200 bg-violet-50 text-violet-800" },
  { value: "PAID", label: "Paid", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  { value: "RESCHEDULED", label: "Follow-up later", tone: "border-slate-200 bg-slate-50 text-slate-800" },
  { value: "COMPLETED", label: "Done", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
];

const NOTE_TEMPLATES = [
  "Customer asked to call again in evening.",
  "Promised payment today.",
  "Phone not reachable.",
  "Shared payment reminder on WhatsApp.",
  "Will visit shop for collection.",
];

const REMINDER_TEMPLATES = [
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

function daysBetween(from: Date, to: Date) {
  return Math.floor((from.getTime() - to.getTime()) / 86400000);
}

function daysOverdue(customer: QueueCustomer) {
  if (!customer.nextFollowupDate) return 0;
  return Math.max(0, daysBetween(startOfToday(), new Date(customer.nextFollowupDate)));
}

function priorityRank(priority: FollowUpPriority | undefined) {
  return { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[priority ?? "MEDIUM"];
}

function latestFollowUp(customer: QueueCustomer) {
  return customer.followUps[0] ?? null;
}

function derivedPriority(customer: QueueCustomer): FollowUpPriority {
  const latest = latestFollowUp(customer);
  if (customer.status === "HIGH_RISK" || daysOverdue(customer) > 2) return "URGENT";
  if (latest?.priority) return latest.priority;
  if (customer.outstandingBalance >= HIGH_AMOUNT) return "HIGH";
  if (customer.nextFollowupDate && new Date(customer.nextFollowupDate) <= endOfToday()) return "MEDIUM";
  return "LOW";
}

function riskTone(customer: QueueCustomer) {
  if (customer.status === "CLEARED" || customer.optimisticStatus === "PAID") return "green";
  if (derivedPriority(customer) === "URGENT" || daysOverdue(customer) > 0) return "red";
  return "yellow";
}

function queueScore(customer: QueueCustomer) {
  const overdue = daysOverdue(customer);
  const priority = priorityRank(derivedPriority(customer));
  const highAmount = Math.min(customer.outstandingBalance / HIGH_AMOUNT, 3);
  const recentlyContacted = customer.lastFollowupDate
    ? new Date(customer.lastFollowupDate).getTime() > Date.now() - 2 * 60 * 60 * 1000
    : false;
  const completedPenalty = customer.queueCompleted || customer.status === "CLEARED" ? -10000 : 0;
  return completedPenalty + overdue * 1200 + priority * 350 + highAmount * 180 - (recentlyContacted ? 900 : 0);
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

export default function FollowUpsPage() {
  const [items, setItems] = useState<QueueCustomer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const notifiedIds = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const mergeCustomers = useCallback((incoming: QueueCustomer[], reset = false) => {
    setItems((current) => {
      const map = new Map((reset ? [] : current).map((item) => [item.id, item]));
      for (const customer of incoming) {
        map.set(customer.id, { ...map.get(customer.id), ...customer });
      }
      return Array.from(map.values());
    });
  }, []);

  const loadPage = useCallback(
    async (skip: number, reset = false) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await fetch(`/api/follow-ups?filter=today&take=${PAGE_SIZE}&skip=${skip}`);
        const data = (await res.json()) as QueueResponse;
        mergeCustomers(data.customers ?? [], reset);
        setHasMore(Boolean(data.hasMore));
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [mergeCustomers]
  );

  useEffect(() => {
    loadPage(0, true);
  }, [loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loadingMore) loadPage(items.length, false);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, loadPage, loadingMore]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  const sortedItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...items]
      .filter((item) => {
        if (!needle) return true;
        return (
          item.partyName.toLowerCase().includes(needle) ||
          item.contactNumber.includes(needle) ||
          displayPhone(item.contactNumber).includes(needle)
        );
      })
      .sort((a, b) => queueScore(b) - queueScore(a));
  }, [items, query]);

  const stats = useMemo(() => {
    const todayEnd = endOfToday();
    const completed = items.filter((item) => item.queueCompleted || item.status === "CLEARED").length;
    const pending = items.filter((item) => !item.queueCompleted && item.status !== "CLEARED").length;
    const highRisk = items.filter((item) => riskTone(item) === "red").length;
    const missed = items.filter((item) => item.nextFollowupDate && new Date(item.nextFollowupDate) < startOfToday()).length;
    const recovered = items
      .flatMap((item) => item.payments)
      .filter((payment) => new Date(payment.paidAt) <= todayEnd && new Date(payment.paidAt) >= startOfToday())
      .reduce((sum, payment) => sum + payment.amount, 0);
    return { completed, pending, highRisk, missed, recovered };
  }, [items]);

  const playAlert = useCallback(() => {
    if (!soundEnabled) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 780;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.18);
  }, [soundEnabled]);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const checkDue = async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const res = await fetch("/api/notifications/due");
      if (!res.ok) return;
      const data = (await res.json()) as {
        reminders: { id: string; customerId: string; partyName: string; scheduledAt: string | null; missed: boolean }[];
      };
      const now = Date.now();
      for (const reminder of data.reminders) {
        if (!reminder.scheduledAt || new Date(reminder.scheduledAt).getTime() > now) continue;
        if (notifiedIds.current.has(reminder.id)) continue;
        notifiedIds.current.add(reminder.id);
        playAlert();
        const notification = new Notification(`Follow-up due: ${reminder.partyName}`, {
          body: reminder.missed ? "This follow-up is overdue." : "It is time to call this customer.",
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

  const quickSave = async (
    customer: QueueCustomer,
    status: QuickStatus,
    notes = status === "COMPLETED" ? "Marked completed from queue." : ""
  ) => {
    const now = new Date().toISOString();
    const nextDate =
      status === "PAID" || status === "COMPLETED"
        ? null
        : customer.nextFollowupDate ?? nextReminderDate(undefined, 10);

    setItems((current) =>
      current.map((item) =>
        item.id === customer.id
          ? {
              ...item,
              queueCompleted: status === "PAID" || status === "COMPLETED",
              optimisticStatus: status,
              lastFollowupDate: now,
              nextFollowupDate: nextDate,
              status: status === "PAID" ? "CLEARED" : item.status,
              outstandingBalance: status === "PAID" ? 0 : item.outstandingBalance,
              followUps: [
                {
                  id: `optimistic-${now}`,
                  followupDate: now,
                  status,
                  priority: derivedPriority(item),
                  notes,
                  reminderNotes: null,
                  customerResponse: null,
                  nextFollowupDate: nextDate,
                  scheduledAt: nextDate,
                  completedAt: status === "PAID" || status === "COMPLETED" ? now : null,
                  createdBy: { name: "You" },
                },
                ...item.followUps,
              ],
            }
          : item
      )
    );

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
      }),
    });
  };

  return (
    <div className="mx-auto max-w-7xl pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            Recovery workbench
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">Today&apos;s Follow-ups</h1>
          <p className="mt-1 text-sm text-slate-500">
            Due and overdue customers are sorted for fast calling and recovery tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-slate-950"
          >
            <TimerReset className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Metric label="Total today" value={total || items.length} icon={CalendarClock} />
        <Metric label="Completed" value={stats.completed} icon={CheckCircle2} tone="green" />
        <Metric label="Pending" value={stats.pending} icon={Clock3} tone="yellow" />
        <Metric label="Recovery today" value={formatCurrency(stats.recovered)} icon={IndianRupee} tone="green" />
        <Metric label="High risk" value={stats.highRisk} icon={ShieldAlert} tone="red" />
        <Metric label="Missed" value={stats.missed} icon={AlertTriangle} tone="red" />
      </section>

      <div className="sticky top-0 z-20 -mx-4 mt-4 border-y border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customer or mobile"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-3">
          {loading ? (
            <div className="flex min-h-56 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          ) : sortedItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              No pending follow-ups match this view.
            </div>
          ) : (
            sortedItems.map((customer) => (
              <FollowUpCard
                key={customer.id}
                customer={customer}
                active={selectedId === customer.id}
                onOpen={() => setSelectedId(customer.id)}
                onQuickSave={quickSave}
              />
            ))
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            </div>
          )}
        </section>

        <QuickPanel
          customer={selected}
          onClose={() => setSelectedId(null)}
          onSaved={(updated) => {
            mergeCustomers([updated]);
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

function FollowUpCard({
  customer,
  active,
  onOpen,
  onQuickSave,
}: {
  customer: QueueCustomer;
  active: boolean;
  onOpen: () => void;
  onQuickSave: (customer: QueueCustomer, status: QuickStatus, notes?: string) => Promise<void>;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const latest = latestFollowUp(customer);
  const priority = derivedPriority(customer);
  const tone = riskTone(customer);
  const lastPayment = customer.payments[0];
  const overdue = daysOverdue(customer);

  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = Math.abs(touch.clientY - start.y);
    if (dy > 45 || Math.abs(dx) < 80) return;
    if (dx > 0) onQuickSave(customer, "COMPLETED");
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
        tone === "green" && "border-emerald-200 opacity-80 dark:border-emerald-900"
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
              <h2 className="truncate text-lg font-bold">{customer.partyName}</h2>
              <p className="truncate text-sm text-slate-500">Business account: {customer.partyName}</p>
              <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {displayPhone(customer.contactNumber)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-extrabold text-slate-950 dark:text-white">
                {formatCurrency(customer.outstandingBalance)}
              </p>
              <span
                className={cn(
                  "mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                  priority === "URGENT" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100",
                  priority === "HIGH" && "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-100",
                  priority === "MEDIUM" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
                  priority === "LOW" && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                )}
              >
                {priority}
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Last payment" value={lastPayment ? formatDate(lastPayment.paidAt) : "-"} />
            <Info label="Last follow-up" value={formatDateTime(customer.lastFollowupDate ?? latest?.followupDate)} />
            <Info label="Next action" value={formatDateTime(customer.nextFollowupDate ?? latest?.nextFollowupDate)} />
            <Info label="Days overdue" value={overdue ? `${overdue} day${overdue === 1 ? "" : "s"}` : "Due today"} />
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/70">
            <p className="line-clamp-2">
              <span className="font-semibold">Last notes: </span>
              {latest?.notes || latest?.customerResponse || customer.notes || "No follow-up notes yet."}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Recovery status: {customer.optimisticStatus?.replace(/_/g, " ") ?? latest?.status?.replace(/_/g, " ") ?? customer.status.replace(/_/g, " ")}
            </p>
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
              href={whatsappHref(
                customer.contactNumber,
                paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate)
              )}
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
                onQuickSave(customer, "COMPLETED");
              }}
              className="hidden min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700 sm:inline-flex"
            >
              <CheckCircle2 className="h-4 w-4" />
              Done
            </button>
            <button
              type="button"
              className="ml-auto hidden items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-300 sm:inline-flex"
            >
              Open
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-2 text-center text-[11px] text-slate-400 sm:hidden">
            Swipe right to complete, left to reschedule.
          </p>
        </div>
      </div>
    </article>
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

function QuickPanel({
  customer,
  onClose,
  onSaved,
}: {
  customer: QueueCustomer | null;
  onClose: () => void;
  onSaved: (customer: QueueCustomer) => void;
}) {
  const [status, setStatus] = useState<QuickStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer) return;
    setStatus("CONTACTED");
    setNotes("");
    setCustomerResponse("");
    setNextDate(customer.nextFollowupDate ? new Date(customer.nextFollowupDate).toISOString().slice(0, 16) : "");
  }, [customer]);

  if (!customer) {
    return (
      <aside className="hidden rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 xl:block">
        Select a customer to log the next recovery action.
      </aside>
    );
  }

  const latest = latestFollowUp(customer);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const scheduledAt = nextDate ? new Date(nextDate).toISOString() : null;
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          status,
          priority: derivedPriority(customer),
          notes: notes || undefined,
          reminderNotes: nextDate ? `Reminder set for ${formatDateTime(scheduledAt)}` : undefined,
          customerResponse: customerResponse || undefined,
          scheduledAt,
          nextFollowupDate: scheduledAt,
        }),
      });
      if (!res.ok) throw new Error("Could not save follow-up");
      const data = (await res.json()) as { customer: QueueCustomer; followUp: FollowUpItem };
      onSaved({
        ...customer,
        ...data.customer,
        queueCompleted: status === "PAID" || status === "COMPLETED",
        optimisticStatus: status,
        followUps: [data.followUp, ...customer.followUps.filter((item) => item.id !== data.followUp.id)],
      });
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

        <div className="flex min-h-0 flex-1 flex-col">
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
                  href={whatsappHref(
                    customer.contactNumber,
                    paymentReminderMessage(customer.partyName, customer.outstandingBalance, customer.nextFollowupDate)
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Mark status</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_STATUSES.map((option) => (
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

              <div>
                <label className="text-sm font-semibold">Quick notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Add call note"
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
                <label className="text-sm font-semibold">Customer response / promise</label>
                <input
                  value={customerResponse}
                  onChange={(event) => setCustomerResponse(event.target.value)}
                  placeholder="Example: promised Rs 5,000 by Friday"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="text-sm font-semibold">Next follow-up date and time</label>
                <input
                  type="datetime-local"
                  value={nextDate}
                  onChange={(event) => setNextDate(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {REMINDER_TEMPLATES.map((template) => (
                    <button
                      key={template.label}
                      type="button"
                      onClick={() => setNextDate(nextReminderDate(template.minutes, template.tomorrowHour))}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium dark:bg-slate-800"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-slate-500" />
                  <p className="text-sm font-semibold">Last follow-up</p>
                </div>
                <p className="mt-2 text-sm">{latest?.notes || latest?.customerResponse || "No previous note available."}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {latest ? `${formatDateTime(latest.followupDate)} by ${latest.createdBy.name}` : "New recovery account"}
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
                        <p className="text-sm font-semibold">{item.status.replace(/_/g, " ")}</p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(item.followupDate)} by {item.createdBy.name}
                        </p>
                        {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
                        {item.customerResponse && <p className="mt-1 text-sm">Promise: {item.customerResponse}</p>}
                        {item.nextFollowupDate && (
                          <p className="mt-1 text-xs text-slate-500">Next: {formatDateTime(item.nextFollowupDate)}</p>
                        )}
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
      </div>
    </aside>
  );
}
