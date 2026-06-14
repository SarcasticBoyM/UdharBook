"use client";

import { useEffect, useMemo, useState } from "react";
import type { FollowUpPriority, FollowUpStatus } from "@prisma/client";
import { Bell, CalendarClock, CheckCircle2, Landmark, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORDER_FOLLOW_UP } from "@/lib/follow-up-types";
import { isShopAdminRole, normalizeFixedRole, roleLabel } from "@/lib/operational-roles";

type RecoveryActionKey =
  | "CALLBACK_REQUESTED"
  | "PROMISE_TO_PAY"
  | "PAYMENT_RECEIVED"
  | "CHEQUE_PICKUP"
  | "CHEQUE_DEPOSITED"
  | "CHEQUE_BOUNCED"
  | "NOT_RESPONDING"
  | "VISIT_COMPLETED"
  | "FOLLOW_UP_DONE"
  | typeof ORDER_FOLLOW_UP
  | "RESCHEDULE"
  | "CUSTOMER_DISPUTE"
  | "WRONG_NUMBER";

type RecentInteraction = {
  id: string;
  followupDate: string;
  status: string;
  notes: string | null;
  summary?: string | null;
  sourceModule?: string;
  createdBy: { name: string };
};

interface Props {
  customerId: string;
  customerName?: string;
  balance?: number;
  recentInteractions?: RecentInteraction[];
  onClose: () => void;
  onSaved: () => void;
}

const ACTIONS: {
  key: RecoveryActionKey;
  label: string;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  tone: string;
  defaultSummary: string;
}[] = [
  { key: "CALLBACK_REQUESTED", label: "Callback requested", status: "CALLBACK", priority: "MEDIUM", tone: "bg-blue-50 text-blue-800 border-blue-200", defaultSummary: "Customer asked callback" },
  { key: "PROMISE_TO_PAY", label: "Promise to pay", status: "PAYMENT_PROMISED", priority: "HIGH", tone: "bg-violet-50 text-violet-800 border-violet-200", defaultSummary: "Customer promised payment" },
  { key: "PAYMENT_RECEIVED", label: "Payment received", status: "PARTIAL_PAID", priority: "HIGH", tone: "bg-emerald-50 text-emerald-800 border-emerald-200", defaultSummary: "Payment received" },
  { key: "CHEQUE_PICKUP", label: "Cheque pickup", status: "CONTACTED", priority: "HIGH", tone: "bg-cyan-50 text-cyan-800 border-cyan-200", defaultSummary: "Cheque collected" },
  { key: "CHEQUE_DEPOSITED", label: "Cheque deposited", status: "COMPLETED", priority: "MEDIUM", tone: "bg-indigo-50 text-indigo-800 border-indigo-200", defaultSummary: "Cheque deposited" },
  { key: "CHEQUE_BOUNCED", label: "Cheque bounced", status: "PENDING", priority: "URGENT", tone: "bg-red-50 text-red-800 border-red-200", defaultSummary: "Cheque bounced and customer informed" },
  { key: "NOT_RESPONDING", label: "Not responding", status: "NOT_REACHABLE", priority: "HIGH", tone: "bg-amber-50 text-amber-800 border-amber-200", defaultSummary: "Customer not responding" },
  { key: "VISIT_COMPLETED", label: "Visit completed", status: "COMPLETED", priority: "MEDIUM", tone: "bg-slate-50 text-slate-800 border-slate-200", defaultSummary: "Visited customer, payment discussion done" },
  { key: "FOLLOW_UP_DONE", label: "Recovery follow-up done", status: "COMPLETED", priority: "MEDIUM", tone: "bg-green-50 text-green-800 border-green-200", defaultSummary: "Recovery follow-up done" },
  { key: ORDER_FOLLOW_UP, label: "Order Follow-up", status: "PENDING", priority: "MEDIUM", tone: "bg-amber-50 text-amber-900 border-amber-300", defaultSummary: "Call customer for a new order" },
  { key: "RESCHEDULE", label: "Reschedule follow-up", status: "RESCHEDULED", priority: "MEDIUM", tone: "bg-blue-50 text-blue-800 border-blue-200", defaultSummary: "Follow-up rescheduled" },
  { key: "CUSTOMER_DISPUTE", label: "Customer dispute", status: "FOLLOW_UP_REQUIRED", priority: "URGENT", tone: "bg-orange-50 text-orange-800 border-orange-200", defaultSummary: "Customer raised dispute" },
  { key: "WRONG_NUMBER", label: "Wrong number/unavailable", status: "WRONG_NUMBER", priority: "LOW", tone: "bg-rose-50 text-rose-800 border-rose-200", defaultSummary: "Wrong number or customer unavailable" },
];

function toDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function toIstDateTime(date: string, time: string) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type StaffOption = {
  id: string;
  name: string;
  role: string;
};

