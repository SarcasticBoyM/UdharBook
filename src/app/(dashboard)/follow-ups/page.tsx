"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Loader2,
  PhoneCall,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

type ReportRow = {
  id: string;
  customerId: string;
  customerName: string;
  mobileNumber: string;
  outstandingAmount: number;
  followUpDateTime: string | null;
  reminderStatus: string;
  lastFollowUp: string | null;
  nextFollowUp: string | null;
  staffName: string;
  userRole: string;
  followUpStatus: string;
  promiseDate: string | null;
  recoveryAmount: number;
  paymentStatus: string;
  notes: string;
  completionStatus: string;
  createdAt: string;
  lastActivityTimestamp: string;
};

type ReportResponse = {
  rows: ReportRow[];
  users: { id: string; name: string; role: string }[];
  summary: {
    dailyFollowUps: number;
    recoveryToday: number;
    pendingAmount: number;
    pendingCustomers: number;
    promises: number;
    notResponding: number;
    overdue: number;
    completed: number;
  };
  staffPerformance: {
    staffId: string;
    staffName: string;
    callsCompleted: number;
    recoveriesCompleted: number;
    recoveryAmount: number;
    pendingCases: number;
    promisesCollected: number;
    averageFollowUpTime: string;
  }[];
  trend: { date: string; amount: number }[];
  pagination: { page: number; limit: number; total: number; pages: number };
};

const STATUSES = [
  "PENDING",
  "CONTACTED",
  "PAYMENT_PROMISED",
  "PARTIAL_PAID",
  "PAID",
  "NOT_REACHABLE",
  "WRONG_NUMBER",
  "COMPLETED",
  "MISSED",
  "RESCHEDULED",
];

