"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Camera,
  CheckCircle2,
  History,
  Landmark,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ChequeStatus } from "@prisma/client";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type CustomerOption = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
};

type UserOption = {
  id: string;
  name: string;
  role: string;
};

type ChequeActivity = {
  id: string;
  type: string;
  fromStatus: ChequeStatus | null;
  toStatus: ChequeStatus | null;
  notes: string | null;
  createdAt: string;
  user: { name: string; role: string };
};

type ChequeItem = {
  id: string;
  chequeNumber: string;
  bankName: string;
  branch: string | null;
  chequeDate: string;
  amount: number;
  accountHolderName: string;
  micrCode: string | null;
  ifscCode: string | null;
  ocrConfidence: number | null;
  ocrExtractedData: Record<string, unknown> | null;
  ocrEditedFields: Record<string, boolean> | null;
  status: ChequeStatus;
  collectionDateTime: string;
  collectionNotes: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  depositDateTime: string | null;
  depositBankAccount: string | null;
  depositSlipUrl: string | null;
  bounceReason: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  customer: CustomerOption;
  collectedBy: UserOption;
  depositedBy: UserOption | null;
  activities: ChequeActivity[];
};

type ChequeResponse = {
  items: ChequeItem[];
  users: UserOption[];
  alerts: {
    pendingDeposit: number;
    bounced: number;
    highValue: number;
    stale: number;
    chequeDateTomorrow: number;
  };
  summary: {
    collectedToday: number;
    pendingDeposit: number;
    depositedToday: number;
    clearedToday: number;
    bounced: number;
    highValue: number;
  };
  pagination: { page: number; limit: number; total: number; pages: number };
};

type ChequeForm = {
  customerId: string;
  customerSearch: string;
  chequeNumber: string;
  bankName: string;
  branch: string;
  chequeDate: string;
  amount: string;
  accountHolderName: string;
  micrCode: string;
  ifscCode: string;
  collectionDate: string;
  collectionTime: string;
  collectionNotes: string;
  frontImageUrl: string;
};

type OcrFields = {
  chequeNumber?: string;
  bankName?: string;
  chequeDate?: string;
  accountHolderName?: string;
  amount?: number;
  micrCode?: string;
  ifscCode?: string;
  branch?: string;
};

type ScanResult = {
  ok: boolean;
  provider: string;
  fields: OcrFields;
  rawText: string;
  confidence: number;
  fieldConfidence: Record<keyof OcrFields, number>;
  warning?: string;
};

const tabs: { label: string; value: ChequeStatus | "ALL" }[] = [
  { label: "Collected", value: "COLLECTED" },
  { label: "Pending Deposit", value: "PENDING_DEPOSIT" },
  { label: "Deposited", value: "DEPOSITED" },
  { label: "Cleared", value: "CLEARED" },
  { label: "Bounced", value: "BOUNCED" },
  { label: "Cancelled", value: "CANCELLED" },
];

const quickFilters = [
  { label: "Today", value: "today" },
  { label: "Pending Deposit", value: "pending" },
  { label: "Bounced", value: "bounced" },
  { label: "High Amount", value: "high" },
  { label: "Cleared", value: "cleared" },
  { label: "Overdue Deposit", value: "overdue" },
];

const statusTone: Record<ChequeStatus, string> = {
  COLLECTED: "bg-blue-50 text-blue-700 ring-blue-200",
  PENDING_DEPOSIT: "bg-amber-50 text-amber-700 ring-amber-200",
  DEPOSITED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  CLEARED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  BOUNCED: "bg-red-50 text-red-700 ring-red-200",
  REPLACED: "bg-violet-50 text-violet-700 ring-violet-200",
  CANCELLED: "bg-slate-100 text-slate-700 ring-slate-200",
};

function todayParts() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
  };
}

