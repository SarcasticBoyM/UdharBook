"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPlus, Search, X } from "lucide-react";
import { taskPriorities, taskTypeLabels, taskTypes, type TaskType } from "@/lib/tasks";
import { roleLabel } from "@/lib/operational-roles";

type StaffOption = {
  id: string;
  name: string;
  role: string;
  jobTitle: string | null;
};

type CustomerOption = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
};

export type TaskAssignmentSeed = {
  customerId?: string | null;
  customerName?: string | null;
  taskType?: TaskType;
  title?: string;
  notes?: string;
  priority?: (typeof taskPriorities)[number];
  dueDate?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  referenceUrl?: string;
  assignedToId?: string;
  shopId?: string;
};

function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIstIso(value: string) {
  return new Date(`${value}:00+05:30`).toISOString();
}

function taskCreationKey() {
  if (typeof crypto.randomUUID === "function") return `TASK_CREATE:${crypto.randomUUID()}`;
  const random = crypto.getRandomValues(new Uint32Array(4));
  return `TASK_CREATE:${Array.from(random, (value) => value.toString(16).padStart(8, "0")).join("")}`;
}

export function AssignTaskButton({
  seed,
  label = "Assign Task",
  className,
  onAssigned,
}: {
  seed?: TaskAssignmentSeed;
  label?: string;
  className?: string;
  onAssigned?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={className ?? "inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-300 px-3 text-sm font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300"}
      >
        <ClipboardPlus className="h-4 w-4" />
        {label}
      </button>
      {open && <AssignTaskDialog seed={seed} onClose={() => setOpen(false)} onAssigned={onAssigned} />}
    </>
  );
}

export function AssignTaskDialog({
  seed,
  onClose,
  onAssigned,
}: {
  seed?: TaskAssignmentSeed;
  onClose: () => void;
  onAssigned?: () => void;
}) {
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [assignedToId, setAssignedToId] = useState(seed?.assignedToId ?? "");
  const [taskType, setTaskType] = useState<TaskType>(seed?.taskType ?? "GENERAL_TASK");
  const [title, setTitle] = useState(seed?.title ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [priority, setPriority] = useState<(typeof taskPriorities)[number]>(seed?.priority ?? "MEDIUM");
  const [dueDate, setDueDate] = useState(seed?.dueDate ?? defaultDueDate());
  const [customer, setCustomer] = useState<CustomerOption | null>(
    seed?.customerId && seed.customerName
      ? { id: seed.customerId, partyName: seed.customerName, contactNumber: "", outstandingBalance: 0 }
      : null,
  );
  const [customerQuery, setCustomerQuery] = useState(seed?.customerName ?? "");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(taskCreationKey);

  const seedShopId = seed?.shopId;
  const shopQuery = seedShopId ? `&shopId=${encodeURIComponent(seedShopId)}` : "";

  useEffect(() => {
    fetch(`/api/tasks?view=staff${shopQuery}`)
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error ?? "Could not load staff.");
          return;
        }
        setStaff(data.staff ?? []);
        if (data.staff?.length === 1) setAssignedToId((current) => current || data.staff[0].id);
      })
      .catch(() => setError("Could not load staff."));
  }, [shopQuery]);

  useEffect(() => {
    if (seed?.customerId || customer) return;
    const query = customerQuery.trim();
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}&limit=6`, {
        headers: seedShopId ? { "x-shop-id": seedShopId } : undefined,
      });
      const data = await response.json().catch(() => ({}));
      setCustomerResults(data.customers ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customer, customerQuery, seed?.customerId, seedShopId]);

  const effectiveTitle = useMemo(() => title.trim() || taskTypeLabels[taskType], [taskType, title]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assignedToId || !dueDate) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(seedShopId ? { "x-shop-id": seedShopId } : {}),
      },
      body: JSON.stringify({
        shopId: seedShopId,
        assignedToId,
        customerId: customer?.id ?? seed?.customerId ?? null,
        taskType,
        title: effectiveTitle,
        notes: notes || null,
        priority,
        dueDate: toIstIso(dueDate),
        idempotencyKey,
        sourceEntityType: seed?.sourceEntityType ?? null,
        sourceEntityId: seed?.sourceEntityId ?? null,
        referenceUrl: seed?.referenceUrl ?? null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError([data.error, ...(data.details ?? [])].filter(Boolean).join(" ") || "Could not assign task.");
      return;
    }
    onAssigned?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-lg bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Assign Task</h2>
            <p className="text-sm text-slate-500">Create a lightweight operational task for shop staff.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close task form" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="text-sm font-semibold">Staff member</span>
            <select value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required>
              <option value="">Select staff</option>
              {staff.map((item) => <option key={item.id} value={item.id}>{item.name} - {roleLabel(item.role)}</option>)}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold">Task type</span>
            <select value={taskType} onChange={(event) => setTaskType(event.target.value as TaskType)} className="mt-1 min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
              {taskTypes.map((item) => <option key={item} value={item}>{taskTypeLabels[item]}</option>)}
            </select>
          </label>

          <label>
            <span className="text-sm font-semibold">Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as (typeof taskPriorities)[number])} className="mt-1 min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
              {taskPriorities.map((item) => <option key={item} value={item}>{item.charAt(0) + item.slice(1).toLowerCase()}</option>)}
            </select>
          </label>

          <label className="sm:col-span-2">
            <span className="text-sm font-semibold">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={taskTypeLabels[taskType]} className="mt-1 min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          </label>

          <label className="sm:col-span-2">
            <span className="text-sm font-semibold">Customer</span>
            {customer || seed?.customerId ? (
              <div className="mt-1 flex min-h-12 items-center justify-between rounded-lg border border-slate-200 px-3 dark:border-slate-700">
                <span className="font-semibold">{customer?.partyName ?? seed?.customerName}</span>
                {!seed?.customerId && <button type="button" onClick={() => { setCustomer(null); setCustomerQuery(""); }} className="text-sm text-red-600">Clear</button>}
              </div>
            ) : (
              <div className="relative mt-1">
                <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Optional customer search" className="min-h-12 w-full rounded-lg border py-2 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
                {customerResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    {customerResults.map((item) => (
                      <button key={item.id} type="button" onClick={() => { setCustomer(item); setCustomerQuery(item.partyName); setCustomerResults([]); }} className="block min-h-11 w-full rounded-md px-3 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                        <span className="font-semibold">{item.partyName}</span>
                        <span className="ml-2 text-slate-500">{item.contactNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </label>

          <label className="sm:col-span-2">
            <span className="text-sm font-semibold">Due date</span>
            <input type="datetime-local" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          </label>

          <label className="sm:col-span-2">
            <span className="text-sm font-semibold">Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Amount, visit instructions, invoice details, or other operational notes" className="mt-1 w-full rounded-lg border p-3 dark:border-slate-700 dark:bg-slate-900" />
          </label>
        </div>

        <button type="submit" disabled={saving || !assignedToId || !dueDate} className="mt-5 min-h-12 w-full rounded-lg bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "Assigning..." : "Assign Task"}
        </button>
      </form>
    </div>
  );
}
