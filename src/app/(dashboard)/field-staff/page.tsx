"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Camera,
  CheckCircle2,
  Clock,
  IndianRupee,
  LocateFixed,
  MapPin,
  Navigation,
  PauseCircle,
  Search,
} from "lucide-react";

type CustomerSuggestion = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
  lastFollowupDate: string | null;
};

type Visit = {
  id: string;
  status: "CHECKED_IN" | "COMPLETED" | "CANCELLED";
  checkInAt: string;
  checkOutAt: string | null;
  verified: boolean;
  outsideWarning: boolean;
  notes: string | null;
  result: string | null;
  recoveryAmount: number;
  customer: { partyName: string; contactNumber: string; outstandingBalance: number };
};

const quickResults = ["Follow-up done", "Promise to pay", "Payment collected", "Not available", "Cheque pickup"];

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function FieldStaffPage() {
  const [tracking, setTracking] = useState(false);
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState(quickResults[0]);
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [nextFollowupDate, setNextFollowupDate] = useState("");
  const intervalRef = useRef<number | null>(null);

  const canCheckIn = Boolean(selectedCustomer && location && !activeVisit);

  const todaySummary = useMemo(
    () => ({
      visits: visits.length,
      completed: visits.filter((visit) => visit.status === "COMPLETED").length,
      recovered: visits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
    }),
    [visits],
  );

  const sendLocation = useCallback(async (position: GeolocationPosition, status = "ACTIVE") => {
    await fetch("/api/field-staff/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        status,
      }),
    });
  }, []);

  const captureLocation = useCallback((status = "ACTIVE") => {
    if (!navigator.geolocation) {
      setMessage("Location is not supported on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setLocation(position);
        await sendLocation(position, status).catch(() => setMessage("Could not sync location."));
      },
      () => setMessage("Please allow location permission."),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, [sendLocation]);

  const loadVisits = useCallback(async () => {
    const res = await fetch("/api/field-staff/visits");
    const data = await res.json();
    if (data.success) {
      setVisits(data.visits);
      setActiveVisit(data.visits.find((visit: Visit) => visit.status === "CHECKED_IN") ?? null);
    }
  }, []);

  async function startTracking() {
    setTracking(true);
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "START" }),
    });
    captureLocation("ACTIVE");
  }

  async function stopTracking() {
    setTracking(false);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "STOP" }),
    });
    setMessage("Field tracking stopped.");
  }

  async function checkIn() {
    if (!canCheckIn || !selectedCustomer || !location) return;
    const res = await fetch("/api/field-staff/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: selectedCustomer.id,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        notes,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      setMessage(data.error ?? "Could not check in.");
      return;
    }
    setActiveVisit(data.visit);
    setSelectedCustomer(null);
    setSearch("");
    setCustomers([]);
    setNotes("");
    await loadVisits();
  }

  async function checkOut() {
    if (!activeVisit) return;
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation?.getCurrentPosition(resolve, () => resolve(null), {
        enableHighAccuracy: true,
        timeout: 12000,
      });
    });
    const res = await fetch(`/api/field-staff/visits/${activeVisit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CHECK_OUT",
        latitude: position?.coords.latitude,
        longitude: position?.coords.longitude,
        notes,
        result,
        recoveryAmount: Number(recoveryAmount || 0),
        nextFollowupDate: nextFollowupDate ? new Date(nextFollowupDate).toISOString() : undefined,
        followupNotes: notes,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      setMessage(data.error ?? "Could not check out.");
      return;
    }
    setActiveVisit(null);
    setNotes("");
    setRecoveryAmount("");
    setNextFollowupDate("");
    await loadVisits();
  }

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  useEffect(() => {
    if (!tracking) return;
    intervalRef.current = window.setInterval(() => captureLocation(activeVisit ? "ON_VISIT" : "ACTIVE"), 180000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [tracking, activeVisit, captureLocation]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 1) {
        setCustomers([]);
        return;
      }
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(search)}&limit=8`);
      const data = await res.json();
      setCustomers(data.customers ?? []);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-24">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Field Operations</p>
          <h1 className="text-2xl font-bold md:text-3xl">Field Staff</h1>
          <p className="text-sm text-slate-500">Start tracking, check in at customers, and close visits from mobile.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={tracking ? stopTracking : startTracking}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white md:flex-none"
          >
            {tracking ? <PauseCircle className="h-5 w-5" /> : <Navigation className="h-5 w-5" />}
            {tracking ? "Stop Day" : "Start Day"}
          </button>
          <button
            type="button"
            onClick={() => captureLocation(activeVisit ? "ON_VISIT" : "ACTIVE")}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold"
          >
            <LocateFixed className="h-5 w-5" />
            GPS
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-slate-500">Visits today</p>
          <p className="mt-2 text-2xl font-bold">{todaySummary.visits}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-slate-500">Completed</p>
          <p className="mt-2 text-2xl font-bold">{todaySummary.completed}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs text-slate-500">Recovered</p>
          <p className="mt-2 text-2xl font-bold">{money(todaySummary.recovered)}</p>
        </div>
      </div>

      {activeVisit ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-emerald-700">ACTIVE VISIT</p>
              <h2 className="mt-1 text-xl font-bold">{activeVisit.customer.partyName}</h2>
              <p className="text-sm text-slate-600">{activeVisit.customer.contactNumber} · {money(activeVisit.customer.outstandingBalance)}</p>
              <p className="mt-1 text-xs text-slate-500">Checked in {formatTime(activeVisit.checkInAt)}</p>
            </div>
            {activeVisit.verified ? (
              <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">Verified</span>
            ) : (
              <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">Verify</span>
            )}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select value={result} onChange={(e) => setResult(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
              {quickResults.map((item) => <option key={item}>{item}</option>)}
            </select>
            <input value={recoveryAmount} onChange={(e) => setRecoveryAmount(e.target.value)} inputMode="decimal" placeholder="Recovery amount" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <input value={nextFollowupDate} onChange={(e) => setNextFollowupDate(e.target.value)} type="datetime-local" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
            <button type="button" className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600">
              <Camera className="h-5 w-5" />
              Add photo
            </button>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visit notes" className="mt-3 min-h-24 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <button type="button" onClick={checkOut} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 font-semibold text-white">
            <CheckCircle2 className="h-5 w-5" />
            Check Out & Save Visit
          </button>
        </section>
      ) : (
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-lg font-bold">Start Customer Visit</h2>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer name or mobile" className="min-h-12 w-full rounded-lg border py-3 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
            {customers.length > 0 && (
              <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-lg border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {customers.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); setSearch(customer.partyName); setCustomers([]); }} className="flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left last:border-b-0 dark:border-slate-700">
                    <span>
                      <span className="block font-semibold">{customer.partyName}</span>
                      <span className="text-xs text-slate-500">{customer.contactNumber}</span>
                    </span>
                    <span className="text-sm font-bold">{money(customer.outstandingBalance)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Check-in notes" className="mt-3 min-h-20 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <button type="button" onClick={checkIn} disabled={!canCheckIn} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-semibold text-white disabled:opacity-50">
            <MapPin className="h-5 w-5" />
            Check In at Customer
          </button>
        </section>
      )}

      <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5" /> Today Timeline</h2>
        <div className="mt-4 space-y-3">
          {visits.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No visits recorded today.</p>}
          {visits.map((visit) => (
            <div key={visit.id} className="rounded-lg border p-3 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{visit.customer.partyName}</p>
                  <p className="text-xs text-slate-500">{formatTime(visit.checkInAt)} - {formatTime(visit.checkOutAt)}</p>
                  <p className="mt-1 text-sm">{visit.result ?? visit.notes ?? "Visit recorded"}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {visit.verified ? "Geo verified" : "Geo pending"}</span>
                {visit.recoveryAmount > 0 && <span className="flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" /> {money(visit.recoveryAmount)}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
