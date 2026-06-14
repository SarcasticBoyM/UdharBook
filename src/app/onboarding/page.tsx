"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Store,
  Upload,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import type { ImportSummary } from "@/types";
import { cn } from "@/lib/utils";
import { AppTimePicker } from "@/components/AppDateTimePicker";

type Status = {
  needsOnboarding: boolean;
  totalShops: number;
  activeShopId: string | null;
  activeShopName: string | null;
  staffCount: number;
  customerCount: number;
};

type StaffDraft = {
  name: string;
  email: string;
  mobile: string;
  roleLabel: "Recovery Staff" | "Field Executive" | "Accountant" | "Shop Admin";
  password: string;
};

type BusinessForm = {
  shopName: string;
  ownerName: string;
  email: string;
  mobile: string;
  address: string;
  city: string;
  gstNumber: string;
  businessType: string;
  logoUrl: string;
  adminName: string;
  adminEmail: string;
  adminMobile: string;
  adminPassword: string;
};

type WorkflowForm = {
  remindersEnabled: boolean;
  defaultFollowupTiming: string;
  chequeModuleEnabled: boolean;
  fieldStaffTrackingEnabled: boolean;
  highAmountThreshold: string;
};
type BooleanWorkflowKey = "remindersEnabled" | "chequeModuleEnabled" | "fieldStaffTrackingEnabled";

const steps = [
  { id: "welcome", label: "Welcome", icon: WalletCards },
  { id: "business", label: "Business", icon: Store },
  { id: "workflow", label: "Workflow", icon: ClipboardList },
  { id: "customers", label: "Customers", icon: FileSpreadsheet },
  { id: "staff", label: "Staff", icon: Users },
  { id: "complete", label: "Complete", icon: CheckCircle2 },
];

