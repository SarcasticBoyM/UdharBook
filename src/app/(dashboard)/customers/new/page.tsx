"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewCustomerPage() {
  const router = useRouter();
  const [partyName, setPartyName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [outstandingBalance, setOutstandingBalance] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyName,
        contactNumber,
        outstandingBalance: Number(outstandingBalance) || 0,
        notes: notes || undefined,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to create customer");
      return;
    }
    const customer = await res.json();
    router.push(`/customers/${customer.id}`);
  };

  return (
    <div className="max-w-lg">
      <Link href="/customers" className="text-sm text-brand-600 hover:underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Add Customer</h1>
      <form onSubmit={submit} className="card mt-6 space-y-4">
        <div>
          <label className="text-sm font-medium">Party Name *</label>
          <input
            required
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Contact Number *</label>
          <input
            required
            value={contactNumber}
            onChange={(e) => setContactNumber(e.target.value)}
            placeholder="10-digit mobile"
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Outstanding Balance (₹)</label>
          <input
            type="number"
            min={0}
            value={outstandingBalance}
            onChange={(e) => setOutstandingBalance(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Saving…" : "Create Customer"}
        </button>
      </form>
    </div>
  );
}
