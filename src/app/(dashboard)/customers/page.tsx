"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Customer, CustomerStatus } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { statusBadgeClass, formatStatus, followupRowClass } from "@/lib/status-colors";
import { CallActions } from "@/components/CallActions";
import { FollowUpModal } from "@/components/FollowUpModal";
import { cn } from "@/lib/utils";
import { isAccountsRole, isShopAdminRole, isSalesRole } from "@/lib/operational-roles";

type CustomerView = "active" | "inactive" | "all" | "pending" | "archived" | "all_with_archived";
type CustomerWithBatch = Customer & { batchTag?: string | null; isArchived?: boolean; archivedAt?: string | Date | null; archivedById?: string | null };

export default function CustomersPage() {
  const [items, setItems] = useState<CustomerWithBatch[]>([]);
  const [search, setSearch] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<CustomerView>("all");
  const [sort, setSort] = useState("balance");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [followUpId, setFollowUpId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [role, setRole] = useState("");
  const isReadOnlySales = isSalesRole(role) && !isAccountsRole(role) && !isShopAdminRole(role);
  const selectableVisibleIds = items.filter((customer) => !customer.isArchived).map((customer) => customer.id);
  const selectedCount = selected.size;
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selected.has(id));

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      search,
      sort,
      order,
      page: String(page),
      limit: "20",
      view,
    });
    if (status) params.set("status", status);
    if (batchTag.trim()) params.set("batchTag", batchTag.trim());
    const res = await fetch(`/api/customers?${params}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setPages(data.pagination?.pages ?? 1);
    setTotal(data.pagination?.total ?? 0);
    setLoading(false);
  }, [batchTag, search, status, view, sort, order, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRole(data?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const shouldClearVisible = selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => next.has(id));
      selectableVisibleIds.forEach((id) => {
        if (shouldClearVisible) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const cancelSelection = () => {
    setSelected(new Set());
    setSelectionMode(false);
  };

  const exportUrl = () => {
    const params = new URLSearchParams({ format: "xlsx", mode: "customers" });
    if (selectedCount > 0) {
      params.set("ids", Array.from(selected).join(","));
    } else {
      params.set("search", search);
      params.set("sort", sort);
      params.set("order", order);
      params.set("view", view);
      if (status) params.set("status", status);
      if (batchTag.trim()) params.set("batchTag", batchTag.trim());
    }
    return `/api/reports/outstanding?${params.toString()}`;
  };

  const exportExcel = () => {
    window.location.href = exportUrl();
  };

  const bulkArchive = async () => {
    if (selectedCount === 0) return;
    const confirmed = window.confirm(
      `Archive ${selectedCount} customer${selectedCount === 1 ? "" : "s"}?\n\nArchived customers will disappear from active customer lists, follow-ups, Order Desk, cheque workflows, and recovery workflows. Customer history will remain preserved.`
    );
    if (!confirmed) return;

    const res = await fetch("/api/customers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive", ids: Array.from(selected) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error ?? "Could not archive selected customers.");
      return;
    }
    cancelSelection();
    load();
  };

  const setArchiveState = async (customerId: string, action: "archive" | "restore") => {
    const confirmed =
      action === "archive"
        ? window.confirm("Archive this customer? They will be hidden from active follow-ups, orders, cheques, and recovery workflows.")
        : window.confirm("Restore this customer to active operations?");
    if (!confirmed) return;

    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(customerId);
        return next;
      });
      load();
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-slate-500">
            {loading ? "Loading…" : `${total} customer${total === 1 ? "" : "s"} shown`}
            {view === "active"
              ? " (outstanding customers)"
              : view === "inactive"
                ? " (inactive / zero balance)"
                : view === "all"
                  ? " (active customers)"
                : view === "pending"
                  ? " (with outstanding balance)"
                  : view === "archived"
                    ? " (archived customers)"
                    : view === "all_with_archived"
                      ? " (active + archived)"
                    : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isReadOnlySales && (
            <Link
              href="/customers/new"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
            >
              Add Customer
            </Link>
          )}
          {!isReadOnlySales && (
            <button
              type="button"
              onClick={() => setSelectionMode(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800 md:hidden"
            >
              Select Customers
            </button>
          )}
          {!isReadOnlySales && (
            <button
              type="button"
              onClick={exportExcel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              Export Excel
            </button>
          )}
          {!isReadOnlySales && (
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={bulkArchive}
              className="hidden rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40 md:inline-flex"
            >
              Archive Customers
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <select
          value={view}
          onChange={(e) => {
            setPage(1);
            setView(e.target.value as CustomerView);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="all">Active Customers</option>
          <option value="archived">Archived Customers</option>
          <option value="all_with_archived">All Customers</option>
          <option value="active">Outstanding Customers</option>
          <option value="inactive">Inactive / Zero Balance Customers</option>
          <option value="pending">Pending payments only</option>
        </select>
        <input
          placeholder="Search name, phone, or location..."
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 md:min-w-[240px]"
        />
        <input
          placeholder="Filter by firm / batch"
          value={batchTag}
          onChange={(e) => {
            setPage(1);
            setBatchTag(e.target.value);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 md:w-[180px]"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="">All statuses</option>
          {(["ACTIVE", "PENDING", "HIGH_RISK", "CLEARED"] as CustomerStatus[]).map(
            (s) => (
              <option key={s} value={s}>
                {formatStatus(s)}
              </option>
            )
          )}
        </select>
        <select
          value={`${sort}-${order}`}
          onChange={(e) => {
            const [s, o] = e.target.value.split("-");
            setSort(s);
            setOrder(o);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="balance-desc">Balance: High to Low</option>
          <option value="balance-asc">Balance: Low to High</option>
          <option value="nextFollowup-asc">Follow-up: Soonest</option>
          <option value="nextFollowup-desc">Follow-up: Latest</option>
        </select>
      </div>

      {!isReadOnlySales && (selectionMode || selectedCount > 0) && (
        <div className="sticky bottom-3 z-20 mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900 md:top-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-sm font-semibold">
              Selected: {selectedCount} Customer{selectedCount === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={selectableVisibleIds.length === 0}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-50 dark:border-slate-600"
            >
              {allVisibleSelected ? "Clear Visible" : "Select All"}
            </button>
            <button
              type="button"
              onClick={exportExcel}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600"
            >
              Export
            </button>
            <button
              type="button"
              onClick={bulkArchive}
              disabled={selectedCount === 0}
              className="min-h-10 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Archive
            </button>
            <button
              type="button"
              onClick={cancelSelection}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3 md:hidden">
        {loading ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500 dark:border-slate-700">Loading...</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500 dark:border-slate-700">No customers found</div>
        ) : (
          items.map((c) => {
            const inactive = c.outstandingBalance <= 0 || c.status === "CLEARED";
            const archived = Boolean(c.isArchived);
            return (
              <article
                key={c.id}
                className={cn(
                  "rounded-xl border bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900",
                  inactive && "bg-slate-50 text-slate-500 opacity-80 dark:bg-slate-900/50",
                  archived && "bg-slate-100 text-slate-500 opacity-80 dark:bg-slate-900"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/customers/${c.id}`} className="block break-words text-base font-bold text-brand-700 dark:text-brand-300">
                      {c.partyName}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.batchTag && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-200">{c.batchTag}</span>}
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClass(c.status))}>{formatStatus(c.status)}</span>
                      {archived && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">Archived</span>}
                    </div>
                  </div>
                  {selectionMode && (
                    <input type="checkbox" checked={selected.has(c.id)} disabled={archived} onChange={() => toggleSelect(c.id)} className="mt-1 h-5 w-5 shrink-0" />
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>Mobile: <strong className="text-slate-700 dark:text-slate-200">{c.contactNumber}</strong></span>
                  <span>Balance: <strong className="text-slate-700 dark:text-slate-200">{formatCurrency(c.outstandingBalance)}</strong></span>
                  <span>Last: {formatDate(c.lastFollowupDate)}</span>
                  <span>Next: {formatDate(c.nextFollowupDate)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!archived && <CallActions partyName={c.partyName} contactNumber={c.contactNumber} balance={c.outstandingBalance} dueDate={c.nextFollowupDate} compact />}
                  {!isReadOnlySales && !archived && (
                    <button type="button" onClick={() => setFollowUpId(c.id)} className="min-h-10 rounded-lg border border-brand-200 px-3 text-xs font-semibold text-brand-700">
                      Quick Follow-up
                    </button>
                  )}
                  {!isReadOnlySales && (
                    <button type="button" onClick={() => setArchiveState(c.id, archived ? "restore" : "archive")} className={cn("min-h-10 rounded-lg border px-3 text-xs font-semibold", archived ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-600")}>
                      {archived ? "Restore" : "Archive"}
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 md:block">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible customers"
                  checked={allVisibleSelected}
                  disabled={selectableVisibleIds.length === 0}
                  onChange={selectAllVisible}
                />
              </th>
              <th className="p-3">Party Name</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Balance</th>
              <th className="p-3">Last Follow-up</th>
              <th className="p-3">Next Follow-up</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-500">
                  No customers found
                </td>
              </tr>
            ) : (
              items.map((c) => {
                const inactive = c.outstandingBalance <= 0 || c.status === "CLEARED";
                const archived = Boolean(c.isArchived);
                return (
                <tr
                  key={c.id}
                  className={cn(
                    "border-t border-slate-100 dark:border-slate-800",
                    followupRowClass(c.status, c.nextFollowupDate),
                    inactive && "bg-slate-50 text-slate-500 opacity-75 dark:bg-slate-900/50",
                    archived && "bg-slate-100 text-slate-500 opacity-75 dark:bg-slate-900"
                  )}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      disabled={archived}
                      onChange={() => toggleSelect(c.id)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/customers/${c.id}`} className="font-medium text-brand-600 hover:underline">
                        {c.partyName}
                      </Link>
                      {c.batchTag && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-200">
                          {c.batchTag}
                        </span>
                      )}
                      {archived && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                          Archived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">{c.contactNumber}</td>
                  <td className="p-3">
                    <span className="font-medium">{formatCurrency(c.outstandingBalance)}</span>
                    {c.batchTag && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c.batchTag}</span>}
                  </td>
                  <td className="p-3">{formatDate(c.lastFollowupDate)}</td>
                  <td className="p-3">{formatDate(c.nextFollowupDate)}</td>
                  <td className="p-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", statusBadgeClass(c.status))}>
                      {formatStatus(c.status)}
                    </span>
                    {inactive && (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        Zero balance
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-2">
                      {!archived && (
                        <CallActions
                          partyName={c.partyName}
                          contactNumber={c.contactNumber}
                          balance={c.outstandingBalance}
                          dueDate={c.nextFollowupDate}
                          compact
                        />
                      )}
                      {!isReadOnlySales && !archived && (
                        <button
                          type="button"
                          onClick={() => setFollowUpId(c.id)}
                          className="text-left text-xs text-brand-600 hover:underline"
                        >
                          Quick Follow-up
                        </button>
                      )}
                      {!isReadOnlySales && (
                        <button
                          type="button"
                          onClick={() => setArchiveState(c.id, archived ? "restore" : "archive")}
                          className={cn(
                            "text-left text-xs hover:underline",
                            archived ? "text-emerald-700" : "text-slate-500"
                          )}
                        >
                          {archived ? "Restore Customer" : "Archive Customer"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40"
        >
          Previous
        </button>
        <span className="py-1 text-sm">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border px-3 py-1 text-sm disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {followUpId && (
        <FollowUpModal
          customerId={followUpId}
          onClose={() => setFollowUpId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