function money(value: number | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function FollowUpModal({ customerId, customerName = "Customer", balance = 0, recentInteractions = [], onClose, onSaved }: Props) {
  const [actionKey, setActionKey] = useState<RecoveryActionKey>("CALLBACK_REQUESTED");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDate, setReminderDate] = useState("");
  const [orderReminderDate, setOrderReminderDate] = useState("");
  const [orderReminderTime, setOrderReminderTime] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [imageName, setImageName] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeAmount, setChequeAmount] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const action = ACTIONS.find((item) => item.key === actionKey) ?? ACTIONS[0];
  const isCheque = actionKey.startsWith("CHEQUE");
  const needsAmount = actionKey === "PAYMENT_RECEIVED" || isCheque;
  const needsPromise = actionKey === "PROMISE_TO_PAY";
  const isOrderReminder = actionKey === ORDER_FOLLOW_UP;
  const computedSummary = useMemo(() => {
    if (summary.trim()) return summary.trim();
    if (actionKey === "PROMISE_TO_PAY" && promiseDate) return `Customer promised payment on ${formatDateTime(promiseDate)}`;
    if (actionKey === "PAYMENT_RECEIVED" && recoveryAmount) return `Payment received ${money(Number(recoveryAmount))}`;
    if (actionKey === "CHEQUE_PICKUP" && (chequeAmount || recoveryAmount)) return `Cheque collected ${money(Number(chequeAmount || recoveryAmount))}`;
    if (actionKey === "CALLBACK_REQUESTED" && nextDate) return `Customer asked callback ${formatDateTime(nextDate)}`;
    return action.defaultSummary;
  }, [action.defaultSummary, actionKey, chequeAmount, nextDate, promiseDate, recoveryAmount, summary]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.ok ? response.json() : null)
      .then(async (data) => {
        if (!isShopAdminRole(data?.user?.role ?? "")) return;
        setCanAssign(true);
        const response = await fetch("/api/users");
        if (!response.ok) return;
        const payload = await response.json();
        setStaff((payload.users ?? []).filter((user: StaffOption) =>
          ["SALES_PERSON", "ACCOUNT_STAFF", "SALES_PERSON_CUM_ACCOUNTS"].includes(String(normalizeFixedRole(user.role))),
        ));
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const amount = Number(recoveryAmount || chequeAmount || 0);
    const reminderAt = isOrderReminder
      ? toIstDateTime(orderReminderDate, orderReminderTime)
      : toDateTime(reminderDate || nextDate);
    if (isOrderReminder && !reminderAt) {
      setLoading(false);
      setError("Reminder date and time are required for an Order Follow-up.");
      return;
    }
    const nextFollowupAt = actionKey === "CHEQUE_BOUNCED" && !nextDate && !promiseDate && !reminderDate
      ? new Date().toISOString()
      : toDateTime(nextDate || promiseDate || reminderDate);

    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          status: action.status,
          priority: action.priority,
          notes: details || computedSummary,
          reminderNotes: reminderEnabled ? `Reminder set for ${reminderAt ? formatDateTime(reminderAt) : "selected time"}` : undefined,
          customerResponse: needsPromise ? computedSummary : undefined,
          manualReminder: isOrderReminder || reminderEnabled,
          reminderEnabled: isOrderReminder || reminderEnabled,
          nextFollowUpDateTime: isOrderReminder || reminderEnabled ? reminderAt : null,
          scheduledAt: isOrderReminder || reminderEnabled ? reminderAt : nextFollowupAt,
          nextFollowupDate: isOrderReminder ? reminderAt : nextFollowupAt,
          paidAmount: actionKey === "PAYMENT_RECEIVED" || isCheque ? amount : undefined,
          sourceModule: "CUSTOMER_MODULE",
          followUpType: isOrderReminder ? ORDER_FOLLOW_UP : action.label,
          assignedToId: isOrderReminder && assignedToId ? assignedToId : undefined,
          summary: computedSummary,
          detailedNotes: details || computedSummary,
          paymentStatus: actionKey === "PAYMENT_RECEIVED" ? (amount >= balance ? "PAID" : "PARTIAL_PAID") : isCheque ? action.label.toUpperCase().replace(/\s+/g, "_") : undefined,
          chequeStatus: isCheque ? action.label.replace("Cheque ", "").toUpperCase() : undefined,
          promiseDate: toDateTime(promiseDate),
          activitySource: "customer-quick-follow-up",
          metadata: {
            imageName: imageName || null,
            chequeNumber: chequeNumber || null,
            chequeBank: chequeBank || null,
            chequeAmount: chequeAmount ? Number(chequeAmount) : null,
            chequeDate: chequeDate || null,
          },
        }),
      });
      if (!res.ok) throw new Error("SAVE_FAILED");
      onSaved();
      onClose();
    } catch {
      setError("Could not save recovery update.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <p className="text-xs font-semibold uppercase text-brand-600">Quick Follow-up</p>
            <h2 className="text-xl font-bold">{customerName}</h2>
            <p className="text-sm text-slate-500">Outstanding {money(balance)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold">Follow-up type</label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {ACTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActionKey(item.key);
                        setSummary("");
                        if (item.key === "PAYMENT_RECEIVED") setReminderEnabled(false);
                        if (item.key === ORDER_FOLLOW_UP) setReminderEnabled(true);
                      }}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 text-left text-xs font-semibold",
                        actionKey === item.key ? cn(item.tone, "dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100") : "ui-control"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Short summary" value={summary} onChange={setSummary} placeholder={action.defaultSummary} />
                {needsAmount && <Field label="Recovery amount" type="number" value={recoveryAmount} onChange={setRecoveryAmount} placeholder="Amount" />}
                {needsPromise && <Field label="Promise/payment date" type="datetime-local" value={promiseDate} onChange={setPromiseDate} />}
                {!isOrderReminder && <Field label="Next follow-up date & time" type="datetime-local" value={nextDate} onChange={setNextDate} />}
              </div>

              {isOrderReminder && (
                <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30 sm:grid-cols-2">
                  <Field label="Reminder date" type="date" value={orderReminderDate} onChange={setOrderReminderDate} />
                  <Field label="Reminder time" type="time" value={orderReminderTime} onChange={setOrderReminderTime} />
                  {canAssign && (
                    <label className="block sm:col-span-2">
                      <span className="text-sm font-semibold">Assigned staff</span>
                      <select
                        value={assignedToId}
                        onChange={(event) => setAssignedToId(event.target.value)}
                        className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
                      >
                        <option value="">Assign to me</option>
                        {staff.map((user) => <option key={user.id} value={user.id}>{user.name} - {roleLabel(user.role)}</option>)}
                      </select>
                    </label>
                  )}
                  <p className="text-xs text-slate-600 dark:text-slate-300 sm:col-span-2">
                    The selected person will receive an in-app reminder at this date and time (IST).
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold">Detailed notes</label>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={3}
                  placeholder="Add customer response, commitment, dispute, or recovery detail"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>

              {isCheque && (
                <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-900 dark:bg-cyan-950/30">
                  <div className="mb-3 flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-cyan-700" />
                    <p className="text-sm font-semibold">Cheque details</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Cheque number" value={chequeNumber} onChange={setChequeNumber} />
                    <Field label="Bank name" value={chequeBank} onChange={setChequeBank} />
                    <Field label="Cheque amount" type="number" value={chequeAmount} onChange={setChequeAmount} />
                    <Field label="Cheque date" type="date" value={chequeDate} onChange={setChequeDate} />
                  </div>
                </div>
              )}

              {!isOrderReminder && <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex min-h-12 items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                  <input
                    type="checkbox"
                    checked={reminderEnabled}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setReminderEnabled(checked);
                      if (checked && "Notification" in window && Notification.permission === "default") {
                        Notification.requestPermission().catch(() => undefined);
                      }
                    }}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="flex items-center gap-1 font-semibold"><Bell className="h-4 w-4" /> Set reminder</span>
                    <span className="text-xs text-slate-500">Adds this to scheduled follow-ups.</span>
                  </span>
                </label>
                <Field label="Reminder date/time" type="datetime-local" value={reminderDate} onChange={setReminderDate} disabled={!reminderEnabled} />
              </div>}

              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <Upload className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">{imageName || "Attach image/photo name for reference"}</span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(event) => setImageName(event.target.files?.[0]?.name ?? "")} />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <aside className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-semibold">Will save as</p>
                </div>
                <p className="mt-2 text-sm font-medium">{computedSummary}</p>
                <p className="mt-2 text-xs text-slate-500">Updates customer timeline, reports, reminders, scheduled queue, and Today Follow-ups.</p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-slate-500" />
                  <p className="text-sm font-semibold">Recent interactions</p>
                </div>
                <div className="space-y-2">
                  {recentInteractions.slice(0, 4).length === 0 ? (
                    <p className="text-sm text-slate-500">No recent recovery history.</p>
                  ) : (
                    recentInteractions.slice(0, 4).map((item) => (
                      <div key={item.id} className="rounded-md bg-slate-50 p-2 text-xs dark:bg-slate-800">
                        <p className="font-semibold">{item.summary || item.status.replace(/_/g, " ")}</p>
                        <p className="mt-1 text-slate-500">{formatDateTime(item.followupDate)} by {item.createdBy.name}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>

          <div className="sticky bottom-0 grid grid-cols-[1fr_auto] gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <button type="submit" disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Saving..." : isOrderReminder ? "Schedule Order Follow-up" : "Save Recovery Update"}
            </button>
            <button type="button" onClick={onClose} className="hidden min-h-12 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold dark:border-slate-700 sm:inline-flex">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:disabled:bg-slate-900"
      />
    </label>
  );
}
