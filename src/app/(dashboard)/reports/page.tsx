"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, Download, FileSpreadsheet, FileText, Landmark, MapPinned, Printer, Search, ShieldAlert, ShoppingBag, UserCheck, WalletCards } from "lucide-react";
import type { ChequeStatus, UserRole } from "@prisma/client";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type UserOption = { id: string; name: string; role: string };
type DepositAccount = { id: string; accountName: string; bankName: string; lastFourDigits: string };
type ChequeActivity = {
  id: string;
  type: string;
  toStatus: ChequeStatus | null;
  notes: string | null;
  createdAt: string;
  user: { name: string; role: string };
};
type ChequeItem = {
  id: string;
  chequeNumber: string;
  bankName: string;
  chequeDate: string;
  amount: number;
  status: ChequeStatus;
  collectionDateTime: string;
  collectionNotes: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  depositDateTime: string | null;
  depositSlipUrl: string | null;
  depositReceiptUrl: string | null;
  bounceReason: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  customer: { partyName: string; contactNumber: string; batchTag?: string | null };
  collectedBy: UserOption;
  depositedAccount: DepositAccount | null;
  activities: ChequeActivity[];
};
type ChequeResponse = {
  items: ChequeItem[];
  users: UserOption[];
  summary: {
    filteredChequeCount: number;
    filteredTotalAmount: number;
    filteredPendingAmount: number;
    clearedAmount: number;
    bouncedAmount: number;
  };
  pagination: { page: number; limit: number; total: number; pages: number };
};
type StaffAttendanceRow = {
  staffId: string;
  staffName: string;
  role: UserRole;
  loginTime: string | null;
  logoutTime: string | null;
  firstActivity: string | null;
  lastActivity: string | null;
  totalActiveMinutes: number;
  totalVisits: number;
  completedVisits: number;
  ordersTaken: number;
  paymentsCollected: number;
  chequesCollected: number;
  followUpsHandled: number;
  chequeProcessing: number;
  gpsActiveStatus: string;
  currentStatus: "ACTIVE" | "IDLE" | "OFFLINE" | "LOGGED_OUT";
};
type SimpleAttendanceRow = {
  id: string;
  staffId: string;
  workDate: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
};
type StaffAttendanceResponse = {
  success: boolean;
  rows: StaffAttendanceRow[];
  rawRows?: SimpleAttendanceRow[];
  summary: {
    staffPresentToday: number;
    activeInField: number;
    totalVisits: number;
    ordersTakenToday: number;
    paymentsCollectedToday: number;
    pendingStaffCheckouts: number;
  };
};

const baseReports = [
  { type: "outstanding", label: "Outstanding Report", description: "Customer-wise pending balance report." },
  { type: "follow-up", label: "Follow-up Report", description: "Follow-up history with status and notes." },
  { type: "aging", label: "Customer Aging Report", description: "Outstanding balance by aging bucket." },
];

const statuses: { value: ChequeStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "COLLECTED", label: "Collected" },
  { value: "PENDING_DEPOSIT", label: "Pending Deposit" },
  { value: "DEPOSITED", label: "Deposited" },
  { value: "CLEARED", label: "Cleared" },
  { value: "BOUNCED", label: "Bounced" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "RETURNED_TO_PARTY", label: "Returned" },
  { value: "REPLACED", label: "Replaced" },
];

