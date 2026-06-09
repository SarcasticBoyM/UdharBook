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
  customer: { partyName: string; contactNumber: string };
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
type StaffAttendanceResponse = {
  success: boolean;
  rows: StaffAttendanceRow[];
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
  { value: "DEPOSITED", label: "Deposited" },
  { value: "CLEARED", label: "Cleared" },
  { value: "BOUNCED", label: "Bounced" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REPLACED", label: "Returned" },
];

function statusLabel(status: string) {
  if (status === "REPLACED") return "Returned";
  if (status === "PENDING_DEPOSIT") return "Pending Deposit";
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
}

function statusTone(status: ChequeStatus) {
  if (status === "CLEARED") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100";
  if (status === "BOUNCED" || status === "CANCELLED" || status === "REPLACED") return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100";
  if (status === "DEPOSITED") return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100";
}

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [partyName, setPartyName] = useState("");
  const [bankName, setBankName] = useState("");
  const [query, setQuery] = useState("");
  const [staffId, setStaffId] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [data, setData] = useState<ChequeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attendancePreset, setAttendancePreset] = useState("today");
  const [attendanceFrom, setAttendanceFrom] = useState("");
  const [attendanceTo, setAttendanceTo] = useState("");
  const [attendanceStaff, setAttendanceStaff] = useState("");
  const [attendanceRole, setAttendanceRole] = useState("");
  const [attendanceActive, setAttendanceActive] = useState("");
  const [attendanceData, setAttendanceData] = useState<StaffAttendanceResponse | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  const chequeParams = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (status) params.set("status", status);
    if (partyName) params.set("partyName", partyName);
    if (bankName) params.set("bankName", bankName);
    if (query) params.set("q", query);
    if (staffId) params.set("staffId", staffId);
    if (minAmount) params.set("minAmount", minAmount);
    if (maxAmount) params.set("maxAmount", maxAmount);
    params.set("limit", "50");
    return params;
  }, [bankName, from, maxAmount, minAmount, partyName, query, staffId, status, to]);
  const attendanceParams = useMemo(() => {
    const params = new URLSearchParams({ preset: attendancePreset });
    if (attendancePreset === "custom") {
      if (attendanceFrom) params.set("from", attendanceFrom);
      if (attendanceTo) params.set("to", attendanceTo);
    }
    if (attendanceStaff) params.set("staffName", attendanceStaff);
    if (attendanceRole) params.set("role", attendanceRole);
    if (attendanceActive) params.set("active", attendanceActive);
    return params;
  }, [attendanceActive, attendanceFrom, attendancePreset, attendanceRole, attendanceStaff, attendanceTo]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/cheques?${chequeParams.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: ChequeResponse | null) => {
        if (alive) setData(payload);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chequeParams]);
  useEffect(() => {
    let alive = true;
    setAttendanceLoading(true);
    fetch(`/api/reports/staff-attendance?${attendanceParams.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: StaffAttendanceResponse | null) => {
        if (alive) setAttendanceData(payload);
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
    window.open(`/api/reports/${type}?${params.toString()}`, "_blank");
  };

  const downloadCheques = (format: "xlsx" | "csv" | "pdf") => {
    const params = new URLSearchParams(chequeParams);
    params.set("format", format);
    window.open(`/api/cheques?${params.toString()}`, "_blank");
  };
  const downloadAttendance = (format: "xlsx" | "csv") => {
    const params = new URLSearchParams(attendanceParams);
    params.set("format", format);
    window.open(`/api/reports/staff-attendance?${params.toString()}`, "_blank");
  };

  return (
    <div className="mx-auto max-w-7xl pb-16">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">Accounting, recovery, customer, and cheque tracking exports.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton label="Excel" icon={FileSpreadsheet} onClick={() => downloadCheques("xlsx")} />
          <ExportButton label="CSV" icon={Download} onClick={() => downloadCheques("csv")} />
          <ExportButton label="PDF" icon={FileText} onClick={() => downloadCheques("pdf")} />
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

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="hidden min-w-[1180px] text-left text-sm lg:table">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                {["Party Name", "Mobile Number", "Amount", "Cheque Number", "Bank Name", "Cheque Date", "Collected Date", "Deposit Date", "Clearance Date", "Bounce Date", "Current Status", "Collected By", "Deposit Account", "Notes"].map((header) => (
                  <th key={header} className="px-3 py-2">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-500">Loading cheque report...</td></tr>
              ) : data?.items.length ? (
                data.items.map((cheque) => (
                  <tr key={cheque.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="px-3 py-2 font-semibold">{cheque.customer.partyName}</td>
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
                <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-500">No cheques match this report.</td></tr>
              )}
            </tbody>
          </table>

          <div className="space-y-3 p-3 lg:hidden">
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-500">Loading cheque report...</p>
            ) : data?.items.length ? (
              data.items.map((cheque) => (
                <article key={cheque.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <button type="button" onClick={() => setExpandedId((current) => current === cheque.id ? null : cheque.id)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{cheque.customer.partyName}</h3>
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

      <section className="mt-5 grid gap-4 md:grid-cols-3">
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
