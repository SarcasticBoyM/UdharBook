"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Store } from "lucide-react";

type Shop = {
  id: string;
  shopName: string;
  ownerName: string;
  email: string | null;
  gstNumber: string | null;
  mobile: string | null;
  subscriptionStatus: string;
  createdAt: string;
};

type OnboardedAdmin = {
  email: string;
  temporaryPassword: string;
};

export default function OnboardShopPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [credentials, setCredentials] = useState<OnboardedAdmin | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [business, setBusiness] = useState({
    shopName: "",
    ownerName: "",
    mobile: "",
    email: "",
    gstNumber: "",
    address: "",
    adminName: "",
    adminEmail: "",
  });

  async function loadShops() {
    const shopsRes = await fetch("/api/shops");
    const shopsData = await shopsRes.json().catch(() => ({}));
    setShops(shopsData.shops ?? []);
  }

  useEffect(() => {
    loadShops().catch(() => setError("Could not load shops"));
  }, []);

  async function copyCredentials() {
    if (!credentials) return;
    await navigator.clipboard.writeText(`Admin Email: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const onboardBusiness = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setCredentials(null);
    setSaving(true);
    const res = await fetch("/api/onboarding/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...business,
        mobile: business.mobile || undefined,
        gstNumber: business.gstNumber || undefined,
        address: business.address || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not onboard shop");
      return;
    }
    setCredentials({ email: data.user.email, temporaryPassword: data.temporaryPassword });
    setBusiness({
      shopName: "",
      ownerName: "",
      mobile: "",
      email: "",
      gstNumber: "",
      address: "",
      adminName: "",
      adminEmail: "",
    });
    await loadShops();
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Onboard Shop</h1>
          <p className="text-slate-500">Create a new business shop and its first shop admin. Staff changes happen only in Staff Management.</p>
        </div>
        <div className="rounded-lg border bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="font-bold">{shops.length}</span> shops onboarded
        </div>
      </div>

      {credentials && (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="h-5 w-5" />
                Shop admin credentials generated
              </p>
              <p className="mt-2">Admin email: <strong>{credentials.email}</strong></p>
              <p>Temporary password: <strong>{credentials.temporaryPassword}</strong></p>
            </div>
            <button type="button" onClick={copyCredentials} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white">
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form onSubmit={onboardBusiness} className="mt-6 rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-brand-600" />
          <h2 className="font-bold">Create Shop</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input value={business.shopName} onChange={(e) => setBusiness({ ...business, shopName: e.target.value })} placeholder="Shop name" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          <input value={business.ownerName} onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })} placeholder="Owner name" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          <input type="email" value={business.email} onChange={(e) => setBusiness({ ...business, email: e.target.value })} placeholder="Business email" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          <input value={business.mobile} onChange={(e) => setBusiness({ ...business, mobile: e.target.value })} placeholder="Mobile" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <input value={business.gstNumber} onChange={(e) => setBusiness({ ...business, gstNumber: e.target.value })} placeholder="GST number" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <input value={business.address} onChange={(e) => setBusiness({ ...business, address: e.target.value })} placeholder="Address" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
        </div>
        <div className="mt-5 border-t pt-4 dark:border-slate-800">
          <h3 className="text-sm font-bold">Initial Shop Admin</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input value={business.adminName} onChange={(e) => setBusiness({ ...business, adminName: e.target.value })} placeholder="Admin name" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
            <input type="email" value={business.adminEmail} onChange={(e) => setBusiness({ ...business, adminEmail: e.target.value })} placeholder="Admin email" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          </div>
        </div>
        <button disabled={saving} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "Creating..." : "Create Shop and Admin"}
        </button>
      </form>

      <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-bold">Recently Onboarded Shops</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shops.map((shop) => (
            <article key={shop.id} className="rounded-lg border p-3 text-sm dark:border-slate-800">
              <p className="font-bold">{shop.shopName}</p>
              <p className="text-slate-500">{shop.ownerName} | {shop.subscriptionStatus}</p>
              <p className="text-xs text-slate-500">{shop.mobile ?? "-"} | {shop.email ?? "-"}</p>
            </article>
          ))}
          {shops.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">No shops onboarded yet.</p>}
        </div>
      </section>
    </div>
  );
}
