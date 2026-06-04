"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  RefreshCw,
  Search,
  Settings,
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

type GpsState = "idle" | "checking" | "active" | "denied" | "timeout" | "unsupported" | "error";

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
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsError, setGpsError] = useState("");
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

  const canCheckIn = Boolean(selectedCustomer && !activeVisit && gpsState !== "checking");
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
      setActiveVisit(data.visits.find((visit: Visit) => visit.status === "CHECKED_IN") ?? null);
    }
  }, []);

  function isPwaMode() {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    );
  }

  function runDirectGpsRequest(options?: {
    status?: string;
    onSuccess?: (position: GeolocationPosition) => void | Promise<void>;
  }) {
    console.log("[Field GPS] click triggered");
    console.log("[Field GPS] geolocation supported", Boolean(navigator.geolocation));
    console.log("[Field GPS] PWA mode", isPwaMode());
    console.log("[Field GPS] secure context", {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      host: window.location.hostname,
    });

    if (!navigator.geolocation) {
      console.error("[Field GPS] geolocation not supported");
      setGpsState("unsupported");
      setGpsError("Geolocation not supported");
      alert("Geolocation not supported");
      return;
    }

    if (!window.isSecureContext) {
      console.error("[Field GPS] not secure context", window.location.href);
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
        await sendLocation(position, options?.status ?? "ACTIVE").catch((error) => {
          console.error("[Field GPS] location sync failed", error);
          setMessage("GPS captured, but could not sync location.");
        });
        await options?.onSuccess?.(position);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        console.error("[Field GPS] GPS error", error);
        if (error.code === 1) {
          console.error("[Field GPS] permission denied");
          setGpsState("denied");
          setGpsError("Location permission blocked. Chrome -> lock icon -> Site settings -> Location -> Allow.");
        } else if (error.code === 3) {
          console.error("[Field GPS] timeout");
          setGpsState("timeout");
          setGpsError("GPS timeout. Turn on phone location, move near a window, then retry.");
        } else {
          setGpsState("error");
          setGpsError(error.message || "Could not capture GPS location.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  }

  const requestGPS = () => runDirectGpsRequest({ status: activeVisit ? "ON_VISIT" : "ACTIVE" });
  const forceRequestGPS = () => {
    console.log("[Field GPS] force request button triggered");
    runDirectGpsRequest({ status: activeVisit ? "ON_VISIT" : "ACTIVE" });
  };

  function openLocationSettings() {
    setMessage(
      "Chrome Android: tap the lock icon near the address bar -> Site settings -> Location -> Allow. Installed PWA: long-press app icon -> App info -> Permissions -> Location -> Allow.",
    );
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
    if (!selectedCustomer || activeVisit) return;
    const res = await fetch("/api/field-staff/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: selectedCustomer.id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
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

  function checkIn() {
    if (!selectedCustomer || activeVisit) return;
    console.log("[Field GPS] check-in click triggered");
    runDirectGpsRequest({ status: "ON_VISIT", onSuccess: saveCheckIn });
  }

  function checkOut() {
    if (!activeVisit) return;
    console.log("[Field GPS] check-out click triggered");
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

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

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
          <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${gpsBadge()}`}>
            {gpsState === "checking" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
            {gpsLabel()}
            {location && <span className="font-normal">+/-{Math.round(location.coords.accuracy)}m</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
            onClick={requestGPS}
            disabled={gpsState === "checking"}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {gpsState === "checking" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            {gpsState === "checking" ? "GPS..." : "GPS"}
          </button>
          <button
            type="button"
            onClick={forceRequestGPS}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-brand-300 px-4 py-3 text-sm font-semibold text-brand-700"
          >
            Force Request GPS
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {gpsError && (
        <div className={`rounded-lg border p-3 text-sm ${gpsState === "denied" || gpsState === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold">{gpsError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={forceRequestGPS} className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white">
              <RefreshCw className="h-4 w-4" />
              Retry GPS
            </button>
            {(gpsState === "denied" || gpsState === "error") && (
              <button type="button" onClick={openLocationSettings} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold">
                <Settings className="h-4 w-4" />
                Open Settings
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Visits today" value={summary.visits} />
        <Stat label="Completed" value={summary.completed} />
        <Stat label="Recovered" value={money(summary.recovered)} />
      </div>

      {activeVisit ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-emerald-700">ACTIVE VISIT</p>
              <h2 className="mt-1 text-xl font-bold">{activeVisit.customer.partyName}</h2>
              <p className="text-sm text-slate-600">{activeVisit.customer.contactNumber} - {money(activeVisit.customer.outstandingBalance)}</p>
              <p className="mt-1 text-xs text-slate-500">Checked in {formatTime(activeVisit.checkInAt)}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${activeVisit.verified ? "bg-emerald-600" : "bg-amber-500"}`}>
              {activeVisit.verified ? "Verified" : "Verify"}
            </span>
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
          <button type="button" onClick={checkOut} disabled={gpsState === "checking"} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 font-semibold text-white disabled:opacity-60">
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
