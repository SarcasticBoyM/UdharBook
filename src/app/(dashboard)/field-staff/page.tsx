"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
  Plus,
  RefreshCw,
  Search,
  Settings,
  UserPlus,
} from "lucide-react";

type CustomerSuggestion = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
  lastFollowupDate: string | null;
  nextFollowupDate: string | null;
  lastVisitDate: string | null;
};

type Visit = {
  id: string;
  status: "CHECKED_IN" | "COMPLETED" | "CANCELLED";
  checkInAt: string;
  checkOutAt: string | null;
  checkInLat?: number;
  checkInLng?: number;
  accuracy?: number | null;
  verified: boolean;
  outsideWarning: boolean;
  notes: string | null;
  result: string | null;
  recoveryAmount: number;
  visitType?: string;
  staff?: { name: string; role: string };
  customer: { id?: string; partyName: string; contactNumber: string; outstandingBalance: number };
  cheques?: {
    id: string;
    chequeNumber: string;
    bankName: string;
    amount: number;
    status: string;
    collectionDateTime: string;
    frontImageUrl: string | null;
  }[];
};

type GpsState = "idle" | "checking" | "active" | "denied" | "timeout" | "unsupported" | "error";

const quickResults = ["Follow-up done", "Promise to pay", "Payment collected", "Not available", "Cheque pickup"];
const visitTypes = ["Collection", "Follow-up", "New Lead", "Complaint", "Cheque Pickup", "Payment Reminder", "Other"];

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function FieldStaffPage() {
  const [tracking, setTracking] = useState(false);
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsError, setGpsError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadMobile, setLeadMobile] = useState("");
  const [leadAddress, setLeadAddress] = useState("");
  const [visitType, setVisitType] = useState("Follow-up");
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState(quickResults[0]);
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [nextFollowupDate, setNextFollowupDate] = useState("");
  const [showChequeFlow, setShowChequeFlow] = useState(false);

  const canCheckIn = Boolean((selectedCustomer || leadName.trim()) && !activeVisit && gpsState !== "checking");
  const showNotFound = search.trim().length > 0 && !searching && customers.length === 0 && !selectedCustomer;
  const summary = useMemo(
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

  const loadVisits = useCallback(async () => {
    const res = await fetch("/api/field-staff/visits");
    const data = await res.json();
    if (data.success) {
      setVisits(data.visits);
      const openVisit = data.visits.find((visit: Visit) => visit.status === "CHECKED_IN") ?? null;
      setActiveVisit(openVisit);
      setShowChequeFlow(openVisit?.visitType === "Cheque Pickup" || openVisit?.result === "Cheque collected");
    }
  }, []);

  function runDirectGpsRequest(options?: {
    status?: string;
    onSuccess?: (position: GeolocationPosition) => void | Promise<void>;
  }) {
    console.log("[Field GPS] click triggered");
    console.log("[Field GPS] geolocation supported", Boolean(navigator.geolocation));
    console.log("[Field GPS] PWA mode", window.matchMedia?.("(display-mode: standalone)").matches);
    console.log("[Field GPS] secure context", window.isSecureContext, window.location.href);

    if (!navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("Geolocation not supported");
      alert("Geolocation not supported");
      return;
    }
    if (!window.isSecureContext) {
      setGpsState("error");
      setGpsError("GPS works only on HTTPS. Open https://app.qrvcard.in");
      return;
    }

    setGpsState("checking");
    setGpsError("");
    setMessage("");
    console.log("[Field GPS] request started");

    const timeoutId = window.setTimeout(() => {
      console.warn("[Field GPS] GPS timeout");
      setGpsState("timeout");
      setGpsError("GPS request timed out. Keep phone location ON and tap Force Request GPS.");
    }, 15000);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        window.clearTimeout(timeoutId);
        console.log("[Field GPS] GPS success", position);
        setLocation(position);
        setGpsState("active");
        setGpsError("");
        await sendLocation(position, options?.status ?? "ACTIVE").catch(() => setMessage("GPS captured, but could not sync location."));
        await options?.onSuccess?.(position);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        console.error("[Field GPS] GPS error", error);
        if (error.code === 1) {
          setGpsState("denied");
          setGpsError("Location permission blocked. Chrome -> lock icon -> Site settings -> Location -> Allow.");
        } else if (error.code === 3) {
          setGpsState("timeout");
          setGpsError("GPS timeout. Turn on phone location, move near a window, then retry.");
        } else {
          setGpsState("error");
          setGpsError(error.message || "Could not capture GPS location.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const requestGPS = () => runDirectGpsRequest({ status: activeVisit ? "ON_VISIT" : "ACTIVE" });
  const forceRequestGPS = () => runDirectGpsRequest({ status: activeVisit ? "ON_VISIT" : "ACTIVE" });

  function openLocationSettings() {
    setMessage("Chrome Android: lock icon -> Site settings -> Location -> Allow. Installed PWA: long-press app icon -> App info -> Permissions -> Location -> Allow.");
  }

  async function startTracking() {
    setTracking(true);
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "START" }),
    });
  }

  async function stopTracking() {
    setTracking(false);
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "STOP" }),
    });
    setMessage("Field tracking stopped.");
  }

  async function saveCheckIn(position: GeolocationPosition) {
    if (!selectedCustomer && !leadName.trim()) return;
    const res = await fetch("/api/field-staff/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.partyName ?? leadName.trim(),
        mobileNumber: selectedCustomer?.contactNumber ?? leadMobile,
        address: leadAddress || undefined,
        visitType,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        notes,
        recoveryAmount: Number(recoveryAmount || 0),
        nextFollowupDate: nextFollowupDate ? new Date(nextFollowupDate).toISOString() : undefined,
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
    setShowNewVisit(false);
    setLeadName("");
    setLeadMobile("");
    setLeadAddress("");
    setNotes("");
    await loadVisits();
  }

  function checkIn() {
    if (!canCheckIn) return;
    runDirectGpsRequest({ status: "ON_VISIT", onSuccess: saveCheckIn });
  }

  function checkOut() {
    if (!activeVisit) return;
    runDirectGpsRequest({
      status: "ACTIVE",
      onSuccess: async (position) => {
        const res = await fetch(`/api/field-staff/visits/${activeVisit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "CHECK_OUT",
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
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
      },
    });
  }

  function startNewVisit(prefill = search) {
    setShowNewVisit(true);
    setSelectedCustomer(null);
    setLeadName(prefill.trim());
    setVisitType("New Lead");
  }

  function applyChip(chip: string) {
    if (chip === "New Visit") {
      startNewVisit("");
      return;
    }
    setSearch(chip);
  }

  function gpsBadge() {
    if (gpsState === "active") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (gpsState === "denied" || gpsState === "error" || gpsState === "unsupported") return "bg-red-100 text-red-800 border-red-200";
    if (gpsState === "checking") return "bg-blue-100 text-blue-800 border-blue-200";
    if (gpsState === "timeout") return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  }

  function gpsLabel() {
    if (gpsState === "active") return "GPS active";
    if (gpsState === "checking") return "Requesting GPS";
    if (gpsState === "denied") return "GPS blocked";
    if (gpsState === "timeout") return "GPS timeout";
    if (gpsState === "unsupported") return "No GPS support";
    if (gpsState === "error") return "GPS error";
    return "GPS not active";
  }

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const query = search.trim();
      if (query.length < 1) {
        setCustomers([]);
        return;
      }
      setSearching(true);
      const res = await fetch(`/api/customers/search?q=${encodeURIComponent(query)}&limit=10`);
      const data = await res.json();
      setCustomers(data.customers ?? []);
      setSearching(false);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-28">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Field Operations</p>
          <h1 className="text-2xl font-bold md:text-3xl">Field Staff</h1>
          <p className="text-sm text-slate-500">Search customer or start a new visit instantly.</p>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${gpsBadge()}`}>
            {gpsState === "checking" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
            {gpsLabel()}
            {location && <span className="font-normal">+/-{Math.round(location.coords.accuracy)}m</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={tracking ? stopTracking : startTracking} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white md:flex-none">
            {tracking ? <PauseCircle className="h-5 w-5" /> : <Navigation className="h-5 w-5" />}
            {tracking ? "Stop Day" : "Start Day"}
          </button>
          <button type="button" onClick={requestGPS} disabled={gpsState === "checking"} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-60">
            {gpsState === "checking" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            GPS
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {gpsError && (
        <div className={`rounded-lg border p-3 text-sm ${gpsState === "denied" || gpsState === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold">{gpsError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={forceRequestGPS} className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white"><RefreshCw className="h-4 w-4" /> Force Request GPS</button>
            {(gpsState === "denied" || gpsState === "error") && <button type="button" onClick={openLocationSettings} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"><Settings className="h-4 w-4" /> Open Settings</button>}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Visits today" value={summary.visits} />
        <Stat label="Completed" value={summary.completed} />
        <Stat label="Recovered" value={money(summary.recovered)} />
      </div>

      {activeVisit ? (
        <ActiveVisitCard
          visit={activeVisit}
          notes={notes}
          result={result}
          recoveryAmount={recoveryAmount}
          nextFollowupDate={nextFollowupDate}
          gpsChecking={gpsState === "checking"}
          onNotes={setNotes}
          onResult={setResult}
          onRecovery={setRecoveryAmount}
          onNextFollowup={setNextFollowupDate}
          onCheckOut={checkOut}
          showChequeFlow={showChequeFlow}
          onToggleChequeFlow={setShowChequeFlow}
          onSavedCheque={loadVisits}
        />
      ) : (
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Start Customer Visit</h2>
            <button type="button" onClick={() => startNewVisit("")} className="flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> New Visit
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {["Recent Customers", "Pending Recovery", "Today Follow-ups", "High Amount", "New Visit"].map((chip) => (
              <button key={chip} type="button" onClick={() => applyChip(chip)} className="shrink-0 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">
                {chip}
              </button>
            ))}
          </div>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setSelectedCustomer(null); }} placeholder="Search customer, business, or mobile" className="min-h-12 w-full rounded-lg border py-3 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900" />
            {(customers.length > 0 || searching) && (
              <div className="absolute z-20 mt-2 max-h-96 w-full overflow-auto rounded-lg border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {searching && <p className="p-4 text-sm text-slate-500">Searching...</p>}
                {customers.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); setSearch(customer.partyName); setCustomers([]); setShowNewVisit(false); }} className="w-full border-b px-4 py-3 text-left last:border-b-0 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{customer.partyName}</p>
                        <p className="text-xs text-slate-500">{customer.contactNumber}</p>
                      </div>
                      <p className="text-sm font-bold">{money(customer.outstandingBalance)}</p>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                      <span>Last follow-up: {formatDateTime(customer.lastFollowupDate)}</span>
                      <span>Next: {formatDateTime(customer.nextFollowupDate)}</span>
                      <span>Last visit: {formatDateTime(customer.lastVisitDate)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCustomer && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-bold">{selectedCustomer.partyName}</p>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <span>Balance: {money(selectedCustomer.outstandingBalance)}</span>
                <span>Last follow-up: {formatDateTime(selectedCustomer.lastFollowupDate)}</span>
                <span>Next follow-up: {formatDateTime(selectedCustomer.nextFollowupDate)}</span>
                <span>Last visit: {formatDateTime(selectedCustomer.lastVisitDate)}</span>
              </div>
            </div>
          )}

          {showNotFound && (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-center">
              <p className="font-semibold">Customer not found</p>
              <button type="button" onClick={() => startNewVisit(search)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
                <UserPlus className="h-4 w-4" /> Start New Visit
              </button>
            </div>
          )}

          {showNewVisit && (
            <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-900 dark:bg-brand-950/20">
              <h3 className="font-bold">New Visit</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Customer name *" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadMobile} onChange={(e) => setLeadMobile(e.target.value)} inputMode="tel" placeholder="Mobile number" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadAddress} onChange={(e) => setLeadAddress(e.target.value)} placeholder="Address/location" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <select value={visitType} onChange={(e) => setVisitType(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
                  {visitTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
                <input value={recoveryAmount} onChange={(e) => setRecoveryAmount(e.target.value)} inputMode="decimal" placeholder="Recovery amount" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={nextFollowupDate} onChange={(e) => setNextFollowupDate(e.target.value)} type="datetime-local" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
              </div>
            </div>
          )}

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visit notes" className="mt-3 min-h-20 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          <div className="sticky bottom-3 z-10 mt-3">
            <button type="button" onClick={checkIn} disabled={!canCheckIn} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-semibold text-white shadow-lg disabled:opacity-50">
              <MapPin className="h-5 w-5" /> Check In at Customer
            </button>
          </div>
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
                  <p className="text-xs text-slate-500">{formatDateTime(visit.checkInAt)} · {visit.staff?.name ?? "Staff"}</p>
                  <p className="mt-1 text-sm line-clamp-2">{visit.result ?? visit.notes ?? "Visit recorded"}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {visit.verified ? "GPS captured" : "GPS saved"}</span>
                <span>{visit.visitType ?? "Visit"}</span>
                {visit.recoveryAmount > 0 && <span className="flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" /> {money(visit.recoveryAmount)}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActiveVisitCard({
  visit,
  notes,
  result,
  recoveryAmount,
  nextFollowupDate,
  gpsChecking,
  onNotes,
  onResult,
  onRecovery,
  onNextFollowup,
  onCheckOut,
  showChequeFlow,
  onToggleChequeFlow,
  onSavedCheque,
}: {
  visit: Visit;
  notes: string;
  result: string;
  recoveryAmount: string;
  nextFollowupDate: string;
  gpsChecking: boolean;
  onNotes: (value: string) => void;
  onResult: (value: string) => void;
  onRecovery: (value: string) => void;
  onNextFollowup: (value: string) => void;
  onCheckOut: () => void;
  showChequeFlow: boolean;
  onToggleChequeFlow: (value: boolean) => void;
  onSavedCheque: () => void;
}) {
  const latestCheque = visit.cheques?.[0];
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-emerald-700">ACTIVE VISIT</p>
          <h2 className="mt-1 text-xl font-bold">{visit.customer.partyName}</h2>
          <p className="text-sm text-slate-600">{visit.customer.contactNumber} - {money(visit.customer.outstandingBalance)}</p>
          <p className="mt-1 text-xs text-slate-500">Checked in {formatDateTime(visit.checkInAt)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${visit.verified ? "bg-emerald-600" : "bg-amber-500"}`}>
          {visit.verified ? "Verified" : "GPS saved"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select value={result} onChange={(e) => onResult(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
          {quickResults.map((item) => <option key={item}>{item}</option>)}
        </select>
        <input value={recoveryAmount} onChange={(e) => onRecovery(e.target.value)} inputMode="decimal" placeholder="Recovery amount" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
        <input value={nextFollowupDate} onChange={(e) => onNextFollowup(e.target.value)} type="datetime-local" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600">
          <Camera className="h-5 w-5" /> Add photo
        </button>
      </div>
      {latestCheque && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3 text-sm shadow-sm dark:border-emerald-900 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase text-emerald-700">Collected Cheque</p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="font-bold">{latestCheque.chequeNumber} · {latestCheque.bankName}</p>
              <p className="text-xs text-slate-500">{formatDateTime(latestCheque.collectionDateTime)}</p>
            </div>
            <div className="text-right">
              <p className="font-bold">{money(latestCheque.amount)}</p>
              <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{latestCheque.status}</span>
            </div>
          </div>
        </div>
      )}
      {(result === "Cheque pickup" || result === "Cheque pickup" || result === "Cheque Pickup" || visit.visitType === "Cheque Pickup") && (
        <button
          type="button"
          onClick={() => onToggleChequeFlow(!showChequeFlow)}
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white"
        >
          {showChequeFlow ? "Hide Cheque Collection" : "Open Cheque Collection"}
        </button>
      )}
      {showChequeFlow && (
        <VisitChequeCollection
          visit={visit}
          onSaved={onSavedCheque}
        />
      )}
      <textarea value={notes} onChange={(e) => onNotes(e.target.value)} placeholder="Visit notes" className="mt-3 min-h-24 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      <button type="button" onClick={onCheckOut} disabled={gpsChecking} className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60">
        <CheckCircle2 className="h-5 w-5" /> Check Out & Save Visit
      </button>
    </section>
  );
}

function VisitChequeCollection({ visit, onSaved }: { visit: Visit; onSaved: () => void }) {
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [form, setForm] = useState({
    chequeNumber: "",
    amount: "",
    bankName: "",
    branch: "",
    chequeDate: "",
    accountHolderName: visit.customer.partyName,
    notes: "",
    micrCode: "",
    ifscCode: "",
    ocrRawText: "",
  });

  const canSave =
    Boolean(visit.customer.id) &&
    form.chequeNumber.trim() &&
    Number(form.amount) > 0 &&
    form.bankName.trim() &&
    form.chequeDate &&
    form.accountHolderName.trim();

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleImage(file?: File) {
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      const value = String(reader.result || "");
      setImageDataUrl(value);
      await scan(value);
    };
    reader.readAsDataURL(file);
  }

  function normalizeDate(value?: string) {
    if (!value) return "";
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (!match) return "";
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  async function scan(image: string) {
    setScanning(true);
    const res = await fetch("/api/cheques/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: image }),
    });
    const result = await res.json();
    setScanning(false);
    setConfidence(result.confidence ?? 0);
    if (!result.ok) {
      setError(result.warning ?? "Could not detect all cheque details. Please verify manually.");
    }
    setForm((current) => ({
      ...current,
      chequeNumber: result.fields?.chequeNumber ?? current.chequeNumber,
      amount: result.fields?.amount ? String(result.fields.amount) : current.amount,
      bankName: result.fields?.bankName ?? current.bankName,
      branch: result.fields?.branch ?? current.branch,
      chequeDate: normalizeDate(result.fields?.chequeDate) || current.chequeDate,
      accountHolderName: result.fields?.accountHolderName ?? current.accountHolderName,
      micrCode: result.fields?.micrCode ?? current.micrCode,
      ifscCode: result.fields?.ifscCode ?? current.ifscCode,
      ocrRawText: result.rawText ?? current.ocrRawText,
    }));
  }

  async function saveCheque() {
    if (!canSave || !visit.customer.id) {
      setError("Please complete cheque number, amount, bank, date, and account holder.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/cheques", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: visit.customer.id,
        staffVisitId: visit.id,
        chequeNumber: form.chequeNumber.trim(),
        bankName: form.bankName.trim(),
        branch: form.branch || undefined,
        chequeDate: new Date(`${form.chequeDate}T00:00:00`).toISOString(),
        amount: Number(form.amount),
        accountHolderName: form.accountHolderName.trim(),
        collectionDateTime: new Date().toISOString(),
        collectionNotes: form.notes || `Collected during field visit ${visit.id}`,
        frontImageUrl: imageDataUrl || undefined,
        micrCode: form.micrCode || undefined,
        ifscCode: form.ifscCode || undefined,
        ocrRawText: form.ocrRawText || undefined,
        ocrConfidence: confidence ?? undefined,
        collectionLatitude: visit.checkInLat,
        collectionLongitude: visit.checkInLng,
        collectionAccuracy: visit.accuracy ?? undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save cheque.");
      return;
    }
    setForm({
      chequeNumber: "",
      amount: "",
      bankName: "",
      branch: "",
      chequeDate: "",
      accountHolderName: visit.customer.partyName,
      notes: "",
      micrCode: "",
      ifscCode: "",
      ocrRawText: "",
    });
    setImageDataUrl("");
    onSaved();
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-600">Cheque Collection</p>
          <h3 className="font-bold">{visit.customer.partyName}</h3>
          <p className="text-xs text-slate-500">{visit.customer.contactNumber} · Balance {money(visit.customer.outstandingBalance)}</p>
        </div>
        {confidence !== null && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">OCR {Math.round(confidence * 100)}%</span>}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white">
          <Camera className="h-4 w-4" /> Camera
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold">
          Upload from Gallery
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
        </label>
      </div>
      {imageDataUrl && (
        <div className="relative mt-3 h-52 w-full overflow-hidden rounded-lg border bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
          <Image src={imageDataUrl} alt="Cheque preview" fill unoptimized className="object-contain" />
        </div>
      )}
      {scanning && <p className="mt-2 text-sm text-blue-700">Scanning cheque...</p>}
      {error && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{error}</p>}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Input label="Cheque number" value={form.chequeNumber} onChange={(value) => setField("chequeNumber", value)} required />
        <Input label="Amount" value={form.amount} onChange={(value) => setField("amount", value)} inputMode="decimal" required />
        <Input label="Bank" value={form.bankName} onChange={(value) => setField("bankName", value)} required />
        <Input label="Branch" value={form.branch} onChange={(value) => setField("branch", value)} />
        <Input label="Cheque date" type="date" value={form.chequeDate} onChange={(value) => setField("chequeDate", value)} required />
        <Input label="Account holder" value={form.accountHolderName} onChange={(value) => setField("accountHolderName", value)} required />
        <Input label="MICR" value={form.micrCode} onChange={(value) => setField("micrCode", value)} />
        <Input label="IFSC" value={form.ifscCode} onChange={(value) => setField("ifscCode", value)} />
      </div>
      <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Cheque notes" className="mt-3 min-h-20 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      <button type="button" onClick={saveCheque} disabled={saving || !canSave} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? "Saving cheque..." : "Save Cheque to Recovery Desk"}
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  inputMode?: "decimal" | "numeric" | "tel";
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}{required ? " *" : ""}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
