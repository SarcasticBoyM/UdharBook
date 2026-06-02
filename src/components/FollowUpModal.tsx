"use client";

import { useState } from "react";
import type { FollowUpPriority, FollowUpStatus } from "@prisma/client";

const STATUSES: { value: FollowUpStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "PAYMENT_PROMISED", label: "Payment Promised" },
  { value: "PAID", label: "Paid" },
  { value: "NOT_REACHABLE", label: "Not Reachable" },
  { value: "COMPLETED", label: "Completed" },
  { value: "MISSED", label: "Missed" },
  { value: "RESCHEDULED", label: "Rescheduled" },
];

interface Props {
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FollowUpModal({ customerId, onClose, onSaved }: Props) {
  const [status, setStatus] = useState<FollowUpStatus>("CONTACTED");
  const [notes, setNotes] = useState("");
  const [reminderNotes, setReminderNotes] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [priority, setPriority] = useState<FollowUpPriority>("MEDIUM");
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
          priority,
          notes: notes || undefined,
          reminderNotes: reminderNotes || undefined,
          customerResponse: customerResponse || undefined,
          scheduledAt: nextDate ? new Date(nextDate).toISOString() : null,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-4">
      <div className="my-4 flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Log Follow-up Call</h2>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
              <label className="text-sm font-medium">Next follow-up date & time</label>
              <input
                type="datetime-local"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Reminder notes</label>
              <textarea
                value={reminderNotes}
                onChange={(e) => setReminderNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Customer response</label>
              <textarea
                value={customerResponse}
                onChange={(e) => setCustomerResponse(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as FollowUpPriority)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
              >
                {(["LOW", "MEDIUM", "HIGH", "URGENT"] as FollowUpPriority[]).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
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
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