const initialSummary: ReportResponse["summary"] = {
  dailyFollowUps: 0,
  recoveryToday: 0,
  pendingAmount: 0,
  pendingCustomers: 0,
  promises: 0,
  notResponding: 0,
  overdue: 0,
  completed: 0,
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function FollowUpReportsPage() {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    staffId: "",
    customer: "",
    status: "",
    minAmount: "",
    maxAmount: "",
    overdueOnly: false,
    todayOnly: false,
    promiseOnly: false,
    completedOnly: false,
    pendingOnly: false,
  });

  const params = useMemo(() => {
    const search = new URLSearchParams({ page: String(page), limit: "25" });
    Object.entries(filters).forEach(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) search.set(key, "true");
      } else if (value) {
        search.set(key, value);
      }
    });
    return search;
  }, [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/follow-up-reports?${params.toString()}`);
      if (!res.ok) throw new Error("Could not load reports");
      setData((await res.json()) as ReportResponse);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary ?? initialSummary;
  const maxTrend = Math.max(...(data?.trend.map((item) => item.amount) ?? [0]), 1);

  const updateFilter = (key: keyof typeof filters, value: string | boolean) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const exportReport = (format: "xlsx" | "csv" | "pdf") => {
    const exportParams = new URLSearchParams(params);
    exportParams.set("format", format);
    window.open(`/api/follow-up-reports?${exportParams.toString()}`, "_blank");
  };

  return (
    <div className="mx-auto max-w-7xl pb-10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            Owner analytics
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">Follow-up Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete recovery monitoring, staff performance, activity history, and exports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => exportReport("xlsx")} />
          <ExportButton label="CSV" icon={Download} onClick={() => exportReport("csv")} />
          <ExportButton label="PDF" icon={FileText} onClick={() => exportReport("pdf")} />
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-8">
        <Metric label="Daily follow-ups" value={summary.dailyFollowUps} icon={PhoneCall} />
        <Metric label="Recovery today" value={formatCurrency(summary.recoveryToday)} icon={IndianRupee} tone="green" />
        <Metric label="Pending amount" value={formatCurrency(summary.pendingAmount)} icon={IndianRupee} />
        <Metric label="Pending cases" value={summary.pendingCustomers} icon={Users} tone="yellow" />
        <Metric label="Promises" value={summary.promises} icon={TrendingUp} />
        <Metric label="Not responding" value={summary.notResponding} icon={ShieldAlert} tone="red" />
        <Metric label="Overdue" value={summary.overdue} icon={ShieldAlert} tone="red" />
        <Metric label="Completed" value={summary.completed} icon={BarChart3} tone="green" />
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold">Advanced Filters</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input label="From" type="date" value={filters.from} onChange={(value) => updateFilter("from", value)} />
          <Input label="To" type="date" value={filters.to} onChange={(value) => updateFilter("to", value)} />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Staff-wise</span>
            <select
              value={filters.staffId}
              onChange={(event) => updateFilter("staffId", event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All staff</option>
              {data?.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <Input label="Customer-wise" value={filters.customer} onChange={(value) => updateFilter("customer", value)} placeholder="Name or mobile" />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Status-wise</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <Input label="Min amount" type="number" value={filters.minAmount} onChange={(value) => updateFilter("minAmount", value)} />
          <Input label="Max amount" type="number" value={filters.maxAmount} onChange={(value) => updateFilter("maxAmount", value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip active={filters.todayOnly} label="Today" onClick={() => updateFilter("todayOnly", !filters.todayOnly)} />
          <Chip active={filters.pendingOnly} label="Pending" onClick={() => updateFilter("pendingOnly", !filters.pendingOnly)} />
          <Chip active={filters.completedOnly} label="Completed" onClick={() => updateFilter("completedOnly", !filters.completedOnly)} />
          <Chip active={filters.overdueOnly} label="Overdue only" onClick={() => updateFilter("overdueOnly", !filters.overdueOnly)} />
          <Chip active={filters.promiseOnly} label="Promise to Pay only" onClick={() => updateFilter("promiseOnly", !filters.promiseOnly)} />
        </div>
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">Collection Trend Reports</h2>
          <div className="mt-4 space-y-3">
            {(data?.trend.length ? data.trend : [{ date: "No collections yet", amount: 0 }]).slice(-12).map((item) => (
              <div key={item.date} className="grid grid-cols-[110px_1fr_90px] items-center gap-3 text-sm">
                <span className="truncate text-slate-500">{item.date}</span>
                <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, (item.amount / maxTrend) * 100)}%` }} />
                </div>
                <span className="text-right font-semibold">{formatCurrency(item.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">Staff Performance Reports</h2>
          <div className="mt-4 space-y-3">
            {data?.staffPerformance.length ? (
              data.staffPerformance.map((staff, index) => (
                <div key={staff.staffId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{index === 0 ? "Top: " : ""}{staff.staffName}</p>
                    <span className="text-sm font-bold text-emerald-600">{formatCurrency(staff.recoveryAmount)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <span>Calls: {staff.callsCompleted}</span>
                    <span>Recoveries: {staff.recoveriesCompleted}</span>
                    <span>Pending: {staff.pendingCases}</span>
                    <span>Promises: {staff.promisesCollected}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No staff activity in this filter.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="font-semibold">Daily Follow-up Reports</h2>
            <p className="text-sm text-slate-500">
              Recovery, pending, promise-to-pay, not responding, overdue, and customer activity records.
            </p>
          </div>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-brand-600" />}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                <Th />
                <Th>Customer Name</Th>
                <Th>Mobile Number</Th>
                <Th>Balance Amount</Th>
                <Th>Follow-up Date & Time</Th>
                <Th>Reminder Status</Th>
                <Th>Next Follow-up</Th>
                <Th>Created By</Th>
                <Th>User Role</Th>
                <Th>Status</Th>
                <Th>Promise Date</Th>
                <Th>Recovery Amount</Th>
                <Th>Payment Status</Th>
                <Th>Completion</Th>
                <Th>Created At</Th>
                <Th>Last Activity</Th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.length ? (
                data.rows.map((row) => (
                  <>
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                      <Td>
                        <button type="button" onClick={() => setExpanded(expanded === row.id ? null : row.id)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                          {expanded === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </Td>
                      <Td>{row.customerName}</Td>
                      <Td>{row.mobileNumber}</Td>
                      <Td>{formatCurrency(row.outstandingAmount)}</Td>
                      <Td>{formatDateTime(row.followUpDateTime)}</Td>
                      <Td>{row.reminderStatus}</Td>
                      <Td>{formatDateTime(row.nextFollowUp)}</Td>
                      <Td>{row.staffName}</Td>
                      <Td>{statusLabel(row.userRole)}</Td>
                      <Td><StatusPill status={row.followUpStatus} /></Td>
                      <Td>{formatDateTime(row.promiseDate)}</Td>
                      <Td>{formatCurrency(row.recoveryAmount)}</Td>
                      <Td>{row.paymentStatus}</Td>
                      <Td>{row.completionStatus}</Td>
                      <Td>{formatDateTime(row.createdAt)}</Td>
                      <Td>{formatDateTime(row.lastActivityTimestamp)}</Td>
                    </tr>
                    {expanded === row.id && (
                      <tr className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <td colSpan={15} className="p-4">
                          <div className="border-l-2 border-brand-300 pl-4">
                            <p className="font-semibold">Activity Timeline</p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{row.notes || "No notes recorded."}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {statusLabel(row.followUpStatus)} by {row.staffName} ({statusLabel(row.userRole)}) at {formatDateTime(row.lastActivityTimestamp)}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              ) : (
                <tr>
                  <td colSpan={15} className="p-8 text-center text-slate-500">
                    No report rows match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm dark:border-slate-800">
          <span className="text-slate-500">
            Page {data?.pagination.page ?? page} of {data?.pagination.pages ?? 1} / {data?.pagination.total ?? 0} rows
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50 dark:border-slate-700"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!data || page >= data.pagination.pages}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-50 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      </section>
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
  tone?: "slate" | "green" | "yellow" | "red";
}) {
  const toneClass = {
    slate: "bg-white dark:bg-slate-900",
    green: "bg-emerald-50 dark:bg-emerald-950/30",
    yellow: "bg-amber-50 dark:bg-amber-950/30",
    red: "bg-red-50 dark:bg-red-950/30",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-slate-200 p-3 shadow-sm dark:border-slate-800", toneClass)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold",
        active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 dark:border-slate-700"
      )}
    >
      {label}
    </button>
  );
}

function ExportButton({ label, icon: Icon, onClick }: { label: string; icon: React.ElementType; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const isGood = status === "PAID" || status === "COMPLETED";
  const isRisk = status === "NOT_REACHABLE" || status === "MISSED" || status === "WRONG_NUMBER";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
        isGood && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        isRisk && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
        !isGood && !isRisk && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-top">{children}</td>;
}
