"use client";

import { useCallback, useEffect, useState } from "react";

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

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
  shopId: string;
  shop: { shopName: string } | null;
};

export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [error, setError] = useState("");

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

  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "STAFF",
  });

  const load = useCallback(async () => {
    const shopsRes = await fetch("/api/shops");
    const shopsData = await shopsRes.json();
    const loadedShops = shopsData.shops ?? [];
    setShops(loadedShops);
    const shopId = selectedShopId || loadedShops[0]?.id || "";
    if (shopId) setSelectedShopId(shopId);

    const usersRes = await fetch(shopId ? `/api/users?shopId=${shopId}` : "/api/users");
    const usersData = await usersRes.json();
    setUsers(usersData.users ?? []);
  }, [selectedShopId]);

  useEffect(() => {
    load().catch(() => setError("Could not load admin data"));
  }, [load]);

  const onboardBusiness = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setTemporaryPassword("");
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
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create business");
      return;
    }
    setTemporaryPassword(data.temporaryPassword);
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
    setSelectedShopId(data.shop.id);
    await load();
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setTemporaryPassword("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newUser, shopId: selectedShopId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Could not create user");
      return;
    }
    setTemporaryPassword(data.temporaryPassword);
    setNewUser({ name: "", email: "", role: "STAFF" });
    await load();
  };

  const removeUser = async (user: ManagedUser, removed: boolean) => {
    await fetch(`/api/users/${user.id}/disable?disabled=${removed}`, { method: "POST" });
    await load();
  };

  const resetPassword = async (user: ManagedUser) => {
    const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
    const data = await res.json();
    if (res.ok) setTemporaryPassword(data.temporaryPassword);
    await load();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      <p className="text-slate-500">Onboard businesses, assign users, and manage access.</p>

      {temporaryPassword && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
          Temporary password: <strong>{temporaryPassword}</strong>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <form onSubmit={onboardBusiness} className="card mt-6 grid gap-3 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Create New Business</h2>
        <input value={business.shopName} onChange={(e) => setBusiness({ ...business, shopName: e.target.value })} placeholder="Shop name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input value={business.ownerName} onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })} placeholder="Owner name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input type="email" value={business.email} onChange={(e) => setBusiness({ ...business, email: e.target.value })} placeholder="Business email" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input value={business.mobile} onChange={(e) => setBusiness({ ...business, mobile: e.target.value })} placeholder="Mobile" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        <input value={business.gstNumber} onChange={(e) => setBusiness({ ...business, gstNumber: e.target.value })} placeholder="GST number" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        <input value={business.address} onChange={(e) => setBusiness({ ...business, address: e.target.value })} placeholder="Address" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
        <input value={business.adminName} onChange={(e) => setBusiness({ ...business, adminName: e.target.value })} placeholder="Admin user name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <input type="email" value={business.adminEmail} onChange={(e) => setBusiness({ ...business, adminEmail: e.target.value })} placeholder="Admin email" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white md:w-max">Create business and admin</button>
      </form>

      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="card">
          <h2 className="font-semibold">Businesses</h2>
          <select
            value={selectedShopId}
            onChange={(e) => setSelectedShopId(e.target.value)}
            className="mt-4 w-full rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          >
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>{shop.shopName}</option>
            ))}
          </select>
          <div className="mt-4 space-y-3">
            {shops.map((shop) => (
              <button
                key={shop.id}
                type="button"
                onClick={() => setSelectedShopId(shop.id)}
                className="w-full rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <p className="font-medium">{shop.shopName}</p>
                <p className="text-slate-500">{shop.ownerName} | {shop.subscriptionStatus}</p>
                <p className="text-xs text-slate-500">{shop.mobile ?? "-"} | {shop.email ?? "-"}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="font-semibold">Users</h2>
          <form onSubmit={createUser} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
            <input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Name" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email" className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800" required />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
              <option value="STAFF">Accounting / Recovery Staff</option>
              <option value="FIELD_SALES">Field Sales</option>
              <option value="SHOP_ADMIN">Shop Admin</option>
            </select>
            <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">Create</button>
          </form>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-2">User</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Shop</th>
                  <th className="p-2">Last Login</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2"><p className="font-medium">{user.name}</p><p className="text-xs text-slate-500">{user.email}</p></td>
                    <td className="p-2">{user.role}</td>
                    <td className="p-2">{user.shop?.shopName ?? "-"}</td>
                    <td className="p-2">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-IN") : "-"}</td>
                    <td className="p-2">{user.disabledAt ? "Removed" : "Active"}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => resetPassword(user)} className="rounded border px-2 py-1 text-xs">Reset</button>
                        <button type="button" onClick={() => removeUser(user, !user.disabledAt)} className="rounded border px-2 py-1 text-xs">
                          {user.disabledAt ? "Restore" : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