const emptyForm = (): ChequeForm => {
  const parts = todayParts();
  return {
    customerId: "",
    customerSearch: "",
    chequeNumber: "",
    bankName: "",
    branch: "",
    chequeDate: parts.date,
    amount: "",
    accountHolderName: "",
    micrCode: "",
    ifscCode: "",
    collectionDate: parts.date,
    collectionTime: parts.time,
    collectionNotes: "",
    frontImageUrl: "",
  };
};

function toDateTime(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}`).toISOString();
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareChequeImage(file: File) {
  const original = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = original;
  });
  const maxWidth = 1400;
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.filter = "contrast(1.18) brightness(1.08) saturate(0.9)";
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

function confidenceTone(value?: number) {
  if (!value) return "";
  if (value >= 0.75) return "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20";
  return "border-amber-300 bg-amber-50 dark:bg-amber-950/20";
}

function alertText(alerts: ChequeResponse["alerts"]) {
  const parts = [];
  if (alerts.bounced) parts.push(`${alerts.bounced} bounced`);
  if (alerts.stale) parts.push(`${alerts.stale} pending deposit over 1 day`);
  if (alerts.chequeDateTomorrow) parts.push(`${alerts.chequeDateTomorrow} cheque dates tomorrow`);
  return parts.join(", ");
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof Landmark;
  tone: string;
}) {
  return (
    <div className={cn("rounded-lg border p-4 shadow-sm", tone)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium">{label}</p>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function ChequeCollectionsPage() {
  const [activeStatus, setActiveStatus] = useState<ChequeStatus | "ALL">("PENDING_DEPOSIT");
  const [quick, setQuick] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ChequeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ChequeForm>(emptyForm);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedCheque, setSelectedCheque] = useState<ChequeItem | null>(null);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const touchStart = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const params = useMemo(() => {
    const search = new URLSearchParams();
    if (activeStatus !== "ALL" && !quick) search.set("status", activeStatus);
    if (quick) search.set("quick", quick);
    if (debouncedQuery) search.set("q", debouncedQuery);
    if (staffId) search.set("staffId", staffId);
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    search.set("limit", "40");
    return search;
  }, [activeStatus, debouncedQuery, from, quick, staffId, to]);

  const loadCheques = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/cheques?${params.toString()}`);
    if (res.ok) {
      const payload = (await res.json()) as ChequeResponse;
      setData(payload);
      setSelectedCheque((current) =>
        current ? payload.items.find((item) => item.id === current.id) ?? current : null
      );
    }
    setLoading(false);
  }, [params]);

  useEffect(() => {
    loadCheques();
  }, [loadCheques]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const search = form.customerSearch.trim();
      if (search.length < 2) {
        setCustomers([]);
        return;
      }
      const res = await fetch(`/api/customers?search=${encodeURIComponent(search)}&limit=20`, {
        signal: controller.signal,
      }).catch(() => null);
      if (res?.ok) {
        const payload = await res.json();
        setCustomers(payload.items ?? []);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [form.customerSearch]);

  useEffect(() => {
    if (!notificationEnabled || !data?.alerts) return;
    const text = alertText(data.alerts);
    if (!text || !("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("Cheque alerts", { body: text });
  }, [data?.alerts, notificationEnabled]);

  const summary = data?.summary;
  const alerts = data?.alerts;
  const totalValue = useMemo(
    () => data?.items.reduce((sum, cheque) => sum + cheque.amount, 0) ?? 0,
    [data?.items]
  );

  const updateStatus = async (cheque: ChequeItem, status: ChequeStatus) => {
    const body: Record<string, string> = { status };
    if (status === "DEPOSITED") {
      const account = window.prompt("Deposit bank account used?", cheque.depositBankAccount ?? "");
      if (account === null) return;
      body.depositBankAccount = account;
      body.depositDateTime = new Date().toISOString();
    }
    if (status === "BOUNCED") {
      const reason = window.prompt("Bounce reason or remark?", cheque.bounceReason ?? "");
      if (reason === null) return;
      body.bounceReason = reason;
      body.notes = reason;
    }

    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.id === cheque.id ? { ...item, status } : item)),
          }
        : current
    );

    const res = await fetch(`/api/cheques/${cheque.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) loadCheques();
  };

  const submitCheque = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const editedFields = scanResult
      ? {
          chequeNumber: Boolean(scanResult.fields.chequeNumber && form.chequeNumber !== scanResult.fields.chequeNumber),
          bankName: Boolean(scanResult.fields.bankName && form.bankName !== scanResult.fields.bankName),
          chequeDate: Boolean(scanResult.fields.chequeDate && form.chequeDate !== scanResult.fields.chequeDate),
          accountHolderName: Boolean(scanResult.fields.accountHolderName && form.accountHolderName !== scanResult.fields.accountHolderName),
          amount: Boolean(scanResult.fields.amount && Number(form.amount) !== scanResult.fields.amount),
          micrCode: Boolean(scanResult.fields.micrCode && form.micrCode !== scanResult.fields.micrCode),
          ifscCode: Boolean(scanResult.fields.ifscCode && form.ifscCode !== scanResult.fields.ifscCode),
          branch: Boolean(scanResult.fields.branch && form.branch !== scanResult.fields.branch),
        }
      : undefined;
    const res = await fetch("/api/cheques", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: form.customerId,
        chequeNumber: form.chequeNumber,
        bankName: form.bankName,
        branch: form.branch || undefined,
        chequeDate: toDateTime(form.chequeDate, "00:00"),
        amount: Number(form.amount),
        accountHolderName: form.accountHolderName,
        collectionDateTime: toDateTime(form.collectionDate, form.collectionTime),
        collectionNotes: form.collectionNotes || undefined,
        frontImageUrl: form.frontImageUrl || undefined,
        micrCode: form.micrCode || undefined,
        ifscCode: form.ifscCode || undefined,
        ocrRawText: scanResult?.rawText || undefined,
        ocrExtractedData: scanResult?.fields,
        ocrConfidence: scanResult?.confidence,
        ocrEditedFields: editedFields,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setForm(emptyForm());
      setScanResult(null);
      setCustomers([]);
      setFormOpen(false);
      setActiveStatus("PENDING_DEPOSIT");
      setQuick("");
      loadCheques();
    } else {
      const error = await res.json().catch(() => ({}));
      window.alert(error.error ?? "Could not save cheque");
    }
  };

  const enableAlerts = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationEnabled(permission === "granted");
  };

  const exportReport = (format: "xlsx" | "csv" | "pdf") => {
    const exportParams = new URLSearchParams(params);
    exportParams.set("format", format);
    window.open(`/api/cheques?${exportParams.toString()}`, "_blank");
  };

  const scanChequeFile = async (file: File) => {
    setScanning(true);
    setScanResult(null);
    try {
      const imageDataUrl = await prepareChequeImage(file);
      setForm((current) => ({ ...current, frontImageUrl: imageDataUrl }));
      const res = await fetch("/api/cheques/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const result = (await res.json()) as ScanResult;
      setScanResult(result);
      if (result.fields) {
        setForm((current) => ({
          ...current,
          chequeNumber: result.fields.chequeNumber ?? current.chequeNumber,
          bankName: result.fields.bankName ?? current.bankName,
          branch: result.fields.branch ?? current.branch,
          chequeDate: result.fields.chequeDate ?? current.chequeDate,
          amount: result.fields.amount ? String(result.fields.amount) : current.amount,
          accountHolderName: result.fields.accountHolderName ?? current.accountHolderName,
          micrCode: result.fields.micrCode ?? current.micrCode,
          ifscCode: result.fields.ifscCode ?? current.ifscCode,
        }));
      }
    } catch {
      setScanResult({
        ok: false,
        provider: "manual",
        fields: {},
        rawText: "",
        confidence: 0,
        fieldConfidence: {
          chequeNumber: 0,
          bankName: 0,
          chequeDate: 0,
          accountHolderName: 0,
          amount: 0,
          micrCode: 0,
          ifscCode: 0,
          branch: 0,
        },
        warning: "Could not detect all cheque details. Please enter manually.",
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Cheque recovery desk</p>
          <h1 className="mt-1 text-3xl font-bold">Cheque Collections</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Track each cheque from field collection to deposit, clearance, bounce recovery, and reports.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={enableAlerts}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium dark:border-slate-700"
          >
            <AlertTriangle className="h-4 w-4" />
            Alerts
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
          >
            <Plus className="h-4 w-4" />
            Add Cheque
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Collected Today" value={summary?.collectedToday ?? 0} icon={Banknote} tone="border-blue-200 bg-blue-50 text-blue-800" />
        <StatCard label="Pending Deposit" value={summary?.pendingDeposit ?? 0} icon={CalendarClock} tone="border-amber-200 bg-amber-50 text-amber-800" />
        <StatCard label="Deposited Today" value={summary?.depositedToday ?? 0} icon={Landmark} tone="border-indigo-200 bg-indigo-50 text-indigo-800" />
        <StatCard label="Cleared Today" value={summary?.clearedToday ?? 0} icon={CheckCircle2} tone="border-emerald-200 bg-emerald-50 text-emerald-800" />
        <StatCard label="Bounce Alerts" value={summary?.bounced ?? 0} icon={ShieldAlert} tone="border-red-200 bg-red-50 text-red-800" />
        <StatCard label="High Value" value={summary?.highValue ?? 0} icon={AlertTriangle} tone="border-purple-200 bg-purple-50 text-purple-800" />
      </div>

      {alerts && (alerts.stale > 0 || alerts.chequeDateTomorrow > 0 || alerts.bounced > 0) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Attention:</strong> {alertText(alerts)}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0">
          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setActiveStatus(tab.value);
                    setQuick("");
                  }}
                  className={cn(
                    "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium",
                    activeStatus === tab.value && !quick
                      ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950"
                      : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_160px_140px_140px]">
              <label className="relative block">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search cheque number, customer, bank, amount"
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">All staff</option>
                {data?.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {quickFilters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setQuick((current) => (current === filter.value ? "" : filter.value))}
                  className={cn(
                    "min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium",
                    quick === filter.value
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Showing {data?.items.length ?? 0} cheques, total value {formatCurrency(totalValue)}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => exportReport("xlsx")} className="rounded-lg border px-3 py-2 text-sm">
                Excel
              </button>
              <button type="button" onClick={() => exportReport("csv")} className="rounded-lg border px-3 py-2 text-sm">
                CSV
              </button>
              <button type="button" onClick={() => exportReport("pdf")} className="rounded-lg border px-3 py-2 text-sm">
                PDF
              </button>
            </div>
          </div>

          {loading ? (
            <div className="mt-6 flex min-h-48 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading cheques
            </div>
          ) : data?.items.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
              No cheques match this view.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {data?.items.map((cheque) => (
                <article
                  key={cheque.id}
                  onClick={() => setSelectedCheque(cheque)}
                  onTouchStart={(event) => {
                    touchStart.current[cheque.id] = event.touches[0].clientX;
                  }}
                  onTouchEnd={(event) => {
                    const start = touchStart.current[cheque.id];
                    const delta = event.changedTouches[0].clientX - start;
                    if (delta > 80) updateStatus(cheque, "DEPOSITED");
                    if (delta < -80) updateStatus(cheque, "BOUNCED");
                  }}
                  className={cn(
                    "cursor-pointer rounded-lg border bg-white p-4 shadow-sm transition hover:border-brand-300 dark:bg-slate-900",
                    cheque.status === "BOUNCED"
                      ? "border-red-200"
                      : cheque.status === "CLEARED"
                        ? "border-emerald-200"
                        : "border-slate-200 dark:border-slate-700"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold">{cheque.customer.partyName}</h2>
                        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold ring-1", statusTone[cheque.status])}>
                          {formatStatus(cheque.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {cheque.customer.contactNumber} | Cheque {cheque.chequeNumber} | {cheque.bankName}
                      </p>
                    </div>
                    <p className="text-right text-xl font-bold">{formatCurrency(cheque.amount)}</p>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Cheque Date</p>
                      <p className="font-medium">{formatDate(cheque.chequeDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Collected</p>
                      <p className="font-medium">{formatDate(cheque.collectionDateTime)} by {cheque.collectedBy.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Deposit</p>
                      <p className="font-medium">{formatDate(cheque.depositDateTime)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Balance</p>
                      <p className="font-medium">{formatCurrency(cheque.customer.outstandingBalance)}</p>
                    </div>
                  </div>

                  {cheque.collectionNotes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{cheque.collectionNotes}</p>}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); updateStatus(cheque, "DEPOSITED"); }} className="min-h-10 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white">
                      Mark Deposited
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); updateStatus(cheque, "CLEARED"); }} className="min-h-10 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white">
                      Cleared
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); updateStatus(cheque, "BOUNCED"); }} className="min-h-10 rounded-lg bg-red-600 px-3 text-sm font-medium text-white">
                      Bounced
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === cheque.id ? null : cheque.id); }} className="min-h-10 rounded-lg border px-3 text-sm">
                      Timeline
                    </button>
                  </div>

                  {expandedId === cheque.id && (
                    <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <Timeline activities={cheque.activities} />
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            {selectedCheque ? (
              <>
                <p className="text-xs font-semibold uppercase text-slate-500">Selected cheque</p>
                <h2 className="mt-2 text-lg font-bold">{selectedCheque.customer.partyName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedCheque.chequeNumber} | {selectedCheque.bankName}
                </p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Amount</dt>
                    <dd className="font-bold">{formatCurrency(selectedCheque.amount)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Status</dt>
                    <dd>{formatStatus(selectedCheque.status)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Account holder</dt>
                    <dd className="text-right">{selectedCheque.accountHolderName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Deposit account</dt>
                    <dd className="text-right">{selectedCheque.depositBankAccount || "-"}</dd>
                  </div>
                </dl>
                <div className="mt-5">
                  <Timeline activities={selectedCheque.activities} />
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a cheque to see full activity timeline and deposit details.</p>
            )}
          </div>
        </aside>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-0 sm:items-center sm:p-6">
          <form onSubmit={submitCheque} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:mx-auto sm:max-w-3xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Collect New Cheque</h2>
                <p className="mt-1 text-sm text-slate-500">Scan the cheque, verify editable details, then save.</p>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border p-2">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-brand-600" />
                    AI cheque scan
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Camera and gallery both supported. Detected values stay editable.</p>
                </div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white">
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                  {scanning ? "Scanning..." : "Scan Cheque"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      await scanChequeFile(file);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>

              {form.frontImageUrl && (
                <Image
                  src={form.frontImageUrl}
                  alt="Uploaded cheque preview"
                  width={1200}
                  height={520}
                  unoptimized
                  className="mt-4 max-h-52 w-full rounded-lg object-contain ring-1 ring-slate-200 dark:ring-slate-700"
                />
              )}

              {scanResult && (
                <div
                  className={cn(
                    "mt-4 rounded-lg border p-3 text-sm",
                    scanResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
                  )}
                >
                  <p className="font-semibold">
                    {scanResult.ok ? "Detected Automatically" : "Could not detect all cheque details"}
                  </p>
                  <p className="mt-1">
                    Confidence: {Math.round((scanResult.confidence ?? 0) * 100)}%
                    {scanResult.provider ? ` | ${scanResult.provider}` : ""}
                  </p>
                  {scanResult.warning && <p className="mt-1">{scanResult.warning}</p>}
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="text-sm font-medium">Customer</span>
                <input
                  value={form.customerSearch}
                  onChange={(e) => setForm((current) => ({ ...current, customerSearch: e.target.value, customerId: "" }))}
                  placeholder="Search customer by name or mobile"
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  required={!form.customerId}
                />
                {customers.length > 0 && !form.customerId && (
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    {customers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            customerId: customer.id,
                            customerSearch: `${customer.partyName} - ${customer.contactNumber}`,
                          }))
                        }
                        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 dark:border-slate-800"
                      >
                        <span>{customer.partyName}</span>
                        <span className="text-slate-500">{formatCurrency(customer.outstandingBalance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </label>
              <Input label="Cheque number" value={form.chequeNumber} confidence={scanResult?.fieldConfidence.chequeNumber} onChange={(value) => setForm((current) => ({ ...current, chequeNumber: value }))} required />
              <Input label="Bank name" value={form.bankName} confidence={scanResult?.fieldConfidence.bankName} onChange={(value) => setForm((current) => ({ ...current, bankName: value }))} required />
              <Input label="Branch" value={form.branch} confidence={scanResult?.fieldConfidence.branch} onChange={(value) => setForm((current) => ({ ...current, branch: value }))} />
              <Input label="Cheque date" type="date" value={form.chequeDate} confidence={scanResult?.fieldConfidence.chequeDate} onChange={(value) => setForm((current) => ({ ...current, chequeDate: value }))} required />
              <Input label="Amount" type="number" value={form.amount} confidence={scanResult?.fieldConfidence.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} required />
              <Input label="Account holder name" value={form.accountHolderName} confidence={scanResult?.fieldConfidence.accountHolderName} onChange={(value) => setForm((current) => ({ ...current, accountHolderName: value }))} required />
              <Input label="MICR code" value={form.micrCode} confidence={scanResult?.fieldConfidence.micrCode} onChange={(value) => setForm((current) => ({ ...current, micrCode: value }))} />
              <Input label="IFSC code" value={form.ifscCode} confidence={scanResult?.fieldConfidence.ifscCode} onChange={(value) => setForm((current) => ({ ...current, ifscCode: value.toUpperCase() }))} />
              <Input label="Collection date" type="date" value={form.collectionDate} onChange={(value) => setForm((current) => ({ ...current, collectionDate: value }))} required />
              <Input label="Collection time" type="time" value={form.collectionTime} onChange={(value) => setForm((current) => ({ ...current, collectionTime: value }))} required />
              <label className="md:col-span-2">
                <span className="text-sm font-medium">Collection notes</span>
                <textarea
                  value={form.collectionNotes}
                  onChange={(e) => setForm((current) => ({ ...current, collectionNotes: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>

            <div className="sticky bottom-0 -mx-5 mt-6 flex gap-3 border-t border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <button type="button" onClick={() => setFormOpen(false)} className="min-h-12 flex-1 rounded-lg border border-slate-300 text-sm font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.customerId} className="min-h-12 flex-1 rounded-lg bg-slate-950 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-slate-950">
                {saving ? "Saving..." : "Save Cheque"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 lg:hidden">
        <button onClick={() => setFormOpen(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
          <Plus className="h-4 w-4" />
          Collect Cheque
        </button>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  confidence,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  confidence?: number;
}) {
  return (
    <label>
      <span className="flex items-center justify-between gap-2 text-sm font-medium">
        {label}
        {confidence ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", confidence >= 0.75 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
            {confidence >= 0.75 ? "Detected" : "Verify"}
          </span>
        ) : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={cn(
          "mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700 dark:bg-slate-950",
          confidenceTone(confidence)
        )}
      />
    </label>
  );
}

function Timeline({ activities }: { activities: ChequeActivity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-slate-500">No activity logged yet.</p>;
  }
  return (
    <ul className="space-y-3 text-sm">
      {activities.map((activity) => (
        <li key={activity.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4 text-slate-400" />
            <p className="font-medium">
              {formatStatus(activity.type)}
              {activity.toStatus ? `: ${formatStatus(activity.toStatus)}` : ""}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatDate(activity.createdAt)} by {activity.user.name} ({formatStatus(activity.user.role)})
          </p>
          {activity.notes && <p className="mt-1 text-slate-600 dark:text-slate-300">{activity.notes}</p>}
        </li>
      ))}
    </ul>
  );
}