const defaultStaff: StaffDraft = {
  name: "",
  email: "",
  mobile: "",
  roleLabel: "Recovery Staff",
  password: "",
};

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [shopId, setShopId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [business, setBusiness] = useState<BusinessForm>({
    shopName: "",
    ownerName: "",
    email: "",
    mobile: "",
    address: "",
    city: "",
    gstNumber: "",
    businessType: "Retail credit",
    logoUrl: "",
    adminName: "",
    adminEmail: "",
    adminMobile: "",
    adminPassword: "",
  });
  const [workflow, setWorkflow] = useState<WorkflowForm>({
    remindersEnabled: true,
    defaultFollowupTiming: "10:00",
    chequeModuleEnabled: true,
    fieldStaffTrackingEnabled: true,
    highAmountThreshold: "50000",
  });
  const [staff, setStaff] = useState<StaffDraft>(defaultStaff);

  useEffect(() => {
    fetch("/api/onboarding/status")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load setup status");
        return res.json();
      })
      .then((data: Status) => {
        setStatus(data);
        if (data.activeShopId) {
          setShopId(data.activeShopId);
          setStep(data.needsOnboarding ? 2 : 5);
        }
      })
      .catch(() => setError("Setup status could not be loaded. Please refresh and try again."))
      .finally(() => setLoading(false));
  }, []);

  const completion = useMemo(() => {
    const done = [
      Boolean(shopId),
      Boolean(shopId),
      true,
      Boolean((status?.customerCount ?? 0) > 0 || importSummary),
      Boolean((status?.staffCount ?? 0) > 1 || staffPassword),
      step >= 5,
    ].filter(Boolean).length;
    return Math.round((done / steps.length) * 100);
  }, [importSummary, shopId, staffPassword, status?.customerCount, status?.staffCount, step]);

  const next = () => setStep((current) => Math.min(steps.length - 1, current + 1));
  const back = () => setStep((current) => Math.max(0, current - 1));

  const createBusiness = async () => {
    setSaving(true);
    setError("");
    setAdminPassword("");
    try {
      const res = await fetch("/api/onboarding/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...business,
          onboardingMode: true,
          preferences: {
            ...workflow,
            highAmountThreshold: Number(workflow.highAmountThreshold) || 50000,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create business");
      setShopId(data.shop.id);
      setStatus((current) => ({
        needsOnboarding: true,
        totalShops: Math.max(1, current?.totalShops ?? 0),
        activeShopId: data.shop.id,
        activeShopName: data.shop.shopName,
        staffCount: 1,
        customerCount: current?.customerCount ?? 0,
      }));
      setAdminPassword(data.temporaryPassword);
      next();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create business");
    } finally {
      setSaving(false);
    }
  };

  const importCustomers = async (file: File | null) => {
    if (!file || !shopId) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/customers/import", {
        method: "POST",
        body: form,
        headers: { "x-shop-id": shopId },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setImportSummary(data);
      setStatus((current) => current ? { ...current, customerCount: data.created + data.updated } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Customer import failed");
    } finally {
      setSaving(false);
    }
  };

  const inviteStaff = async () => {
    if (!shopId || !staff.name || !staff.email) return;
    setSaving(true);
    setError("");
    setStaffPassword("");
    try {
      const role =
        staff.roleLabel === "Shop Admin"
          ? "SHOP_ADMIN"
          : staff.roleLabel === "Field Executive"
            ? "SALES_PERSON"
            : "ACCOUNT_STAFF";
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: staff.name,
          email: staff.email,
          mobile: staff.mobile || undefined,
          role,
          jobTitle: staff.roleLabel,
          password: staff.password || undefined,
          shopId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not invite staff");
      setStaffPassword(data.temporaryPassword);
      setStatus((current) => current ? { ...current, staffCount: current.staffCount + 1 } : current);
      setStaff(defaultStaff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not invite staff");
    } finally {
      setSaving(false);
    }
  };

  const completeSetup = async () => {
    if (!shopId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not complete setup");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete setup");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-600 text-white">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">UdharBook Setup</h1>
              <p className="text-sm text-slate-500">Create your recovery workspace</p>
            </div>
          </div>
          {shopId && (
            <Link href="/" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">
              Go to dashboard
            </Link>
          )}
        </header>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Setup progress</p>
              <p className="text-xs text-slate-500">{completion}% complete</p>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 sm:w-72">
              <div className="h-2 rounded-full bg-brand-600" style={{ width: `${completion}%` }} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-6">
            {steps.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(index)}
                  className={cn(
                    "min-h-16 rounded-lg border px-2 text-center text-xs font-semibold",
                    step === index
                      ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-100"
                      : index < step
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                  )}
                >
                  <Icon className="mx-auto mb-1 h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        <section className="mt-5 flex-1 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
          {step === 0 && (
            <WelcomeStep noShops={(status?.totalShops ?? 0) === 0} onNext={next} />
          )}

          {step === 1 && (
            <BusinessStep
              business={business}
              setBusiness={setBusiness}
              saving={saving}
              adminPassword={adminPassword}
              onSave={createBusiness}
            />
          )}

          {step === 2 && (
            <WorkflowStep workflow={workflow} setWorkflow={setWorkflow} onNext={next} />
          )}

          {step === 3 && (
            <CustomersStep
              saving={saving}
              shopId={shopId}
              summary={importSummary}
              customerCount={status?.customerCount ?? 0}
              onImport={importCustomers}
              onSkip={next}
            />
          )}

          {step === 4 && (
            <StaffStep
              staff={staff}
              setStaff={setStaff}
              saving={saving}
              password={staffPassword}
              staffCount={status?.staffCount ?? 0}
              onInvite={inviteStaff}
              onSkip={next}
            />
          )}

          {step === 5 && (
            <CompleteStep
              shopName={status?.activeShopName ?? business.shopName}
              totalShops={status?.totalShops ?? 0}
              staffCount={status?.staffCount ?? 0}
              customerCount={status?.customerCount ?? 0}
              saving={saving}
              onComplete={completeSetup}
            />
          )}
        </section>

        <footer className="flex items-center justify-between py-4">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold disabled:opacity-40 dark:border-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          {step > 1 && step < 5 && (
            <button
              type="button"
              onClick={next}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-white dark:text-slate-950"
            >
              Save and continue
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}

function WelcomeStep({ noShops, onNext }: { noShops: boolean; onNext: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
      <div>
        <p className="text-sm font-semibold uppercase text-brand-600">First-time setup</p>
        <h2 className="mt-2 text-3xl font-bold">{noShops ? "Create your first shop" : "Finish your setup"}</h2>
        <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">
          UdharBook helps teams track credit customers, schedule recovery follow-ups, collect cheques, monitor field visits, and keep every recovery interaction in one timeline.
        </p>
        <button type="button" onClick={onNext} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white">
          Start setup
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3">
        {[
          "Create business workspace",
          "Invite recovery team",
          "Import customer balances",
          "Configure reminders and follow-ups",
        ].map((item) => (
          <div key={item} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="font-medium">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BusinessStep({
  business,
  setBusiness,
  saving,
  adminPassword,
  onSave,
}: {
  business: BusinessForm;
  setBusiness: (value: BusinessForm) => void;
  saving: boolean;
  adminPassword: string;
  onSave: () => void;
}) {
  const update = (key: string, value: string) => setBusiness({ ...business, [key]: value });
  return (
    <div>
      <h2 className="text-2xl font-bold">Business profile and shop admin</h2>
      <p className="mt-1 text-sm text-slate-500">This creates the first business shop and the account that will operate it.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Field label="Business/shop name" value={business.shopName} onChange={(value) => update("shopName", value)} required />
        <Field label="Owner name" value={business.ownerName} onChange={(value) => update("ownerName", value)} required />
        <Field label="Business email" type="email" value={business.email} onChange={(value) => update("email", value)} required />
        <Field label="Mobile number" value={business.mobile} onChange={(value) => update("mobile", value)} />
        <Field label="City" value={business.city} onChange={(value) => update("city", value)} />
        <Field label="GST number" value={business.gstNumber} onChange={(value) => update("gstNumber", value)} />
        <Field label="Business type" value={business.businessType} onChange={(value) => update("businessType", value)} />
        <Field label="Logo URL optional" value={business.logoUrl} onChange={(value) => update("logoUrl", value)} />
        <label className="md:col-span-2">
          <span className="text-sm font-semibold">Address</span>
          <textarea value={business.address} onChange={(event) => update("address", event.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        </label>
      </div>
      <div className="mt-6 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h3 className="font-semibold">Create Shop Admin</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Name" value={business.adminName} onChange={(value) => update("adminName", value)} required />
          <Field label="Email" type="email" value={business.adminEmail} onChange={(value) => update("adminEmail", value)} required />
          <Field label="Mobile" value={business.adminMobile} onChange={(value) => update("adminMobile", value)} />
          <Field label="Password" type="password" value={business.adminPassword} onChange={(value) => update("adminPassword", value)} placeholder="Leave blank to generate" />
        </div>
        {adminPassword && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Admin password: <strong>{adminPassword}</strong>
          </div>
        )}
      </div>
      <button type="button" onClick={onSave} disabled={saving || !business.shopName || !business.ownerName || !business.email || !business.adminName || !business.adminEmail} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
        Create first shop
      </button>
    </div>
  );
}

function WorkflowStep({
  workflow,
  setWorkflow,
  onNext,
}: {
  workflow: WorkflowForm;
  setWorkflow: (value: WorkflowForm) => void;
  onNext: () => void;
}) {
  const toggle = (key: BooleanWorkflowKey) => setWorkflow({ ...workflow, [key]: !workflow[key] });
  return (
    <div>
      <h2 className="text-2xl font-bold">Recovery workflow preferences</h2>
      <p className="mt-1 text-sm text-slate-500">These defaults help your team start with sensible recovery settings.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {([
          ["remindersEnabled", "Enable reminders"],
          ["chequeModuleEnabled", "Enable cheque module"],
          ["fieldStaffTrackingEnabled", "Enable field staff tracking"],
        ] as [BooleanWorkflowKey, string][]).map(([key, label]) => (
          <button key={key} type="button" onClick={() => toggle(key)} className={cn("flex min-h-14 items-center justify-between rounded-lg border px-4 text-left text-sm font-semibold", workflow[key] ? "border-brand-200 bg-brand-50 text-brand-800" : "border-slate-200 dark:border-slate-800")}>
            {label}
            <span>{workflow[key] ? "On" : "Off"}</span>
          </button>
        ))}
        <Field label="Default follow-up time" type="time" value={String(workflow.defaultFollowupTiming)} onChange={(value) => setWorkflow({ ...workflow, defaultFollowupTiming: value })} />
        <Field label="High amount threshold" type="number" value={String(workflow.highAmountThreshold)} onChange={(value) => setWorkflow({ ...workflow, highAmountThreshold: value })} />
      </div>
      <button type="button" onClick={onNext} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white">
        Save workflow
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function CustomersStep({
  saving,
  shopId,
  summary,
  customerCount,
  onImport,
  onSkip,
}: {
  saving: boolean;
  shopId: string;
  summary: ImportSummary | null;
  customerCount: number;
  onImport: (file: File | null) => void;
  onSkip: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div>
      <h2 className="text-2xl font-bold">Import customer data</h2>
      <p className="mt-1 text-sm text-slate-500">Upload an Excel file with customer name, mobile number, and outstanding balance.</p>
      <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-5 dark:border-slate-700">
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="w-full text-sm" />
        <button type="button" onClick={() => onImport(file)} disabled={!file || !shopId || saving} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload Excel
        </button>
      </div>
      {summary && (
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <MiniStat label="Created" value={summary.created} />
          <MiniStat label="Updated" value={summary.updated} />
          <MiniStat label="Skipped" value={summary.skipped} />
          <MiniStat label="Total customers" value={customerCount} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/customers/new" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Manual add customer</Link>
        <button type="button" onClick={onSkip} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Skip for now</button>
      </div>
    </div>
  );
}

function StaffStep({
  staff,
  setStaff,
  saving,
  password,
  staffCount,
  onInvite,
  onSkip,
}: {
  staff: StaffDraft;
  setStaff: (value: StaffDraft) => void;
  saving: boolean;
  password: string;
  staffCount: number;
  onInvite: () => void;
  onSkip: () => void;
}) {
  const update = (key: keyof StaffDraft, value: string) => setStaff({ ...staff, [key]: value });
  return (
    <div>
      <h2 className="text-2xl font-bold">Invite staff</h2>
      <p className="mt-1 text-sm text-slate-500">Add recovery staff, field executives, accountants, or another shop admin.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Field label="Name" value={staff.name} onChange={(value) => update("name", value)} />
        <Field label="Email" type="email" value={staff.email} onChange={(value) => update("email", value)} />
        <Field label="Mobile" value={staff.mobile} onChange={(value) => update("mobile", value)} />
        <label>
          <span className="text-sm font-semibold">Role</span>
          <select value={staff.roleLabel} onChange={(event) => update("roleLabel", event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            <option>Recovery Staff</option>
            <option>Field Executive</option>
            <option>Accountant</option>
            <option>Shop Admin</option>
          </select>
        </label>
        <Field label="Password" type="password" value={staff.password} onChange={(value) => update("password", value)} placeholder="Leave blank to generate" />
      </div>
      {password && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Invite password: <strong>{password}</strong></div>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onInvite} disabled={saving || !staff.name || !staff.email} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Add staff
        </button>
        <button type="button" onClick={onSkip} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Send invite later</button>
      </div>
      <p className="mt-3 text-sm text-slate-500">{staffCount} user account(s) in this shop.</p>
    </div>
  );
}

function CompleteStep({
  shopName,
  totalShops,
  staffCount,
  customerCount,
  saving,
  onComplete,
}: {
  shopName: string;
  totalShops: number;
  staffCount: number;
  customerCount: number;
  saving: boolean;
  onComplete: () => void;
}) {
  return (
    <div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <ShieldCheck className="h-8 w-8" />
        <h2 className="mt-3 text-2xl font-bold">Setup complete</h2>
        <p className="mt-1 text-sm">Your recovery workspace is ready for {shopName || "your business"}.</p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Businesses" value={totalShops || 1} />
        <MiniStat label="Staff accounts" value={staffCount} />
        <MiniStat label="Customers" value={customerCount} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onComplete} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Go to Dashboard
        </button>
        <Link href="/upload" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Upload Customers</Link>
        <Link href="/today-follow-ups" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Start Recovery</Link>
        <Link href="/customers/new" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Add First Follow-up</Link>
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
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  if (type === "time") {
    return <AppTimePicker label={label} value={value} onChange={onChange} required={required} />;
  }
  return (
    <label>
      <span className="text-sm font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
