"use client";

import { useCallback, useEffect, useState } from "react";
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
  payments: {
    id: string;
    amount: number;
    paidAt: string;
    method: string | null;
    notes: string | null;
    createdBy: { name: string };
  }[];
  comments: {
    id: string;
    note: string;
    createdAt: string;
    createdBy: { name: string };
  }[];
  cheques: {
    id: string;
    chequeNumber: string;
    bankName: string;
    chequeDate: string;
    amount: number;
    status: string;
    collectionDateTime: string;
    depositDateTime: string | null;
    bounceReason: string | null;
    collectedBy: { name: string; role: string };
    depositedBy: { name: string; role: string } | null;
    activities: {
      id: string;
      type: string;
      toStatus: string | null;
      notes: string | null;
      createdAt: string;
      user: { name: string; role: string };
    }[];
  }[];
  staffVisits: {
    id: string;
    status: string;
    checkInAt: string;
    checkOutAt: string | null;
    verified: boolean;
    outsideWarning: boolean;
    notes: string | null;
    result: string | null;
    recoveryAmount: number;
    travelKm: number;
    staff: { name: string; role: string };
    photos: { id: string; url: string; fileType: string | null; createdAt: string }[];
  }[];
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch(`/api/customers/${id}`)
      .then((r) => r.json())
      .then(setCustomer);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const addPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!amount) return;
    const res = await fetch(`/api/customers/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        notes: paymentNotes || undefined,
        paidAt: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      setPaymentAmount("");
      setPaymentNotes("");
      load();
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    const res = await fetch(`/api/customers/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (res.ok) {
      setNote("");
      load();
    }
  };

  if (!customer) {
    return <p className="text-slate-500">Loading…</p>;
  }

  const chequeSummary = {
    total: customer.cheques.length,
    clearedAmount: customer.cheques
      .filter((cheque) => cheque.status === "CLEARED")
      .reduce((sum, cheque) => sum + cheque.amount, 0),
    bounced: customer.cheques.filter((cheque) => cheque.status === "BOUNCED").length,
    pending: customer.cheques.filter((cheque) =>
      ["COLLECTED", "PENDING_DEPOSIT", "DEPOSITED"].includes(cheque.status)
    ).length,
  };

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
              dueDate={customer.nextFollowupDate}
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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form onSubmit={addPayment} className="card">
          <h2 className="font-semibold">Record Payment</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              type="number"
              min="1"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder="Amount received"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <input
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Method or note"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </div>
          <button type="submit" className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white">
            Save payment
          </button>
          <ul className="mt-4 space-y-2 text-sm">
            {customer.payments.length === 0 ? (
              <li className="text-slate-500">No payments recorded</li>
            ) : (
              customer.payments.map((p) => (
                <li key={p.id} className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                  <span>
                    {formatDate(p.paidAt)} by {p.createdBy.name}
                  </span>
                  <span className="font-medium">{formatCurrency(p.amount)}</span>
                </li>
              ))
            )}
          </ul>
        </form>

        <form onSubmit={addNote} className="card">
          <h2 className="font-semibold">Notes & Comments</h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Add an internal note"
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <button type="submit" className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">
            Add note
          </button>
          <ul className="mt-4 max-h-56 space-y-3 overflow-y-auto text-sm">
            {customer.comments.length === 0 ? (
              <li className="text-slate-500">No comments yet</li>
            ) : (
              customer.comments.map((comment) => (
                <li key={comment.id} className="border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                  <p>{comment.note}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(comment.createdAt)} by {comment.createdBy.name}
                  </p>
                </li>
              ))
            )}
          </ul>
        </form>
      </div>

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Field Visit History</h2>
            <p className="mt-1 text-sm text-slate-500">Customer visits, geo verification, recovery notes, and photos.</p>
          </div>
          <Link href={`/daily-visits`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
            Open Daily Visits
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs text-slate-500">Total visits</p>
            <p className="mt-1 text-xl font-bold">{customer.staffVisits.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
            <p className="text-xs">Verified</p>
            <p className="mt-1 text-xl font-bold">{customer.staffVisits.filter((visit) => visit.verified).length}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800">
            <p className="text-xs">Recovered</p>
            <p className="mt-1 text-xl font-bold">
              {formatCurrency(customer.staffVisits.reduce((sum, visit) => sum + visit.recoveryAmount, 0))}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <p className="text-xs">Outside warnings</p>
            <p className="mt-1 text-xl font-bold">{customer.staffVisits.filter((visit) => visit.outsideWarning).length}</p>
          </div>
        </div>
        <ul className="mt-5 space-y-4">
          {customer.staffVisits.length === 0 ? (
            <li className="text-sm text-slate-500">No field visits recorded</li>
          ) : (
            customer.staffVisits.map((visit) => (
              <li key={visit.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{visit.status.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(visit.checkInAt)} by {visit.staff.name}
                    </p>
                  </div>
                  <span className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    visit.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  )}>
                    {visit.verified ? "Geo verified" : "Geo pending"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <p><span className="text-slate-500">Checkout:</span> {formatDate(visit.checkOutAt)}</p>
                  <p><span className="text-slate-500">Recovery:</span> {formatCurrency(visit.recoveryAmount)}</p>
                  <p><span className="text-slate-500">Travel:</span> {visit.travelKm.toFixed(1)} km</p>
                </div>
                {(visit.result || visit.notes) && <p className="mt-2 text-sm">{visit.result ?? visit.notes}</p>}
                {visit.photos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {visit.photos.map((photo) => (
                      <a key={photo.id} href={photo.url} target="_blank" className="rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                        Visit photo
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
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

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Cheque History</h2>
            <p className="mt-1 text-sm text-slate-500">Collection, deposit, clearance, and bounce tracking.</p>
          </div>
          <Link href="/cheques" className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
            Open Cheque Collections
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs text-slate-500">Total cheques</p>
            <p className="mt-1 text-xl font-bold">{chequeSummary.total}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
            <p className="text-xs">Cleared amount</p>
            <p className="mt-1 text-xl font-bold">{formatCurrency(chequeSummary.clearedAmount)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <p className="text-xs">Pending cheques</p>
            <p className="mt-1 text-xl font-bold">{chequeSummary.pending}</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <p className="text-xs">Bounced cheques</p>
            <p className="mt-1 text-xl font-bold">{chequeSummary.bounced}</p>
          </div>
        </div>

        <ul className="mt-5 space-y-4">
          {customer.cheques.length === 0 ? (
            <li className="text-sm text-slate-500">No cheques recorded</li>
          ) : (
            customer.cheques.map((cheque) => (
              <li key={cheque.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {cheque.chequeNumber} | {cheque.bankName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Collected {formatDate(cheque.collectionDateTime)} by {cheque.collectedBy.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatCurrency(cheque.amount)}</p>
                    <p className="text-xs text-slate-500">{cheque.status.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <p>
                    <span className="text-slate-500">Cheque date:</span> {formatDate(cheque.chequeDate)}
                  </p>
                  <p>
                    <span className="text-slate-500">Deposit:</span> {formatDate(cheque.depositDateTime)}
                  </p>
                  <p>
                    <span className="text-slate-500">Deposited by:</span> {cheque.depositedBy?.name ?? "-"}
                  </p>
                </div>
                {cheque.bounceReason && <p className="mt-2 text-sm text-red-700">Bounce reason: {cheque.bounceReason}</p>}
                {cheque.activities.length > 0 && (
                  <ul className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3 text-sm dark:border-slate-700">
                    {cheque.activities.map((activity) => (
                      <li key={activity.id}>
                        <p className="font-medium">
                          {activity.type.replace(/_/g, " ")}
                          {activity.toStatus ? ` - ${activity.toStatus.replace(/_/g, " ")}` : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(activity.createdAt)} by {activity.user.name}
                        </p>
                        {activity.notes && <p className="text-slate-600 dark:text-slate-300">{activity.notes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
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
