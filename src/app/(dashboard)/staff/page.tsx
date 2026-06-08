"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OperationalRole } from "@prisma/client";
import { Check, KeyRound, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { operationalRoleLabels } from "@/lib/operational-roles";

type Shop = {
  id: string;
  shopName: string;
};

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  jobTitle: string | null;
  role: string;
  disabledAt: string | null;
  lastLoginAt: string | null;
  shopId: string;
  shop: { shopName: string } | null;
  roleAssignments?: { role: OperationalRole; createdAt: string }[];
};

const roleOptions: OperationalRole[] = [
  "ACCOUNTING_STAFF",
  "FIELD_SALES_PERSON",
  "CHEQUE_OPERATIONS",
  "ORDER_MANAGER",
  "FOLLOWUP_MANAGER",
  "SHOP_ADMIN",
];

const defaultRoles: OperationalRole[] = ["ACCOUNTING_STAFF"];

function rolesForUser(user?: ManagedUser | null) {
  if (!user) return defaultRoles;
  if (user.roleAssignments?.length) return user.roleAssignments.map((item) => item.role);
  if (user.role === "SHOP_ADMIN") return ["SHOP_ADMIN" as OperationalRole];
  if (user.role === "FIELD_SALES") return ["FIELD_SALES_PERSON" as OperationalRole, "ORDER_MANAGER" as OperationalRole];
  return ["ACCOUNTING_STAFF" as OperationalRole, "CHEQUE_OPERATIONS" as OperationalRole, "FOLLOWUP_MANAGER" as OperationalRole];
}

function roleBadges(roles: OperationalRole[]) {
  return roles.length ? roles : defaultRoles;
}

export default function StaffManagementPage() {
  const [role, setRole] = useState("");
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    mobile: "",
    jobTitle: "",
    password: "",
  });
  const [selectedRoles, setSelectedRoles] = useState<OperationalRole[]>(defaultRoles);

  const isSuperAdmin = role === "SUPER_ADMIN";
  const canSubmit = form.name.trim() && form.email.trim() && selectedRoles.length > 0 && !saving;

  const activeShopId = useMemo(() => selectedShopId || shops[0]?.id || "", [selectedShopId, shops]);

  const load = useCallback(async () => {
    setError("");
    const meRes = await fetch("/api/auth/me");
    const me = await meRes.json().catch(() => ({}));
    const currentRole = me?.user?.role ?? "";
    setRole(currentRole);

    let shopId = activeShopId;
    if (currentRole === "SUPER_ADMIN") {
      const shopsRes = await fetch("/api/shops");
      const shopsData = await shopsRes.json().catch(() => ({}));
      const loadedShops: Shop[] = shopsData.shops ?? [];
      setShops(loadedShops);
      shopId = selectedShopId || loadedShops[0]?.id || "";
      if (shopId && !selectedShopId) setSelectedShopId(shopId);
    }

    const usersUrl = currentRole === "SUPER_ADMIN" && shopId ? `/api/users?shopId=${shopId}` : "/api/users";
    const usersRes = await fetch(usersUrl);
    const usersData = await usersRes.json().catch(() => ({}));
    if (!usersRes.ok) {
      setError(usersData.error ?? "Could not load staff");
      return;
    }
    setUsers(usersData.users ?? []);
  }, [activeShopId, selectedShopId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setForm({ name: "", email: "", mobile: "", jobTitle: "", password: "" });
    setSelectedRoles(defaultRoles);
  }

  function startEdit(user: ManagedUser) {
    setMessage("");
    setError("");
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      mobile: user.mobile ?? "",
      jobTitle: user.jobTitle ?? "",
      password: "",
    });
    setSelectedRoles(rolesForUser(user));
  }

  function toggleRole(nextRole: OperationalRole) {
    setSelectedRoles((current) => {
      const next = current.includes(nextRole) ? current.filter((item) => item !== nextRole) : [...current, nextRole];
      return next.length ? next : current;
    });
  }

  async function saveStaff(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      ...(editing ? { userId: editing.id } : {}),
      ...form,
      password: form.password || undefined,
      roles: selectedRoles,
      shopId: isSuperAdmin ? activeShopId : undefined,
    };
    const res = await fetch("/api/users", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save staff");
      return;
    }
    setMessage(data.temporaryPassword ? `Temporary password: ${data.temporaryPassword}` : "Staff access updated.");
    resetForm();
    await load();
  }

  async function setActive(user: ManagedUser, active: boolean) {
    setError("");
    const res = await fetch(`/api/users/${user.id}/disable?disabled=${!active}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not update staff status");
      return;
    }
    await load();
  }

  async function resetPassword(user: ManagedUser) {
    setError("");
    setMessage("");
    const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not reset password");
      return;
    }
    setMessage(`Temporary password for ${user.name}: ${data.temporaryPassword}`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Staff Management</h1>
          <p className="text-slate-500">Create staff, assign multiple roles, and manage access safely.</p>
        </div>
        <button type="button" onClick={resetForm} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white">
          <UserPlus className="h-4 w-4" />
          Add Staff
        </button>
      </div>

      {message && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {isSuperAdmin && (
        <div className="mt-5 max-w-md">
          <label className="text-sm font-semibold">Business shop</label>
          <select value={activeShopId} onChange={(event) => setSelectedShopId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
            {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.shopName}</option>)}
          </select>
        </div>
      )}

      <form onSubmit={saveStaff} className="mt-6 rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-600" />
          <h2 className="font-bold">{editing ? "Edit Staff Access" : "Add Staff"}</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Name" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" required />
          <input value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} placeholder="Mobile" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <input value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} placeholder="Job title" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          {!editing && <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Password or leave blank" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900 xl:col-span-2" />}
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold">Assigned roles</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {roleOptions.map((item) => {
              const selected = selectedRoles.includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleRole(item)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200"}`}
                >
                  {selected && <Check className="h-4 w-4" />}
                  {operationalRoleLabels[item]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!canSubmit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : editing ? "Update Staff" : "Create Staff"}</button>
          {editing && <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Cancel Edit</button>}
        </div>
      </form>

      <div className="mt-6 grid gap-3">
        {users.map((user) => {
          const roles = roleBadges(rolesForUser(user));
          return (
            <article key={user.id} className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">{user.name}</h2>
                  <p className="text-sm text-slate-500">{user.email} {user.mobile ? `| ${user.mobile}` : ""}</p>
                  <p className="text-xs text-slate-500">{user.shop?.shopName ?? "-"} | Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-IN") : "-"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${user.disabledAt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {user.disabledAt ? "Inactive" : "Active"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {roles.map((item) => <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{operationalRoleLabels[item]}</span>)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => startEdit(user)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                  <Pencil className="h-4 w-4" />
                  Edit
                </button>
                <button type="button" onClick={() => resetPassword(user)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                  <KeyRound className="h-4 w-4" />
                  Reset Password
                </button>
                <button type="button" onClick={() => setActive(user, Boolean(user.disabledAt))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                  {user.disabledAt ? "Activate" : "Deactivate"}
                </button>
              </div>
            </article>
          );
        })}
        {users.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">No staff found for this shop.</div>}
      </div>
    </div>
  );
}
