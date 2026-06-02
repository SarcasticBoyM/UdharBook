"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Customer } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CallActions } from "@/components/CallActions";
import { FollowUpModal } from "@/components/FollowUpModal";

export default function FollowUpsPage() {
  const [filter, setFilter] = useState<"today" | "overdue" | "">("today");
  const [items, setItems] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [followUpId, setFollowUpId] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = filter ? `?filter=${filter}` : "";
    fetch(`/api/follow-ups${q}`)
      .then((r) => r.json())
      .then(setItems);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (filter === "overdue" && items.length > 0) {
      new Notification("UdharBook overdue follow-ups", {
        body: `${items.length} customer${items.length === 1 ? "" : "s"} need attention.`,
        icon: "/icon.svg",
      });
    }
  }, [filter, items.length]);

  const bulkSchedule = async () => {
    if (!bulkDate || selected.size === 0) return;
    await fetch("/api/bulk/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerIds: Array.from(selected),
        nextFollowupDate: new Date(bulkDate).toISOString(),
      }),
    });
    setSelected(new Set());
    load();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Follow-ups</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["today", "overdue", ""] as const).map((f) => (
          <button
            key={f || "all"}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-4 py-2 text-sm ${
              filter === f
                ? "bg-brand-600 text-white"
                : "border border-slate-300 dark:border-slate-600"
            }`}
          >
            {f === "today" ? "Today" : f === "overdue" ? "Overdue" : "All pending"}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="card mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm">Bulk schedule next follow-up</label>
            <input
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              className="mt-1 block rounded border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <button
            type="button"
            onClick={bulkSchedule}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white"
          >
            Apply to {selected.size} customers
          </button>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {items.map((c) => (
          <div key={c.id} className="card flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    return next;
                  });
                }}
              />
              <div>
                <Link href={`/customers/${c.id}`} className="font-semibold text-brand-600 hover:underline">
                  {c.partyName}
                </Link>
                <p className="text-sm text-slate-500">{formatCurrency(c.outstandingBalance)}</p>
                <p className="text-xs">Next: {formatDate(c.nextFollowupDate)}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <CallActions
                partyName={c.partyName}
                contactNumber={c.contactNumber}
                balance={c.outstandingBalance}
                compact
              />
              <button
                type="button"
                onClick={() => setFollowUpId(c.id)}
                className="text-sm text-brand-600 hover:underline"
              >
                Log follow-up
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-slate-500">No follow-ups in this view.</p>}
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
