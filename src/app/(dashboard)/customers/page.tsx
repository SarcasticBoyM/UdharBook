"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Customer, CustomerStatus } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { statusBadgeClass, formatStatus, followupRowClass } from "@/lib/status-colors";
import { CallActions } from "@/components/CallActions";
import { FollowUpModal } from "@/components/FollowUpModal";
import { cn } from "@/lib/utils";

export default function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"all" | "pending">("all");
  const [sort, setSort] = useState("balance");
  const [order, setOrder] = useState("desc");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [followUpId, setFollowUpId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    const res = await fetch(`/api/customers?${params}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setPages(data.pagination?.pages ?? 1);
    setTotal(data.pagination?.total ?? 0);
    setLoading(false);
  }, [search, status, view, sort, order, page]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkWhatsApp = async () => {
    if (selected.size === 0) return;
    const res = await fetch("/api/bulk/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerIds: Array.from(selected) }),
    });
    const data = await res.json();
    for (const link of data.links ?? []) {
      window.open(link.url, "_blank");
    }
  };

  const exportExcel = () => {
    window.location.href = "/api/reports/outstanding?format=xlsx";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-slate-500">
            {loading ? "Loading…" : `${total} customer${total === 1 ? "" : "s"} shown`}
            {view === "pending" ? " (with outstanding balance)" : ""}
          </p>
        </div>
        <Link
          href="/customers/new"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          Add Customer
        </Link>
        <button
          type="button"
          onClick={exportExcel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          Export Excel
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <select
          value={view}
          onChange={(e) => {
            setPage(1);
            setView(e.target.value as "all" | "pending");
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        >
          <option value="all">All customers</option>
          <option value="pending">Pending payments only</option>
        </select>
        <input
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 md:min-w-[240px]"
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
        {selected.size > 0 && (
          <button
            type="button"
            onClick={bulkWhatsApp}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white"
          >
            Bulk WhatsApp ({selected.size})
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="p-3 w-8" />
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
              items.map((c) => (
                <tr
                  key={c.id}
                  className={cn(
                    "border-t border-slate-100 dark:border-slate-800",
                    followupRowClass(c.status, c.nextFollowupDate)
                  )}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                    />
                  </td>
                  <td className="p-3">
                    <Link href={`/customers/${c.id}`} className="font-medium text-brand-600 hover:underline">
                      {c.partyName}
                    </Link>
                  </td>
                  <td className="p-3">{c.contactNumber}</td>
                  <td className="p-3 font-medium">{formatCurrency(c.outstandingBalance)}</td>
                  <td className="p-3">{formatDate(c.lastFollowupDate)}</td>
                  <td className="p-3">{formatDate(c.nextFollowupDate)}</td>
                  <td className="p-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", statusBadgeClass(c.status))}>
                      {formatStatus(c.status)}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-2">
                      <CallActions
                        partyName={c.partyName}
                        contactNumber={c.contactNumber}
                        balance={c.outstandingBalance}
                        dueDate={c.nextFollowupDate}
                        compact
                      />
                      <button
                        type="button"
                        onClick={() => setFollowUpId(c.id)}
                        className="text-left text-xs text-brand-600 hover:underline"
                      >
                        Log follow-up
                      </button>
                    </div>
                  </td>
                </tr>
              ))
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
