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

const quickResults = ["Follow-up done", "Promise to pay", "Payment collected", "Not available", "Cheque pickup"];
type GpsState = "idle" | "checking" | "prompt" | "active" | "denied" | "timeout" | "unsupported" | "error";

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
  const intervalRef = useRef<number | null>(null);

  const canCheckIn = Boolean(selectedCustomer && !activeVisit && gpsState !== "checking" && gpsState !== "prompt");
  const isSecureGpsContext =
    typeof window === "undefined" ||
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost";

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

  const requestPosition = useCallback((status = "ACTIVE") => {
    console.info("[Field GPS] request started", {
      support: Boolean(navigator.geolocation),
      secureContext: window.isSecureContext,
      host: window.location.hostname,
      protocol: window.location.protocol,
      userAgent: navigator.userAgent,
    });

    if (!navigator.geolocation) {
      console.warn("[Field GPS] geolocation unsupported");
      setGpsState("unsupported");
      setGpsError("Location is not supported on this browser.");
      return Promise.resolve<GeolocationPosition | null>(null);
    }

    if (!window.isSecureContext || !isSecureGpsContext) {
      console.warn("[Field GPS] insecure context blocked geolocation", {
        secureContext: window.isSecureContext,
        href: window.location.href,
      });
      setGpsState("error");
      setGpsError("GPS works only on secure HTTPS production app.qrvcard.in or localhost.");
      return Promise.resolve<GeolocationPosition | null>(null);
    }

    setGpsState("checking");
    setGpsError("");
    setMessage("");

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      console.warn("[Field GPS] permission/location timeout after 10 seconds");
      setGpsState("timeout");
      setGpsError("GPS permission or location request timed out. Try again.");
    }, 10000);

    return new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          settled = true;
          window.clearTimeout(timeoutId);
          console.info("[Field GPS] location captured", {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
          setLocation(position);
          setGpsState("active");
          setGpsError("");
          await sendLocation(position, status).catch((error) => {
            console.error("[Field GPS] location sync failed", error);
            setMessage("GPS captured, but could not sync location.");
          });
          resolve(position);
        },
        (error) => {
          settled = true;
          window.clearTimeout(timeoutId);
          console.error("[Field GPS] geolocation error", {
            code: error.code,
            message: error.message,
          });
          if (error.code === error.PERMISSION_DENIED) {
            setGpsState("denied");
            setGpsError("Location permission blocked. Enable location permission for this site/app.");
          } else if (error.code === error.TIMEOUT) {
            setGpsState("timeout");
            setGpsError("GPS timeout. Move near a window or turn on device location, then retry.");
          } else {
            setGpsState("error");
            setGpsError(error.message || "Could not capture GPS location.");
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }, [isSecureGpsContext, sendLocation]);

  const captureLocation = useCallback(async (status = "ACTIVE") => {
    if (typeof window === "undefined") return null;

    if (!navigator.geolocation) {
      console.warn("[Field GPS] browser support", { geolocation: false });
      setGpsState("unsupported");
      setGpsError("Location is not supported on this browser.");
      return null;
    }

    const permissionsApi = navigator.permissions?.query;
    if (!permissionsApi) {
      console.info("[Field GPS] permissions API unavailable, requesting directly");
      return requestPosition(status);
    }

    try {
      const permission = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      console.info("[Field GPS] permission state", { state: permission.state });

      if (permission.state === "granted") {
        return requestPosition(status);
      }

      if (permission.state === "prompt") {
        setGpsState("prompt");
        return requestPosition(status);
      }

      setGpsState("denied");
      setGpsError("Location permission blocked. Allow location from browser site settings.");
      return null;
    } catch (error) {
      console.warn("[Field GPS] permission query failed, requesting directly", error);
      return requestPosition(status);
    }
  }, [requestPosition]);

  function openLocationSettings() {
    setMessage("Android Chrome: tap the lock icon near the address bar > Permissions > Location > Allow. For installed app, long-press app icon > App info > Permissions > Location.");
  }

  function gpsBadge() {
    if (gpsState === "active") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (gpsState === "denied" || gpsState === "error" || gpsState === "unsupported") return "bg-red-100 text-red-800 border-red-200";
    if (gpsState === "checking" || gpsState === "prompt") return "bg-blue-100 text-blue-800 border-blue-200";
    if (gpsState === "timeout") return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  }

  function gpsLabel() {
    if (gpsState === "active") return "GPS active";
    if (gpsState === "checking") return "Checking GPS";
    if (gpsState === "prompt") return "Allow GPS";
    if (gpsState === "denied") return "GPS blocked";
    if (gpsState === "timeout") return "GPS timeout";
    if (gpsState === "unsupported") return "No GPS support";
    if (gpsState === "error") return "GPS error";
    return "GPS not active";
  }

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
    await captureLocation("ACTIVE");
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
    if (!selectedCustomer || activeVisit) return;
    const currentLocation = location ?? (await captureLocation("ACTIVE"));
    if (!currentLocation) return;
    const res = await fetch("/api/field-staff/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: selectedCustomer.id,
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        accuracy: currentLocation.coords.accuracy,
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
    const position = await captureLocation("ACTIVE");
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
          <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${gpsBadge()}`}>
            {gpsState === "checking" || gpsState === "prompt" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
            {gpsLabel()}
            {location && <span className="font-normal">±{Math.round(location.coords.accuracy)}m</span>}
          </div>
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
            disabled={gpsState === "checking" || gpsState === "prompt"}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {gpsState === "checking" || gpsState === "prompt" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
            {gpsState === "checking" || gpsState === "prompt" ? "GPS..." : "GPS"}
          </button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {gpsError && (
        <div className={`rounded-lg border p-3 text-sm ${gpsState === "denied" || gpsState === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold">{gpsError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => captureLocation(activeVisit ? "ON_VISIT" : "ACTIVE")}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Retry GPS
            </button>
            {(gpsState === "denied" || gpsState === "error") && (
              <button
                type="button"
                onClick={openLocationSettings}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"
              >
                <Settings className="h-4 w-4" />
                Open Settings
              </button>
            )}
          </div>
        </div>
      )}

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
