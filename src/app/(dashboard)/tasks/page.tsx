"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { taskStatuses, taskTypeLabels } from "@/lib/tasks";
import { canAssignTasks, isShopAdminRole } from "@/lib/operational-roles";
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
  const highlightedId = searchParams.get("taskId");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("ALL");
  const [adminView, setAdminView] = useState<"all" | "assigned-by-me">("all");
  const [counts, setCounts] = useState({ pending: 0, inProgress: 0, completed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [taskLinkMessage, setTaskLinkMessage] = useState("");
  const [notesByTask, setNotesByTask] = useState<Record<string, string>>({});
  const admin = isShopAdminRole(role);
  const canAssign = canAssignTasks(role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setTaskLinkMessage("");
    try {
      const query = new URLSearchParams();
      if (status !== "ALL") query.set("status", status);
      if (adminView === "assigned-by-me") query.set("view", "assigned-by-me");
      const [meResponse, tasksResponse] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch(`/api/tasks${query.size ? `?${query.toString()}` : ""}`, { cache: "no-store" }),
      ]);
      const [me, taskData] = await Promise.all([
        meResponse.json().catch(() => ({})),
        tasksResponse.json().catch(() => ({})),
      ]);
      if (!meResponse.ok) throw new Error(me.error ?? "Your session could not be loaded.");
      if (!tasksResponse.ok) throw new Error(taskData.error ?? "Tasks could not be loaded.");

      setRole(me?.user?.role ?? "");
      let loadedTasks: TaskRow[] = taskData.tasks ?? [];
      setCounts(taskData.counts ?? { pending: 0, inProgress: 0, completed: 0, cancelled: 0 });

      if (highlightedId && !loadedTasks.some((task) => task.id === highlightedId)) {
        const detailResponse = await fetch(`/api/tasks/${encodeURIComponent(highlightedId)}`, { cache: "no-store" });
        const detailData = await detailResponse.json().catch(() => ({}));
        if (detailResponse.ok && detailData.task) {
          loadedTasks = [detailData.task, ...loadedTasks];
        } else {
          setTaskLinkMessage(detailData.error ?? "This task no longer exists or is not assigned to you.");
        }
      }

      setTasks(loadedTasks);
      setNotesByTask((current) => {
        const next = { ...current };
        for (const task of loadedTasks) {
          if (!(task.id in next)) next[task.id] = task.progressNotes ?? "";
        }
        return next;
      });
      if (highlightedId) {
        window.setTimeout(() => document.getElementById(`task-${highlightedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      }
    } catch (loadError) {
      setTasks([]);
      setError(loadError instanceof Error ? loadError.message : "Tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [adminView, highlightedId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusCounts = useMemo(() => ({
    PENDING: counts.pending,
    IN_PROGRESS: counts.inProgress,
    COMPLETED: counts.completed,
    CANCELLED: counts.cancelled,
  }), [counts]);

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
      setMessage([data.error, ...(data.details ?? [])].filter(Boolean).join(" ") || "Could not update task.");
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
          {canAssign && <AssignTaskButton onAssigned={load} />}
          <button type="button" onClick={load} aria-label="Refresh tasks" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {message && <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{message}</div>}
      {taskLinkMessage && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{taskLinkMessage}</div>}
      {error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={load} className="min-h-10 rounded-lg border border-red-300 px-3 font-semibold">Retry</button>
        </div>
      )}

      {admin && (
        <div className="mt-5 inline-flex rounded-lg border border-slate-200 p-1 dark:border-slate-700">
          <button type="button" onClick={() => setAdminView("all")} className={cn("min-h-10 rounded-md px-3 text-sm font-semibold", adminView === "all" ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300")}>
            All Tasks
          </button>
          <button type="button" onClick={() => setAdminView("assigned-by-me")} className={cn("min-h-10 rounded-md px-3 text-sm font-semibold", adminView === "assigned-by-me" ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300")}>
            Assigned By Me
          </button>
        </div>
      )}

      <div className={cn("flex gap-2 overflow-x-auto pb-1", admin ? "mt-3" : "mt-5")}>
        <button type="button" onClick={() => setStatus("ALL")} className={cn("shrink-0 rounded-full px-3 py-2 text-sm font-semibold", status === "ALL" ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>
          All
        </button>
        {taskStatuses.map((item) => (
          <button key={item} type="button" onClick={() => setStatus(item)} className={cn("shrink-0 rounded-full px-3 py-2 text-sm font-semibold", status === item ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>
            {display(item)} {statusCounts[item] ?? 0}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {loading && <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
        {!loading && !error && tasks.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
            {admin ? "No tasks found in this view." : "No tasks assigned to you."}
          </div>
        )}
        {tasks.map((task) => {
          const overdue = !["COMPLETED", "CANCELLED"].includes(task.status) && new Date(task.dueDate) < new Date();
          const taskLabel = taskTypeLabels[task.taskType as keyof typeof taskTypeLabels] ?? task.title;
          return (
            <article id={`task-${task.id}`} key={task.id} className={cn("rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900", highlightedId === task.id && "ring-2 ring-brand-500")}>
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