function statusLabel(status: string) {
  if (status === "RETURNED_TO_PARTY") return "Returned";
  if (status === "PENDING_DEPOSIT") return "Pending Deposit";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: ChequeStatus) {
  if (status === "CLEARED") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100";
  if (status === "BOUNCED" || status === "CANCELLED" || status === "REPLACED" || status === "RETURNED_TO_PARTY") return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100";
  if (status === "DEPOSITED") return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100";
}

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [partyName, setPartyName] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [bankName, setBankName] = useState("");
  const [query, setQuery] = useState("");
  const [staffId, setStaffId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [chequePage, setChequePage] = useState(1);
  const [data, setData] = useState<ChequeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [chequeError, setChequeError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attendancePreset, setAttendancePreset] = useState("today");
  const [attendanceFrom, setAttendanceFrom] = useState("");
  const [attendanceTo, setAttendanceTo] = useState("");
  const [attendanceStaff, setAttendanceStaff] = useState("");
  const [attendanceRole, setAttendanceRole] = useState("");
  const [attendanceActive, setAttendanceActive] = useState("");
  const [attendanceData, setAttendanceData] = useState<StaffAttendanceResponse | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const chequeFilterKey = useMemo(
    () => JSON.stringify({ from, to, status, partyName, batchTag, bankName, query, staffId, minAmount, maxAmount }),
    [bankName, batchTag, from, maxAmount, minAmount, partyName, query, staffId, status, to]
  );

  const chequeParams = useMemo(() => {
    const params = new URLSearchParams();
    const addText = (key: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed) params.set(key, trimmed);
    };
    const addAmount = (key: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed && Number.isFinite(Number(trimmed))) params.set(key, trimmed);
    };
    addText("from", from);
    addText("to", to);
    if (status) params.set("status", status);
    addText("partyName", partyName);
    addText("batchTag", batchTag);
    addText("bankName", bankName);
    addText("q", query);
    if (staffId) params.set("staffId", staffId);
    addAmount("minAmount", minAmount);
    addAmount("maxAmount", maxAmount);
    params.set("page", String(chequePage));
    params.set("limit", "50");
    return params;
  }, [bankName, batchTag, chequePage, from, maxAmount, minAmount, partyName, query, staffId, status, to]);
  const attendanceParams = useMemo(() => {
    const params = new URLSearchParams({ preset: attendancePreset });
    if (attendancePreset === "custom") {
      if (attendanceFrom) params.set("from", attendanceFrom);
      if (attendanceTo) params.set("to", attendanceTo);
    }
    const staff = attendanceStaff.trim();
    if (staff) params.set("staffName", staff);
    if (attendanceRole) params.set("role", attendanceRole);
    if (attendanceActive) params.set("active", attendanceActive);
    return params;
  }, [attendanceActive, attendanceFrom, attendancePreset, attendanceRole, attendanceStaff, attendanceTo]);

  useEffect(() => {
    setChequePage(1);
    setExpandedId(null);
  }, [chequeFilterKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setChequeError(null);
    const url = `/api/cheques?${chequeParams.toString()}`;
    console.info("reports_cheque_filter_payload", {
      params: Object.fromEntries(chequeParams.entries()),
      page: chequePage,
    });
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
        if (!response.ok) {
          throw new Error(typeof payload === "string" ? payload : payload?.error ?? "Cheque report request failed");
        }
        if (!payload || !Array.isArray(payload.items)) {
          throw new Error("Cheque report returned an invalid response shape");
        }
        return payload as ChequeResponse;
      })
      .then((payload: ChequeResponse | null) => {
        if (!alive || !payload) return;
        setData(payload);
        console.info("reports_cheque_query_result", {
          filteredCount: payload.pagination.total,
          renderedCount: payload.items.length,
          page: payload.pagination.page,
          pages: payload.pagination.pages,
        });
        if (payload.items.length === 0) {
          console.info("reports_cheque_empty_state", {
            reason: payload.pagination.total === 0 ? "No cheques matched current filters" : "Current page has no rows",
            params: Object.fromEntries(chequeParams.entries()),
          });
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const message = error instanceof Error ? error.message : "Cheque report could not be loaded";
        console.error("reports_cheque_query_failed", {
          message,
          params: Object.fromEntries(chequeParams.entries()),
        });
        setChequeError(message);
        setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chequeParams, chequePage]);
  useEffect(() => {
    let alive = true;
    setAttendanceLoading(true);
    setAttendanceError(null);
    const url = `/api/reports/staff-attendance?${attendanceParams.toString()}`;
    console.info("reports_attendance_filter_payload", {
      params: Object.fromEntries(attendanceParams.entries()),
    });
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
        if (!response.ok) {
          throw new Error(typeof payload === "string" ? payload : payload?.error ?? "Attendance report request failed");
        }
        if (!payload || (!Array.isArray(payload.rows) && !Array.isArray(payload.rawRows))) {
          throw new Error("Attendance report returned an invalid response shape");
        }
        return payload as StaffAttendanceResponse;
      })
      .then((payload: StaffAttendanceResponse | null) => {
        if (!alive || !payload) return;
        setAttendanceData(payload);
        console.info("reports_attendance_query_result", {
          renderedCount: payload.rows.length,
          rawRows: payload.rawRows?.length ?? 0,
          summary: payload.summary,
        });
        if (payload.rows.length === 0 && !payload.rawRows?.length) {
          console.info("reports_attendance_empty_state", {
            reason: "No staff matched current filters",
            params: Object.fromEntries(attendanceParams.entries()),
          });
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const message = error instanceof Error ? error.message : "Attendance report could not be loaded";
        console.error("reports_attendance_query_failed", {
          message,
          params: Object.fromEntries(attendanceParams.entries()),
        });
        setAttendanceError(message);
        setAttendanceData(null);
      })
      .finally(() => {
        if (alive) setAttendanceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attendanceParams]);

  const downloadBase = (type: string, format: "xlsx" | "csv" | "pdf") => {
    const params = new URLSearchParams({ format });
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    if (batchTag) params.set("batchTag", batchTag);
    window.open(`/api/reports/${type}?${params.toString()}`, "_blank");
  };

  const downloadChequeTracker = (format: "xlsx" | "csv" | "pdf") => {
    const params = new URLSearchParams(chequeParams);
    params.set("format", format);
    params.set("report", "tracker");
    window.open(`/api/cheques?${params.toString()}`, "_blank");
  };
  const resetChequeFilters = () => {
    setFrom("");
    setTo("");
    setStatus("");
    setPartyName("");
    setBatchTag("");
    setBankName("");
    setQuery("");
    setStaffId("");
    setMinAmount("");
    setMaxAmount("");
    setChequePage(1);
    setExpandedId(null);
  };
  const downloadAttendance = (format: "xlsx" | "csv") => {
    const params = new URLSearchParams(attendanceParams);
    params.set("format", format);
    window.open(`/api/reports/staff-attendance?${params.toString()}`, "_blank");
  };
  const attendanceRawRows = attendanceData?.rawRows ?? [];
  const showRawAttendanceFallback = !attendanceLoading && !attendanceError && !attendanceData?.rows.length && attendanceRawRows.length > 0;

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Accounting, recovery, customer, and cheque tracking exports.</p>
        </div>
      </div>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold">Cheques Report</h2>
            <p className="text-sm text-slate-500">Complete cheque-wise collection, deposit, clearance, bounce, and account tracking.</p>
          </div>
          <Link href="/cheques" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
            Open Cheque Collections
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Total Cheques" value={data?.summary.filteredChequeCount ?? 0} icon={Landmark} />
          <SummaryCard label="Total Amount" value={formatCurrency(data?.summary.filteredTotalAmount ?? 0)} icon={WalletCards} />
          <SummaryCard label="Pending Clearance" value={formatCurrency(data?.summary.filteredPendingAmount ?? 0)} icon={Printer} tone="yellow" />
          <SummaryCard label="Cleared Amount" value={formatCurrency(data?.summary.clearedAmount ?? 0)} icon={WalletCards} tone="green" />
          <SummaryCard label="Bounced Amount" value={formatCurrency(data?.summary.bouncedAmount ?? 0)} icon={ShieldAlert} tone="red" />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Input label="Party Name" value={partyName} onChange={setPartyName} placeholder="Customer or party" />
          <Input label="Batch / Firm" value={batchTag} onChange={setBatchTag} placeholder="YE, BT, Balaji" />
          <Input label="Bank Name" value={bankName} onChange={setBankName} placeholder="Cheque bank" />
          <Input label="Search" value={query} onChange={setQuery} placeholder="Mobile, cheque no, amount" icon />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Current Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
              {statuses.map((item) => (
                <option key={item.value || "all"} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Collected By</span>
            <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
              <option value="">All staff</option>
              {data?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <Input label="Min Amount" value={minAmount} onChange={setMinAmount} placeholder="0" type="number" />
          <Input label="Max Amount" value={maxAmount} onChange={setMaxAmount} placeholder="100000" type="number" />
          <div className="grid grid-cols-2 gap-3">
            <DateInput label="From" value={from} onChange={setFrom} />
            <DateInput label="To" value={to} onChange={setTo} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-500">
            Showing {data?.items.length ?? 0} of {data?.pagination.total ?? 0} cheques
          </p>
          <button type="button" onClick={resetChequeFilters} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 font-semibold dark:border-slate-700">
            Reset Filters
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="hidden min-w-[1240px] text-left text-sm lg:table">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                {["Party Name", "Batch / Firm", "Mobile Number", "Amount", "Cheque Number", "Bank Name", "Cheque Date", "Collected Date", "Deposit Date", "Clearance Date", "Bounce Date", "Current Status", "Collected By", "Deposit Account", "Notes"].map((header) => (
                  <th key={header} className="px-3 py-2">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-500">Loading cheque report...</td></tr>
              ) : chequeError ? (
                <tr><td colSpan={15} className="px-3 py-8 text-center text-red-600">{chequeError}</td></tr>
              ) : data?.items.length ? (
                data.items.map((cheque) => (
                  <tr key={cheque.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="px-3 py-2 font-semibold">{cheque.customer.partyName}</td>
                    <td className="px-3 py-2">{cheque.customer.batchTag ?? "-"}</td>
                    <td className="px-3 py-2">{cheque.customer.contactNumber}</td>
                    <td className="px-3 py-2 font-semibold">{formatCurrency(cheque.amount)}</td>
                    <td className="px-3 py-2">{cheque.chequeNumber}</td>
                    <td className="px-3 py-2">{cheque.bankName}</td>
                    <td className="px-3 py-2">{formatDate(cheque.chequeDate)}</td>
                    <td className="px-3 py-2">{formatDate(cheque.collectionDateTime)}</td>
                    <td className="px-3 py-2">{formatDate(cheque.depositDateTime)}</td>
                    <td className="px-3 py-2">{formatDate(cheque.clearedAt)}</td>
                    <td className="px-3 py-2">{formatDate(cheque.bouncedAt)}</td>
                    <td className="px-3 py-2"><StatusBadge status={cheque.status} /></td>
                    <td className="px-3 py-2">{cheque.collectedBy.name}</td>
                    <td className="px-3 py-2">{cheque.depositedAccount ? `${cheque.depositedAccount.bankName} - ${cheque.depositedAccount.accountName}` : "-"}</td>
                    <td className="px-3 py-2">{cheque.collectionNotes || cheque.bounceReason || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={15} className="px-3 py-8 text-center text-slate-500">No cheques match this report.</td></tr>
              )}
            </tbody>
          </table>

          <div className="space-y-3 p-3 lg:hidden">
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading cheque report...</p>
              ) : chequeError ? (
              <p className="py-6 text-center text-sm text-red-600">{chequeError}</p>
            ) : data?.items.length ? (
              data.items.map((cheque) => (
                <article key={cheque.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <button type="button" onClick={() => setExpandedId((current) => current === cheque.id ? null : cheque.id)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{cheque.customer.partyName}{cheque.customer.batchTag ? ` [${cheque.customer.batchTag}]` : ""}</h3>
                        <p className="text-sm text-slate-500">{cheque.chequeNumber} | {cheque.bankName}</p>
                      </div>
                      <StatusBadge status={cheque.status} />
                    </div>
                    <p className="mt-2 text-lg font-bold">{formatCurrency(cheque.amount)}</p>
                  </button>
                  {expandedId === cheque.id && <ChequeDetails cheque={cheque} />}
                </article>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">No cheques match this report.</p>
            )}
          </div>
        </div>

        {data ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Page {data.pagination.page} of {data.pagination.pages}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading || chequePage <= 1}
                onClick={() => setChequePage((current) => Math.max(1, current - 1))}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={loading || chequePage >= data.pagination.pages}
                onClick={() => setChequePage((current) => current + 1)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold">Staff Attendance Report</h2>
            <p className="text-sm text-slate-500">Attendance, activity, GPS freshness, visit productivity, and operational staff visibility.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => downloadAttendance("xlsx")} />
            <ExportButton label="CSV" icon={Download} onClick={() => downloadAttendance("csv")} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <SummaryCard label="Staff Present Today" value={attendanceData?.summary.staffPresentToday ?? 0} icon={UserCheck} tone="green" />
          <SummaryCard label="Active in Field" value={attendanceData?.summary.activeInField ?? 0} icon={MapPinned} />
          <SummaryCard label="Total Visits" value={attendanceData?.summary.totalVisits ?? 0} icon={CalendarDays} />
          <SummaryCard label="Orders Taken Today" value={attendanceData?.summary.ordersTakenToday ?? 0} icon={ShoppingBag} />
          <SummaryCard label="Payments Collected Today" value={attendanceData?.summary.paymentsCollectedToday ?? 0} icon={WalletCards} />
          <SummaryCard label="Pending Staff Checkouts" value={attendanceData?.summary.pendingStaffCheckouts ?? 0} icon={Clock3} tone="yellow" />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Date Filter</span>
            <select value={attendancePreset} onChange={(event) => setAttendancePreset(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>
          <Input label="Staff Name" value={attendanceStaff} onChange={setAttendanceStaff} placeholder="Search staff" />
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Role</span>
            <select value={attendanceRole} onChange={(event) => setAttendanceRole(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
              <option value="">All roles</option>
              <option value="SHOP_ADMIN">Shop Admin</option>
              <option value="ACCOUNT_STAFF">Account Staff</option>
              <option value="SALES_PERSON">Sales Person</option>
              <option value="SALES_PERSON_CUM_ACCOUNTS">Sales Person Cum Accounts</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-600 dark:text-slate-300">Active/Inactive</span>
            <select value={attendanceActive} onChange={(event) => setAttendanceActive(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
              <option value="">All staff</option>
              <option value="active">Active users</option>
              <option value="inactive">Inactive users</option>
            </select>
          </label>
          {attendancePreset === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <DateInput label="From" value={attendanceFrom} onChange={setAttendanceFrom} />
              <DateInput label="To" value={attendanceTo} onChange={setAttendanceTo} />
            </div>
          )}
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="hidden min-w-[1240px] text-left text-sm lg:table">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                {["Staff Name", "Role", "Login Time", "Logout Time", "First Activity", "Last Activity", "Total Active Hours", "Total Visits", "Completed Visits", "Orders Taken", "Payments Collected", "Cheques Collected", "GPS Active Status", "Current Status"].map((header) => (
                  <th key={header} className="px-3 py-2">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attendanceLoading ? (
                <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-500">Loading attendance report...</td></tr>
              ) : attendanceError ? (
                <tr><td colSpan={14} className="px-3 py-8 text-center text-red-600">{attendanceError}</td></tr>
              ) : showRawAttendanceFallback ? (
                <>
                  <tr className="bg-amber-50 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <td colSpan={14} className="px-3 py-2">Showing simplified attendance rows while detailed metrics are unavailable.</td>
                  </tr>
                  {attendanceRawRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200 dark:border-slate-800">
                      <td className="px-3 py-2 font-semibold">{row.staffId}</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">{formatDate(row.startedAt)}</td>
                      <td className="px-3 py-2">{formatDate(row.endedAt)}</td>
                      <td className="px-3 py-2">{formatDate(row.workDate)}</td>
                      <td className="px-3 py-2">{formatDate(row.endedAt ?? row.startedAt)}</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">-</td>
                      <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    </tr>
                  ))}
                </>
              ) : attendanceData?.rows.length ? (
                attendanceData.rows.map((row) => (
                  <tr key={row.staffId} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="px-3 py-2 font-semibold">{row.staffName}</td>
                    <td className="px-3 py-2">{statusLabel(row.role)}</td>
                    <td className="px-3 py-2">{formatDate(row.loginTime)}</td>
                    <td className="px-3 py-2">{formatDate(row.logoutTime)}</td>
                    <td className="px-3 py-2">{formatDate(row.firstActivity)}</td>
                    <td className="px-3 py-2">{formatDate(row.lastActivity)}</td>
                    <td className="px-3 py-2">{minutesToHours(row.totalActiveMinutes)}</td>
                    <td className="px-3 py-2">{row.totalVisits}</td>
                    <td className="px-3 py-2">{row.completedVisits}</td>
                    <td className="px-3 py-2">{row.ordersTaken}</td>
                    <td className="px-3 py-2">{row.paymentsCollected}</td>
                    <td className="px-3 py-2">{row.chequesCollected}</td>
                    <td className="px-3 py-2">{row.gpsActiveStatus}</td>
                    <td className="px-3 py-2"><AttendanceStatusBadge status={row.currentStatus} /></td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-500">No staff activity matches this report.</td></tr>
              )}
            </tbody>
          </table>
          <div className="space-y-3 p-3 lg:hidden">
            {attendanceLoading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading attendance report...</p>
            ) : attendanceError ? (
              <p className="py-6 text-center text-sm text-red-600">{attendanceError}</p>
            ) : showRawAttendanceFallback ? (
              attendanceRawRows.map((row) => (
                <article key={row.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">{row.staffId}</h3>
                      <p className="text-sm text-slate-500">{formatDate(row.workDate)}</p>
                    </div>
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{statusLabel(row.status)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <Info label="Start Time" value={formatDate(row.startedAt)} />
                    <Info label="End Time" value={formatDate(row.endedAt)} />
                    <Info label="Staff ID" value={row.staffId} />
                    <Info label="Status" value={statusLabel(row.status)} />
                  </div>
                </article>
              ))
            ) : attendanceData?.rows.length ? (
              attendanceData.rows.map((row) => (
                <article key={row.staffId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">{row.staffName}</h3>
                      <p className="text-sm text-slate-500">{statusLabel(row.role)}</p>
                    </div>
                    <AttendanceStatusBadge status={row.currentStatus} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <Info label="Active Hours" value={minutesToHours(row.totalActiveMinutes)} />
                    <Info label="Visits" value={`${row.completedVisits}/${row.totalVisits}`} />
                    <Info label="Orders" value={String(row.ordersTaken)} />
                    <Info label="Cheques" value={String(row.chequesCollected)} />
                    <Info label="First Activity" value={formatDate(row.firstActivity)} />
                    <Info label="Last Activity" value={formatDate(row.lastActivity)} />
                  </div>
                </article>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">No staff activity matches this report.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {baseReports.map((report) => (
          <div key={report.type} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-semibold">{report.label}</h3>
            <p className="mt-1 text-sm text-slate-500">{report.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => downloadBase(report.type, "xlsx")} />
              <ExportButton label="CSV" icon={Download} onClick={() => downloadBase(report.type, "csv")} />
              <ExportButton label="PDF" icon={FileText} onClick={() => downloadBase(report.type, "pdf")} />
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-semibold">Cheque Tracker Report</h3>
          <p className="mt-1 text-sm text-slate-500">Detailed cheque tracker export using the current cheque report filters.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => downloadChequeTracker("xlsx")} />
            <ExportButton label="CSV" icon={Download} onClick={() => downloadChequeTracker("csv")} />
            <ExportButton label="PDF" icon={FileText} onClick={() => downloadChequeTracker("pdf")} />
          </div>
        </div>
      </section>
    </div>
  );
}

function ChequeDetails({ cheque }: { cheque: ChequeItem }) {
  return (
    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Info label="Collected" value={formatDate(cheque.collectionDateTime)} />
        <Info label="Deposit" value={formatDate(cheque.depositDateTime)} />
        <Info label="Cleared" value={formatDate(cheque.clearedAt)} />
        <Info label="Bounced" value={formatDate(cheque.bouncedAt)} />
      </div>
      <div className="grid gap-2">
        {cheque.frontImageUrl && <PreviewLink label="Front cheque image" href={cheque.frontImageUrl} />}
        {cheque.backImageUrl && <PreviewLink label="Back cheque image" href={cheque.backImageUrl} />}
        {cheque.depositSlipUrl && <PreviewLink label="Deposit slip" href={cheque.depositSlipUrl} />}
        {cheque.depositReceiptUrl && <PreviewLink label="Deposit receipt" href={cheque.depositReceiptUrl} />}
        <Link href="/cheques" className="rounded-lg border px-3 py-2 text-center font-semibold dark:border-slate-700">Open full cheque detail</Link>
      </div>
      <ol className="space-y-2">
        {cheque.activities.slice(0, 4).map((activity) => (
          <li key={activity.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
            <p className="font-semibold">{statusLabel(activity.type)}{activity.toStatus ? `: ${statusLabel(activity.toStatus)}` : ""}</p>
            <p className="text-xs text-slate-500">{formatDate(activity.createdAt)} by {activity.user.name}</p>
            {activity.notes && <p className="mt-1 text-xs">{activity.notes}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", icon = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; icon?: boolean }) {
  return (
    <label className="text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <span className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
        {icon && <Search className="h-4 w-4 text-slate-400" />}
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none" />
      </span>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" />
    </label>
  );
}

function SummaryCard({ label, value, icon: Icon, tone = "slate" }: { label: string; value: string | number; icon: typeof Landmark; tone?: "slate" | "yellow" | "green" | "red" }) {
  const classes = {
    slate: "bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100",
    yellow: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    green: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
    red: "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100",
  }[tone];
  return (
    <div className={cn("rounded-lg border border-slate-200 p-3 dark:border-slate-800", classes)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ChequeStatus }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-bold", statusTone(status))}>{statusLabel(status)}</span>;
}

function minutesToHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function AttendanceStatusBadge({ status }: { status: StaffAttendanceRow["currentStatus"] }) {
  const classes = {
    ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    IDLE: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
    OFFLINE: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    LOGGED_OUT: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100",
  }[status];
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-bold", classes)}>{statusLabel(status)}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-950">
      <p className="text-[11px] uppercase text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function PreviewLink({ label, href }: { label: string; href: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="rounded-lg border px-3 py-2 text-center font-semibold dark:border-slate-700">{label}</a>;
}

function ExportButton({ label, icon: Icon, onClick }: { label: string; icon: typeof Download; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
