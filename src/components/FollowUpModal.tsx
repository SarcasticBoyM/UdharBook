"use client";

import { useState } from "react";
import type { FollowUpStatus } from "@prisma/client";

const STATUSES: { value: FollowUpStatus; label: string }[] = [
  { value: "CONTACTED", label: "Contacted" },
  { value: "PAYMENT_PROMISED", label: "Payment Promised" },
  { value: "PAID", label: "Paid" },
  { value: "NOT_REACHABLE", label: "Not Reachable" },
];

interface Props {
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FollowUpModal({ customerId, onClose, onSaved }: Props) {
  const [status, setStatus] = useState<FollowUpStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          status,
          notes: notes || undefined,
          nextFollowupDate: nextDate ? new Date(nextDate).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save follow-up");
      onSaved();
      onClose();
    } catch {
      setError("Could not save follow-up");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-md">
        <h2 className="text-lg font-semibold">Log Follow-up Call</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FollowUpStatus)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Call notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Next follow-up date</label>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
