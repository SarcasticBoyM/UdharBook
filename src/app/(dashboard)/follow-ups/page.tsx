"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Landmark,
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
  ledgerTag: string;
  mobileNumber: string;
  currentBalance: number;
  summary: string;
  detailedNotes: string;
  followUpType: string;
  recoveryAmount: number;
  paymentStatus: string;
  promiseDate: string | null;
  nextAction: string;
  nextActionAt: string | null;
  reminderStatus: string;
  status: string;
  statusTone: "green" | "yellow" | "red" | "blue" | "slate";
  createdBy: string;
  userRole: string;
  latestActivityAt: string;
  relativeActivityTime: string;
  visitStatus: string;
  chequeStatus: string;
  bankAccount: string;
  depositStatus: string;
  createdAt: string;
  lastUpdatedAt: string;
  isOverdue: boolean;
  isPromise: boolean;
  notes: string;
  timeline: {
    at: string;
    type: string;
    summary: string;
    by: string;
    status: string;
    notes: string;
  }[];
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

type ChequeReportRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amount: number;
  status: string;
  collectionDateTime: string;
  depositDateTime: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  frontImageUrl?: string | null;
  depositReceiptUrl?: string | null;
  collectionLatitude?: number | null;
  collectionLongitude?: number | null;
  staffVisit?: {
    id: string;
    notes: string | null;
    result: string | null;
    visitType: string;
    checkInLat: number;
    checkInLng: number;
    verified: boolean;
  } | null;
  customer: { partyName: string; contactNumber: string; batchTag?: string | null };
  collectedBy: { name: string };
  depositedAccount: { bankName: string; accountName: string; lastFourDigits: string } | null;
};

type ChequeReportResponse = {
  items: ChequeReportRow[];
  users: { id: string; name: string; role: string }[];
  summary: {
    totalCollected: number;
    underClearingAmount: number;
    clearedAmount: number;
    bouncedAmount: number;
    pendingDepositAmount: number;
  };
  pagination: { page: number; limit: number; total: number; pages: number };
};

