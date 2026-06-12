"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Pencil, Search, ShieldCheck, UserPlus } from "lucide-react";
import { assignableFixedRoles, fixedRoleLabels, normalizeFixedRole, roleLabel, type FixedShopRole } from "@/lib/operational-roles";
import { AssignTaskButton } from "@/components/AssignTaskDialog";

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
};

const defaultRole: FixedShopRole = "ACCOUNT_STAFF";

export default function StaffManagementPage() {
  const [role, setRole] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<FixedShopRole | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    mobile: "",
    jobTitle: "",
    password: "",
  });
  const [selectedRole, setSelectedRole] = useState<FixedShopRole>(defaultRole);

  const isSuperAdmin = role === "SUPER_ADMIN";
  const canSubmit = form.name.trim() && form.email.trim() && selectedRole && !saving;

  const activeShopId = useMemo(() => selectedShopId || shops[0]?.id || "", [selectedShopId, shops]);
  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) => {
      const userRole = normalizeFixedRole(user.role) as FixedShopRole;
      const matchesText = !needle || [user.name, user.email, user.mobile ?? "", user.shop?.shopName ?? "", user.jobTitle ?? ""].join(" ").toLowerCase().includes(needle);
      const matchesRole = roleFilter === "ALL" || userRole === roleFilter;
      const matchesStatus = statusFilter === "ALL" || (statusFilter === "ACTIVE" ? !user.disabledAt : Boolean(user.disabledAt));
      return matchesText && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users]);

  const load = useCallback(async () => {
    setError("");
    const meRes = await fetch("/api/auth/me");
    const me = await meRes.json().catch(() => ({}));
    const currentRole = me?.user?.role ?? "";
    const currentId = me?.user?.id ?? "";
    setRole(currentRole);
    setCurrentUserId(currentId);

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
    if (usersData.warning) {
      setMessage(usersData.warning);
    }
    setUsers(usersData.users ?? []);
  }, [activeShopId, selectedShopId]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setForm({ name: "", email: "", mobile: "", jobTitle: "", password: "" });
    setSelectedRole(defaultRole);
  }

  function startEdit(user: ManagedUser) {
    setMessage("");
    setError("");
    if (user.id === currentUserId && (role === "SHOP_ADMIN" || role === "SUPER_ADMIN")) {
      setError("Your current account is protected. Only password reset is allowed from Staff Management.");
      return;
    }
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      mobile: user.mobile ?? "",
      jobTitle: user.jobTitle ?? "",
      password: "",
    });
    setSelectedRole(normalizeFixedRole(user.role) as FixedShopRole);
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
      role: selectedRole,
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
          <p className="text-slate-500">Create staff, assign one fixed role, and manage access safely.</p>
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
          <label className="text-sm font-semibold">Role</label>
          <select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value as FixedShopRole)}
            className="mt-2 min-h-11 w-full max-w-md rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900"
          >
            {assignableFixedRoles.map((item) => <option key={item} value={item}>{fixedRoleLabels[item]}</option>)}
          </select>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!canSubmit} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : editing ? "Update Staff" : "Create Staff"}</button>
          {editing && <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700">Cancel Edit</button>}
        </div>
      </form>

      <div className="mt-6 grid gap-3 rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[1fr_220px_180px]">
        <label className="relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff by name, email, mobile, shop" className="min-h-11 w-full rounded-lg border py-2 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as FixedShopRole | "ALL")} className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
          <option value="ALL">All roles</option>
          {assignableFixedRoles.map((item) => <option key={item} value={item}>{fixedRoleLabels[item]}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")} className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
          <option value="ALL">All status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      <div className="mt-6 grid gap-3">
        {visibleUsers.map((user) => {
          const userRole = normalizeFixedRole(user.role);
          const isCurrentAccount = user.id === currentUserId && (role === "SHOP_ADMIN" || role === "SUPER_ADMIN");
          return (
            <article key={user.id} className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold">{user.name}</h2>
                    {isCurrentAccount && <span className="rounded-full bg-blue-100 px-2 py-1 text-[11px] font-bold text-blue-700">Current Account</span>}
                  </div>
                  <p className="text-sm text-slate-500">{user.email} {user.mobile ? `| ${user.mobile}` : ""}</p>
                  <p className="text-xs text-slate-500">{user.shop?.shopName ?? "-"} | Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("en-IN") : "-"}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${user.disabledAt ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {user.disabledAt ? "Inactive" : "Active"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{roleLabel(userRole)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {!user.disabledAt && userRole !== "SHOP_ADMIN" && (
                  <AssignTaskButton
                    seed={{
                      assignedToId: user.id,
                      taskType: "GENERAL_TASK",
                      title: `Task for ${user.name}`,
                      shopId: isSuperAdmin ? user.shopId : undefined,
                    }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-brand-300 px-3 text-xs font-semibold text-brand-700"
                  />
                )}
                {!isCurrentAccount && (
                  <button type="button" onClick={() => startEdit(user)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                )}
                <button type="button" onClick={() => resetPassword(user)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                  <KeyRound className="h-4 w-4" />
                  Reset Password
                </button>
                {!isCurrentAccount && (
                  <button type="button" onClick={() => setActive(user, Boolean(user.disabledAt))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                    {user.disabledAt ? "Activate" : "Deactivate"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {visibleUsers.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">No staff found for this selection.</div>}
      </div>
    </div>
  );
}
