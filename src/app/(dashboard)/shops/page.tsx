"use client";

import { useEffect, useState } from "react";

type Shop = {
  id: string;
  name: string;
  ownerName: string;
  gstNumber: string | null;
  mobileNumber: string | null;
  subscriptionStatus: string;
  createdAt: string;
};

export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    fetch("/api/shops")
      .then((res) => res.json())
      .then((data) => setShops(data.shops ?? []))
      .catch(() => setError("Could not load shops"));
  };

  useEffect(load, []);

  const createShop = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const res = await fetch("/api/shops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ownerName,
        mobileNumber: mobileNumber || undefined,
        gstNumber: gstNumber || undefined,
        address: address || undefined,
        subscriptionStatus: "ACTIVE",
      }),
    });
    if (!res.ok) {
      setError("Only Super Admin can create shops");
      return;
    }
    setName("");
    setOwnerName("");
    setMobileNumber("");
    setGstNumber("");
    setAddress("");
    load();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Shops</h1>
      <p className="text-slate-500">Create and monitor UdharBook business tenants.</p>

      <form onSubmit={createShop} className="card mt-6 grid gap-3 md:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} placeholder="Mobile number" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        <input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800 md:col-span-2" />
        {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white md:w-max">Create shop</button>
      </form>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shops.map((shop) => (
          <div key={shop.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{shop.name}</h2>
                <p className="text-sm text-slate-500">{shop.ownerName}</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {shop.subscriptionStatus}
              </span>
            </div>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Mobile</dt><dd>{shop.mobileNumber ?? "-"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">GST</dt><dd>{shop.gstNumber ?? "-"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Created</dt><dd>{new Date(shop.createdAt).toLocaleDateString("en-IN")}</dd></div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