type DepositAccount = {
  id: string;
  accountName: string;
  bankName: string;
  lastFourDigits: string;
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

const VISIT_OUTCOME_FILTERS = [
  "Invoice Hard Copy Delivered",
  "Order Received",
  "Product Discussion",
  "Delivery Discussion",
  "Site Visit",
  "Payment Collected",
  "Follow-up Later",
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

const emptyReportData: ReportResponse = {
  rows: [],
  users: [],
  summary: initialSummary,
  staffPerformance: [],
  trend: [],
  pagination: { page: 1, limit: 25, total: 0, pages: 1 },
};

const emptyChequeData: ChequeReportResponse = {
  items: [],
  users: [],
  summary: {
    totalCollected: 0,
    underClearingAmount: 0,
    clearedAmount: 0,
    bouncedAmount: 0,
    pendingDepositAmount: 0,
  },
  pagination: { page: 1, limit: 25, total: 0, pages: 1 },
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
  const [chequeData, setChequeData] = useState<ChequeReportResponse | null>(null);
  const [depositAccounts, setDepositAccounts] = useState<DepositAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [chequeLoading, setChequeLoading] = useState(true);
  const [error, setError] = useState("");
  const [chequeError, setChequeError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    staffId: "",
    customer: "",
    batchTag: "",
    status: "",
    outcome: "",
    minAmount: "",
    maxAmount: "",
    overdueOnly: false,
    todayOnly: false,
    promiseOnly: false,
    completedOnly: false,
    pendingOnly: false,
  });
  const [chequeFilters, setChequeFilters] = useState({
    status: "",
    accountId: "",
    bankOrCustomer: "",
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
    setError("");
    try {
      const res = await fetch(`/api/follow-up-reports?${params.toString()}`);
      if (!res.ok) throw new Error("Could not load reports");
      setData((await res.json()) as ReportResponse);
    } catch {
      setData(emptyReportData);
      setError("Follow-up reports could not be loaded. The selected shop may no longer exist or may not have any report data yet.");
    } finally {
      setLoading(false);
    }
  }, [params]);

  const chequeParams = useMemo(() => {
    const search = new URLSearchParams({ limit: "25" });
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.staffId) search.set("staffId", filters.staffId);
    if (filters.batchTag) search.set("batchTag", filters.batchTag);
    if (chequeFilters.status) search.set("status", chequeFilters.status);
    if (chequeFilters.accountId) search.set("depositedAccountId", chequeFilters.accountId);
    if (chequeFilters.bankOrCustomer) search.set("q", chequeFilters.bankOrCustomer);
    return search;
  }, [chequeFilters.accountId, chequeFilters.bankOrCustomer, chequeFilters.status, filters.batchTag, filters.from, filters.staffId, filters.to]);

  const loadChequeSummary = useCallback(async () => {
    setChequeLoading(true);
    setChequeError("");
    try {
      const [chequeRes, accountRes] = await Promise.all([
        fetch(`/api/cheques?${chequeParams.toString()}`),
        fetch("/api/cheque-deposit-accounts?activeOnly=false"),
      ]);
      if (chequeRes.ok) setChequeData((await chequeRes.json()) as ChequeReportResponse);
      else {
        setChequeData(emptyChequeData);
        setChequeError("Cheque reports could not be loaded for the selected shop.");
      }
      if (accountRes.ok) {
        const payload = await accountRes.json();
        setDepositAccounts(payload.accounts ?? []);
      }
    } catch {
      setChequeData(emptyChequeData);
      setDepositAccounts([]);
      setChequeError("Cheque reports could not be loaded for the selected shop.");
    } finally {
      setChequeLoading(false);
    }
  }, [chequeParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadChequeSummary();
  }, [loadChequeSummary]);

  const reportData = data ?? emptyReportData;
  const chequeReportData = chequeData ?? emptyChequeData;
  const summary = reportData.summary;
  const maxTrend = Math.max(...(reportData.trend.map((item) => item.amount) ?? [0]), 1);

  const updateFilter = (key: keyof typeof filters, value: string | boolean) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const exportReport = (format: "xlsx" | "csv" | "pdf") => {
    const exportParams = new URLSearchParams(params);
    exportParams.set("format", format);
    window.open(`/api/follow-up-reports?${exportParams.toString()}`, "_blank");
  };

  const exportChequeReport = (format: "xlsx" | "csv" | "pdf") => {
    const exportParams = new URLSearchParams(chequeParams);
    exportParams.set("format", format);
    window.open(`/api/cheques?${exportParams.toString()}`, "_blank");
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

      {(error || chequeError) && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {error || chequeError}
        </div>
      )}

      {!loading && !chequeLoading && !error && !chequeError && reportData.rows.length === 0 && chequeReportData.items.length === 0 && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          No report data is available yet. Create or select a business shop and add customers, follow-ups, or cheques to populate this page.
        </div>
      )}

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
              {reportData.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <Input label="Customer-wise" value={filters.customer} onChange={(value) => updateFilter("customer", value)} placeholder="Name or mobile" />
          <Input label="Batch / Firm" value={filters.batchTag} onChange={(value) => updateFilter("batchTag", value)} placeholder="YE, BT, Balaji" />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Visit Outcome</span>
            <select
              value={filters.outcome}
              onChange={(event) => updateFilter("outcome", event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All outcomes</option>
              {VISIT_OUTCOME_FILTERS.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
          </label>
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
            {(reportData.trend.length ? reportData.trend : [{ date: "No collections yet", amount: 0 }]).slice(-12).map((item) => (
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
            {reportData.staffPerformance.length ? (
              reportData.staffPerformance.map((staff, index) => (
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

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">Cheque Summary</h2>
            <p className="text-sm text-slate-500">All cheque collection, deposit, clearance, bounce, and under-clearing records.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => exportChequeReport("xlsx")} />
            <ExportButton label="CSV" icon={Download} onClick={() => exportChequeReport("csv")} />
            <ExportButton label="PDF" icon={FileText} onClick={() => exportChequeReport("pdf")} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Total cheques" value={chequeReportData.summary.totalCollected} icon={Landmark} />
          <Metric label="Total deposited" value={formatCurrency(chequeReportData.summary.underClearingAmount + chequeReportData.summary.clearedAmount + chequeReportData.summary.bouncedAmount)} icon={IndianRupee} />
          <Metric label="Total cleared" value={formatCurrency(chequeReportData.summary.clearedAmount)} icon={IndianRupee} tone="green" />
          <Metric label="Total bounced" value={formatCurrency(chequeReportData.summary.bouncedAmount)} icon={ShieldAlert} tone="red" />
          <Metric label="Under clearing" value={formatCurrency(chequeReportData.summary.underClearingAmount)} icon={BarChart3} tone="yellow" />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input
            label="Customer / bank / cheque"
            value={chequeFilters.bankOrCustomer}
            onChange={(value) => setChequeFilters((current) => ({ ...current, bankOrCustomer: value }))}
            placeholder="Name, bank, mobile, cheque no"
          />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Status-wise</span>
            <select
              value={chequeFilters.status}
              onChange={(event) => setChequeFilters((current) => ({ ...current, status: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All statuses</option>
              {["COLLECTED", "DEPOSITED", "CLEARED", "BOUNCED"].map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Account-wise</span>
            <select
              value={chequeFilters.accountId}
              onChange={(event) => setChequeFilters((current) => ({ ...current, accountId: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">All accounts</option>
              {depositAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.bankName} - {account.accountName} - {account.lastFourDigits}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end text-sm text-slate-500">
            {chequeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Date and staff filters above also apply here.
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1500px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                <Th>Customer</Th>
                <Th>Cheque No</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Collected By</Th>
                <Th>Deposit Account</Th>
                <Th>Cheque Image</Th>
                <Th>Receipt</Th>
                <Th>Visit Notes</Th>
                <Th>GPS</Th>
                <Th>Collected Date</Th>
                <Th>Deposited Date</Th>
                <Th>Cleared Date</Th>
                <Th>Bounced Date</Th>
              </tr>
            </thead>
            <tbody>
              {chequeReportData.items.length ? (
                chequeReportData.items.map((cheque) => (
                  <tr key={cheque.id} className="border-t border-slate-100 dark:border-slate-800">
                    <Td>{cheque.customer.partyName}{cheque.customer.batchTag ? ` [${cheque.customer.batchTag}]` : ""}</Td>
                    <Td>{cheque.chequeNumber}</Td>
                    <Td>{formatCurrency(cheque.amount)}</Td>
                    <Td><StatusPill status={cheque.status} /></Td>
                    <Td>{cheque.collectedBy.name}</Td>
                    <Td>
                      {cheque.depositedAccount
                        ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName} - ${cheque.depositedAccount.lastFourDigits}`
                        : "-"}
                    </Td>
                    <Td>
                      {cheque.frontImageUrl ? (
                        <a href={cheque.frontImageUrl} target="_blank" className="text-brand-600 hover:underline">View</a>
                      ) : "-"}
                    </Td>
                    <Td>
                      {cheque.depositReceiptUrl ? (
                        <a href={cheque.depositReceiptUrl} target="_blank" className="text-brand-600 hover:underline">View</a>
                      ) : "-"}
                    </Td>
                    <Td>
                      <span className="block max-w-xs truncate">{cheque.staffVisit?.result ?? cheque.staffVisit?.notes ?? "-"}</span>
                    </Td>
                    <Td>
                      {cheque.staffVisit ? (
                        <a
                          href={`https://www.google.com/maps?q=${cheque.staffVisit.checkInLat},${cheque.staffVisit.checkInLng}`}
                          target="_blank"
                          className="text-brand-600 hover:underline"
                        >
                          Map
                        </a>
                      ) : cheque.collectionLatitude && cheque.collectionLongitude ? (
                        <a href={`https://www.google.com/maps?q=${cheque.collectionLatitude},${cheque.collectionLongitude}`} target="_blank" className="text-brand-600 hover:underline">Map</a>
                      ) : "-"}
                    </Td>
                    <Td>{formatDateTime(cheque.collectionDateTime)}</Td>
                    <Td>{formatDateTime(cheque.depositDateTime)}</Td>
                    <Td>{formatDateTime(cheque.clearedAt)}</Td>
                    <Td>{formatDateTime(cheque.bouncedAt)}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-slate-500">
                    No cheque rows match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {reportData.rows.length ? (
            reportData.rows.map((row) => (
              <Fragment key={row.id}>
                <div className={cn("grid gap-3 p-4 text-sm lg:grid-cols-[220px_130px_minmax(260px,1fr)_210px_140px_150px_90px] lg:items-center", row.isOverdue && "bg-red-50/60 dark:bg-red-950/20", row.isPromise && !row.isOverdue && "bg-blue-50/60 dark:bg-blue-950/20")}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{row.customerName}{row.ledgerTag ? ` [${row.ledgerTag}]` : ""}</p>
                    <p className="text-xs text-slate-500">{row.mobileNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 lg:hidden">Current balance</p>
                    <p className="font-semibold">{formatCurrency(row.currentBalance)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-1 font-medium text-slate-900 dark:text-slate-100">{row.summary}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{row.followUpType}</span>
                      {row.recoveryAmount > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">{formatCurrency(row.recoveryAmount)}</span>}
                      {row.chequeStatus !== "-" && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-200">{row.chequeStatus}</span>}
                    </div>
                    {row.detailedNotes && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{row.detailedNotes}</p>}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Next action</p>
                    <p className={cn("truncate font-medium", row.isOverdue && "text-red-700 dark:text-red-300", row.isPromise && "text-blue-700 dark:text-blue-300")}>{row.nextAction}</p>
                  </div>
                  <BusinessStatusBadge status={row.status} tone={row.statusTone} />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Created by</p>
                    <p className="truncate font-medium">{row.createdBy}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    className="inline-flex min-h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700 lg:justify-center"
                  >
                    <span>{row.relativeActivityTime}</span>
                    {expanded === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
                {expanded === row.id && (
                  <div className="bg-slate-50 px-4 py-4 dark:bg-slate-950">
                    <div className="border-l-2 border-brand-300 pl-4">
                      <p className="font-semibold">Activity Timeline</p>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                        <Detail label="Follow-up Type" value={row.followUpType} />
                        <Detail label="Batch / Firm" value={row.ledgerTag || "-"} />
                        <Detail label="Payment Status" value={row.paymentStatus} />
                        <Detail label="Promise Date" value={formatDateTime(row.promiseDate)} />
                        <Detail label="Next Follow-up" value={formatDateTime(row.nextActionAt)} />
                        <Detail label="Reminder" value={row.reminderStatus} />
                        <Detail label="Follow-up By" value={`${row.createdBy} (${row.userRole})`} />
                        <Detail label="Visit Status" value={row.visitStatus} />
                        <Detail label="Cheque Status" value={row.chequeStatus} />
                        <Detail label="Bank Account" value={row.bankAccount} />
                        <Detail label="Deposit Status" value={row.depositStatus} />
                        <Detail label="Created" value={formatDateTime(row.createdAt)} />
                        <Detail label="Updated" value={formatDateTime(row.lastUpdatedAt)} />
                      </div>
                      <div className="mt-3 space-y-3">
                        {row.timeline.length ? (
                          row.timeline.map((item, index) => (
                            <div key={`${row.id}-${item.type}-${item.at}-${index}`} className="text-sm">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">{item.type}</span>
                                <StatusPill status={item.status} />
                                <span className="text-xs text-slate-500">{formatDateTime(item.at)}</span>
                              </div>
                              <p className="mt-1 text-slate-700 dark:text-slate-300">{item.summary}</p>
                              {item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
                              <p className="mt-1 text-xs text-slate-500">By {item.by}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500">No timeline details available.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            ))
          ) : (
            <div className="p-8 text-center text-sm text-slate-500">
              No report rows match the selected filters.
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm dark:border-slate-800">
          <span className="text-slate-500">
            Page {reportData.pagination.page ?? page} of {reportData.pagination.pages} / {reportData.pagination.total} rows
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
              disabled={page >= reportData.pagination.pages}
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

function BusinessStatusBadge({ status, tone }: { status: string; tone: ReportRow["statusTone"] }) {
  const toneClass = {
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    yellow: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  }[tone];
  return (
    <span className={cn("inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold", toneClass)}>
      {status}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white p-2 dark:bg-slate-900">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-medium text-slate-700 dark:text-slate-200">{value || "-"}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toUpperCase().replace(/\s+/g, "_");
  const isGood = normalized === "PAID" || normalized === "COMPLETED" || normalized === "RECOVERED" || normalized === "CLEARED";
  const isRisk = normalized === "NOT_REACHABLE" || normalized === "MISSED" || normalized === "WRONG_NUMBER" || normalized === "BOUNCED";
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
