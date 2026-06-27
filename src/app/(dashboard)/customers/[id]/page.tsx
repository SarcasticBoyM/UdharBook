"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";
import { statusBadgeClass, formatStatus } from "@/lib/status-colors";
import { CallActions } from "@/components/CallActions";
import { FollowUpModal } from "@/components/FollowUpModal";
import { AssignTaskButton } from "@/components/AssignTaskDialog";
import { cn } from "@/lib/utils";
import { isAccountsRole, isShopAdminRole, isSalesRole } from "@/lib/operational-roles";

type CustomerDetail = {
  id: string;
  partyName: string;
  contactNumber: string;
  batchTag: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  archivedById: string | null;
  outstandingBalance: number;
  status: string;
  notes: string | null;
  totalCallsMade: number;
  lastFollowupDate: string | null;
  nextFollowupDate: string | null;
  createdAt: string;
  locationName: string | null;
  geoAddress: string | null;
  googleMapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number;
  locationVerifiedAt: string | null;
  locationUpdatedBy: { name: string } | null;
  followUps: {
    id: string;
    followupDate: string;
    status: string;
    notes: string | null;
    summary: string | null;
    detailedNotes: string | null;
    sourceModule: string;
    followUpType: string | null;
    recoveryAmount: number | null;
    paymentStatus: string | null;
    chequeStatus: string | null;
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
    collectedBy: { name: string; role?: string };
    depositedBy: { name: string; role?: string } | null;
    activities: {
      id: string;
      type: string;
      toStatus: string | null;
      notes: string | null;
      createdAt: string;
      user: { name: string; role?: string };
    }[];
  }[];
  staffVisits: {
    id: string;
    status: string;
    checkInAt: string;
    checkOutAt: string | null;
    verified: boolean;
    outsideWarning: boolean;
    geoFenceStatus: string | null;
    geoFenceRadiusM: number | null;
    distanceMeters: number | null;
    accuracy: number | null;
    notes: string | null;
    result: string | null;
    visitType: string;
    outcome: string | null;
    nextAction: string | null;
    nextVisitDate: string | null;
    orderAmount: number | null;
    orderProductCategory: string | null;
    orderExpectedDelivery: string | null;
    recoveryAmount: number;
    travelKm: number;
    staff: { name: string; role?: string };
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
  const [role, setRole] = useState("");
  const [locationForm, setLocationForm] = useState({ googleMapsUrl: "", locationName: "", locationAddress: "", latitude: "", longitude: "", radius: "100" });
  const [locationMessage, setLocationMessage] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const isReadOnlySales = isSalesRole(role) && !isAccountsRole(role) && !isShopAdminRole(role);

  const load = useCallback(() => {
    fetch(`/api/customers/${id}`)
      .then((r) => r.json())
      .then(setCustomer);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!customer) return;
    setLocationForm({
      googleMapsUrl: customer.googleMapsUrl ?? "",
      locationName: customer.locationName ?? "",
      locationAddress: customer.geoAddress ?? "",
      latitude: customer.latitude == null ? "" : String(customer.latitude),
      longitude: customer.longitude == null ? "" : String(customer.longitude),
      radius: String(customer.geofenceRadiusM || 100),
    });
  }, [customer]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRole(data?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

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

  const setArchiveState = async (action: "archive" | "restore") => {
    const confirmed =
      action === "archive"
        ? window.confirm("Archive this customer? They will be hidden from active follow-ups, orders, cheques, and recovery workflows.")
        : window.confirm("Restore this customer to active operations?");
    if (!confirmed) return;

    const res = await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) load();
  };

  const parseMapsLink = async () => {
    setLocationMessage("");
    const res = await fetch(`/api/customers/${id}/location/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: locationForm.googleMapsUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) return setLocationMessage(data.error ?? "Could not parse maps link.");
    setLocationForm((current) => ({ ...current, googleMapsUrl: data.expandedUrl || current.googleMapsUrl, latitude: String(data.latitude), longitude: String(data.longitude) }));
    setLocationMessage("Coordinates parsed. Save location to apply the geofence.");
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return setLocationMessage("Geolocation is not supported on this device.");
    setLocationMessage("Getting current location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationForm((current) => ({ ...current, latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) }));
        setLocationMessage(`Current location captured with ${Math.round(position.coords.accuracy)}m accuracy.`);
      },
      (error) => setLocationMessage(error.code === 1 ? "Location permission denied. Allow location and retry." : "Could not capture current location."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const saveLocation = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocationSaving(true);
    setLocationMessage("");
    const res = await fetch(`/api/customers/${id}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        googleMapsUrl: locationForm.googleMapsUrl || null,
        locationName: locationForm.locationName || null,
        locationAddress: locationForm.locationAddress || null,
        latitude: Number(locationForm.latitude),
        longitude: Number(locationForm.longitude),
        radius: Number(locationForm.radius),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLocationSaving(false);
    if (!data.success) return setLocationMessage(data.error ?? "Could not save customer location.");
    setLocationMessage("Customer location and geofence saved.");
    load();
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
          {customer.batchTag && (
            <span className="mt-2 mr-2 inline-block rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-200">
              {customer.batchTag}
            </span>
          )}
          {customer.isArchived && (
            <span className="mt-2 mr-2 inline-block rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              Archived
            </span>
          )}
          <span
            className={cn(
              "mt-2 inline-block rounded-full px-3 py-1 text-sm",
              statusBadgeClass(customer.status as Parameters<typeof statusBadgeClass>[0])
            )}
          >
            {formatStatus(customer.status as Parameters<typeof formatStatus>[0])}
          </span>
        </div>
        {!isReadOnlySales && (
          <div className="flex flex-wrap gap-2">
            {!customer.isArchived && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Quick Follow-up
              </button>
            )}
            {isShopAdminRole(role) && !customer.isArchived && (
              <AssignTaskButton
                seed={{
                  customerId: customer.id,
                  customerName: customer.partyName,
                  taskType: "PAYMENT_COLLECTION",
                  notes: `Collect payment from ${customer.partyName}\nOutstanding: ${formatCurrency(customer.outstandingBalance)}`,
                  priority: customer.outstandingBalance >= 50000 ? "HIGH" : "MEDIUM",
                  referenceUrl: `/customers/${customer.id}`,
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setArchiveState(customer.isArchived ? "restore" : "archive")}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-semibold",
                customer.isArchived
                  ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              )}
            >
              {customer.isArchived ? "Restore Customer" : "Archive Customer"}
            </button>
          </div>
        )}
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
            {customer.isArchived && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Archived</dt>
                <dd>{formatDate(customer.archivedAt)}</dd>
              </div>
            )}
          </dl>
          {!customer.isArchived && <div className="mt-4">
            <CallActions
              partyName={customer.partyName}
              contactNumber={customer.contactNumber}
              balance={customer.outstandingBalance}
              dueDate={customer.nextFollowupDate}
            />
          </div>}
          {customer.isArchived && (
            <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              This customer is archived. History is preserved, but new follow-ups, orders, and cheque entries are disabled from active workflows.
            </p>
          )}
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

      <section className="card mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Customer Location</h2>
            <p className="mt-1 text-sm text-slate-500">Official location used for location verified sales visit punches.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${customer.latitude != null && customer.longitude != null ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {customer.latitude != null && customer.longitude != null ? "Location Set" : "Location Missing"}
          </span>
        </div>
        {customer.latitude != null && customer.longitude != null && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span>{customer.locationName || customer.geoAddress || "Saved customer location"}</span>
            <span className="text-slate-500">{customer.latitude.toFixed(6)}, {customer.longitude.toFixed(6)} | Radius {customer.geofenceRadiusM || 100}m</span>
            <a href={customer.googleMapsUrl || `https://www.google.com/maps?q=${customer.latitude},${customer.longitude}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 font-semibold">
              Open in Google Maps
            </a>
          </div>
        )}
        {customer.locationVerifiedAt && <p className="mt-2 text-xs text-slate-500">Last updated {formatDate(customer.locationVerifiedAt)}{customer.locationUpdatedBy?.name ? ` by ${customer.locationUpdatedBy.name}` : ""}</p>}
        {isShopAdminRole(role) && (
          <form onSubmit={saveLocation} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm md:col-span-2"><span className="mb-1 block font-medium">Google Maps Link</span><input value={locationForm.googleMapsUrl} onChange={(event) => setLocationForm((current) => ({ ...current, googleMapsUrl: event.target.value }))} placeholder="https://www.google.com/maps?q=..." className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" /></label>
            <input value={locationForm.locationName} onChange={(event) => setLocationForm((current) => ({ ...current, locationName: event.target.value }))} placeholder="Location name" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <input value={locationForm.locationAddress} onChange={(event) => setLocationForm((current) => ({ ...current, locationAddress: event.target.value }))} placeholder="Address / landmark" className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <input type="number" step="any" value={locationForm.latitude} onChange={(event) => setLocationForm((current) => ({ ...current, latitude: event.target.value }))} placeholder="Latitude" required className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <input type="number" step="any" value={locationForm.longitude} onChange={(event) => setLocationForm((current) => ({ ...current, longitude: event.target.value }))} placeholder="Longitude" required className="min-h-11 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <label className="text-sm"><span className="mb-1 block font-medium">Allowed radius (30-1000m)</span><input type="number" min="30" max="1000" value={locationForm.radius} onChange={(event) => setLocationForm((current) => ({ ...current, radius: event.target.value }))} className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" /></label>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" onClick={parseMapsLink} disabled={!locationForm.googleMapsUrl} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50">Parse Maps Link</button>
              <button type="button" onClick={useCurrentLocation} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Use Current Location</button>
              <button type="submit" disabled={locationSaving} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{locationSaving ? "Saving..." : "Save Location"}</button>
            </div>
          </form>
        )}
        {locationMessage && <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">{locationMessage}</p>}
      </section>

      {!isReadOnlySales && <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
      </div>}

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
                  <p><span className="text-slate-500">Geofence:</span> {visit.geoFenceStatus?.replace(/_/g, " ") ?? "Not recorded"}</p>
                  {visit.distanceMeters != null && <p><span className="text-slate-500">Distance:</span> {Math.round(visit.distanceMeters)}m / {visit.geoFenceRadiusM ?? customer.geofenceRadiusM}m</p>}
                  {visit.accuracy != null && <p><span className="text-slate-500">GPS accuracy:</span> {Math.round(visit.accuracy)}m</p>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{visit.visitType}</span>
                  {visit.outcome && <span>Outcome: {visit.outcome}</span>}
                  {visit.orderAmount ? <span>Order: {formatCurrency(visit.orderAmount)}</span> : null}
                  {visit.orderProductCategory && <span>Product: {visit.orderProductCategory}</span>}
                  {visit.nextAction && <span>Next: {visit.nextAction}</span>}
                </div>
                {(visit.outcome || visit.result || visit.notes) && <p className="mt-2 text-sm">{visit.outcome ?? visit.result ?? visit.notes}</p>}
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
                  <p className="font-medium">{f.summary || f.followUpType || f.status.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-500">By {f.createdBy.name} / {f.sourceModule.replace(/_/g, " ")}</p>
                  {(f.detailedNotes || f.notes) && <p className="mt-1 text-sm">{f.detailedNotes || f.notes}</p>}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                    {f.recoveryAmount ? <span>Recovery: {formatCurrency(f.recoveryAmount)}</span> : null}
                    {f.paymentStatus ? <span>Payment: {f.paymentStatus.replace(/_/g, " ")}</span> : null}
                    {f.chequeStatus ? <span>Cheque: {f.chequeStatus.replace(/_/g, " ")}</span> : null}
                  </div>
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

      {showModal && !isReadOnlySales && !customer.isArchived && (
        <FollowUpModal
          customerId={customer.id}
          customerName={customer.partyName}
          balance={customer.outstandingBalance}
          recentInteractions={customer.followUps}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
