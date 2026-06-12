"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { taskStatuses, taskTypeLabels } from "@/lib/tasks";
import { isShopAdminRole } from "@/lib/operational-roles";
import { AssignTaskButton } from "@/components/AssignTaskDialog";
import { cn, formatCurrency } from "@/lib/utils";

type TaskRow = {
  id: string;
  taskType: keyof typeof taskTypeLabels | string;
  title: string;
  notes: string | null;
  progressNotes: string | null;
  priority: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  referenceUrl: string | null;
  createdAt: string;
  customer: { id: string; partyName: string; outstandingBalance: number; contactNumber: string } | null;
  assignedTo: { id: string; name: string; role: string };
  assignedBy: { id: string; name: string; role: string };
};

function display(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function priorityTone(priority: string) {
  if (priority === "URGENT") return "bg-red-100 text-red-800";
  if (priority === "HIGH") return "bg-orange-100 text-orange-800";
  if (priority === "MEDIUM") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "bg-emerald-100 text-emerald-800";
  if (status === "CANCELLED") return "bg-slate-200 text-slate-700";
  if (status === "IN_PROGRESS") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

export default function TasksPage() {
  const searchParams = useSearchParams();
  const highlightedId = searchParams.get("task");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [notesByTask, setNotesByTask] = useState<Record<string, string>>({});
  const admin = isShopAdminRole(role);

  const load = useCallback(async () => {
    setLoading(true);
    const [meResponse, tasksResponse] = await Promise.all([
      fetch("/api/auth/me"),
      fetch(`/api/tasks${status === "ALL" ? "" : `?status=${status}`}`),
    ]);
    const [me, taskData] = await Promise.all([
      meResponse.json().catch(() => ({})),
      tasksResponse.json().catch(() => ({})),
    ]);
    setRole(me?.user?.role ?? "");
    setTasks(taskData.tasks ?? []);
    setNotesByTask((current) => {
      const next = { ...current };
      for (const task of taskData.tasks ?? []) {
        if (!(task.id in next)) next[task.id] = task.progressNotes ?? "";
      }
      return next;
    });
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => taskStatuses.reduce<Record<string, number>>((result, item) => {
    result[item] = tasks.filter((task) => task.status === item).length;
    return result;
  }, {}), [tasks]);

  async function updateTask(task: TaskRow, nextStatus?: string) {
    setMessage("");
    const response = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: task.id,
        status: nextStatus,
        progressNotes: notesByTask[task.id] ?? "",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(data.error ?? "Could not update task.");
      return;
    }
    setMessage(nextStatus === "COMPLETED" ? "Task completed and the assigning admin was notified." : "Task updated.");
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-6xl pb-20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-brand-600">{admin ? "Shop operations" : "Assigned work"}</p>
          <h1 className="mt-1 text-2xl font-bold">{admin ? "All Tasks" : "My Tasks"}</h1>
          <p className="text-sm text-slate-500">{admin ? "Track operational work assigned across your shop." : "Start, update, and complete tasks assigned to you."}</p>
        </div>
        <div className="flex gap-2">
          {admin && <AssignTaskButton onAssigned={load} />}
          <button type="button" onClick={load} aria-label="Refresh tasks" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {message && <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{message}</div>}

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => setStatus("ALL")} className={cn("shrink-0 rounded-full px-3 py-2 text-sm font-semibold", status === "ALL" ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>
          All
        </button>
        {taskStatuses.map((item) => (
          <button key={item} type="button" onClick={() => setStatus(item)} className={cn("shrink-0 rounded-full px-3 py-2 text-sm font-semibold", status === item ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>
            {display(item)} {status === "ALL" ? counts[item] ?? 0 : ""}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {loading && <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
        {!loading && tasks.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">No tasks in this view.</div>}
        {tasks.map((task) => {
          const overdue = !["COMPLETED", "CANCELLED"].includes(task.status) && new Date(task.dueDate) < new Date();
          const taskLabel = taskTypeLabels[task.taskType as keyof typeof taskTypeLabels] ?? task.title;
          return (
            <article key={task.id} className={cn("rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900", highlightedId === task.id && "ring-2 ring-brand-500")}>
              <div className="flex items-start gap-3">
                {task.status === "COMPLETED" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : task.status === "IN_PROGRESS" ? <Play className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold">{task.title}</h2>
                      <p className="text-sm text-slate-500">{taskLabel}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", priorityTone(task.priority))}>{display(task.priority)}</span>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", statusTone(task.status))}>{display(task.status)}</span>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Customer</p>
                      <p className="font-semibold">{task.customer?.partyName ?? "General task"}</p>
                      {task.customer && <p className="text-xs text-slate-500">{formatCurrency(task.customer.outstandingBalance)} outstanding</p>}
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Due</p>
                      <p className={cn("font-semibold", overdue && "text-red-600")}>{dateTime(task.dueDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">{admin ? "Assigned to" : "Assigned by"}</p>
                      <p className="font-semibold">{admin ? task.assignedTo.name : task.assignedBy.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Created</p>
                      <p className="font-semibold">{dateTime(task.createdAt)}</p>
                    </div>
                  </div>

                  {task.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">{task.notes}</p>}

                  <label className="mt-3 block">
                    <span className="text-xs font-semibold text-slate-500">Progress notes</span>
                    <textarea
                      value={notesByTask[task.id] ?? ""}
                      onChange={(event) => setNotesByTask((current) => ({ ...current, [task.id]: event.target.value }))}
                      rows={2}
                      disabled={task.status === "CANCELLED"}
                      className="mt-1 w-full rounded-lg border p-3 text-sm dark:border-slate-700 dark:bg-slate-950 disabled:opacity-60"
                      placeholder="Add visit result, collection update, delivery note, or completion details"
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.referenceUrl && (
                      <Link href={task.referenceUrl} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
                        <ExternalLink className="h-4 w-4" />
                        Open {task.customer ? "Customer" : "Record"}
                      </Link>
                    )}
                    {!admin && task.status === "PENDING" && (
                      <button type="button" onClick={() => updateTask(task, "IN_PROGRESS")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white">
                        <Play className="h-4 w-4" />
                        Start Task
                      </button>
                    )}
                    {!admin && ["PENDING", "IN_PROGRESS"].includes(task.status) && (
                      <button type="button" onClick={() => updateTask(task, "COMPLETED")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white">
                        <CheckCircle2 className="h-4 w-4" />
                        Mark Complete
                      </button>
                    )}
                    {!admin && !["COMPLETED", "CANCELLED"].includes(task.status) && (
                      <button type="button" onClick={() => updateTask(task)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
                        Save Notes
                      </button>
                    )}
                    {admin && !["COMPLETED", "CANCELLED"].includes(task.status) && (
                      <button type="button" onClick={() => updateTask(task, "CANCELLED")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700">
                        <XCircle className="h-4 w-4" />
                        Cancel Task
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
