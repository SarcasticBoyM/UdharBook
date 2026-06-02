"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { statusBadgeClass, formatStatus } from "@/lib/status-colors";
import { CallActions } from "@/components/CallActions";
import { FollowUpModal } from "@/components/FollowUpModal";
import { cn } from "@/lib/utils";

type CustomerDetail = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
  status: string;
  notes: string | null;
  totalCallsMade: number;
  lastFollowupDate: string | null;
  nextFollowupDate: string | null;
  createdAt: string;
  followUps: {
    id: string;
    followupDate: string;
    status: string;
    notes: string | null;
    nextFollowupDate: string | null;
    createdBy: { name: string };
  }[];
  statusHistory: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    notes: string | null;
    createdAt: string;
    changedBy: { name: string };
  }[];
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = () => {
    fetch(`/api/customers/${id}`)
      .then((r) => r.json())
      .then(setCustomer);
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!customer) {
    return <p className="text-slate-500">Loading…</p>;
  }

  return (
    <div>
      <Link href="/customers" className="text-sm text-brand-600 hover:underline">
        ← Back to list
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{customer.partyName}</h1>
          <span
            className={cn(
              "mt-2 inline-block rounded-full px-3 py-1 text-sm",
              statusBadgeClass(customer.status as Parameters<typeof statusBadgeClass>[0])
            )}
          >
            {formatStatus(customer.status as Parameters<typeof formatStatus>[0])}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white"
        >
          Log follow-up call
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Customer Information</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Outstanding</dt>
              <dd className="font-bold text-lg">{formatCurrency(customer.outstandingBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total calls</dt>
              <dd>{customer.totalCallsMade}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Last follow-up</dt>
              <dd>{formatDate(customer.lastFollowupDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Next follow-up</dt>
              <dd>{formatDate(customer.nextFollowupDate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Created</dt>
              <dd>{formatDate(customer.createdAt)}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <CallActions
              partyName={customer.partyName}
              contactNumber={customer.contactNumber}
              balance={customer.outstandingBalance}
            />
          </div>
          {customer.notes && (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              <strong>Notes:</strong> {customer.notes}
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold">Status History</h2>
          <ul className="mt-4 max-h-64 space-y-3 overflow-y-auto text-sm">
            {customer.statusHistory.length === 0 ? (
              <li className="text-slate-500">No history yet</li>
            ) : (
              customer.statusHistory.map((h) => (
                <li key={h.id} className="border-l-2 border-brand-200 pl-3">
                  <p className="font-medium">
                    {h.fromStatus ? `${h.fromStatus} → ` : ""}
                    {h.toStatus}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(h.createdAt)} · {h.changedBy.name}
                  </p>
                  {h.notes && <p className="text-slate-600">{h.notes}</p>}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="card mt-6">
        <h2 className="font-semibold">Call History & Follow-up Timeline</h2>
        <ul className="mt-4 space-y-4">
          {customer.followUps.length === 0 ? (
            <li className="text-slate-500 text-sm">No follow-ups logged</li>
          ) : (
            customer.followUps.map((f) => (
              <li key={f.id} className="flex gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div className="text-xs text-slate-500 w-24 shrink-0">{formatDate(f.followupDate)}</div>
                <div>
                  <p className="font-medium">{f.status.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-500">By {f.createdBy.name}</p>
                  {f.notes && <p className="mt-1 text-sm">{f.notes}</p>}
                  {f.nextFollowupDate && (
                    <p className="mt-1 text-xs">Next: {formatDate(f.nextFollowupDate)}</p>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      {showModal && (
        <FollowUpModal
          customerId={customer.id}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
