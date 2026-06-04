"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock, ExternalLink, Map, MapPin, Navigation, RefreshCw, Users } from "lucide-react";

type StaffRow = {
  id: string;
  name: string;
  role: string;
  status: "ACTIVE" | "ON_VISIT" | "IDLE" | "OFFLINE";
  latestLocation: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    createdAt: string;
  } | null;
  openVisit: {
    id: string;
    checkInAt: string;
    customer: { partyName: string; contactNumber: string };
  } | null;
  attendance: { startedAt: string; endedAt: string | null; status: string } | null;
};

type RoutePoint = {
  id: string;
  staffId: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  status: string;
};

const statusClass = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  ON_VISIT: "bg-blue-100 text-blue-800 border-blue-200",
  IDLE: "bg-amber-100 text-amber-800 border-amber-200",
  OFFLINE: "bg-slate-100 text-slate-700 border-slate-200",
};

function timeAgo(value?: string) {
  if (!value) return "No location";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

export default function LiveTrackingPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedStaff = useMemo(
    () => staff.find((person) => person.id === selectedStaffId) ?? staff[0],
    [staff, selectedStaffId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const params = selectedStaffId ? `?staffId=${selectedStaffId}` : "";
    const res = await fetch(`/api/field-staff/locations${params}`);
    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setStaff(data.staff);
      setRoutePoints(data.routePoints ?? []);
    }
  }, [selectedStaffId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  const liveCounts = {
    active: staff.filter((person) => person.status === "ACTIVE").length,
    onVisit: staff.filter((person) => person.status === "ON_VISIT").length,
    idle: staff.filter((person) => person.status === "IDLE").length,
    offline: staff.filter((person) => person.status === "OFFLINE").length,
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Admin Field Control</p>
          <h1 className="text-2xl font-bold md:text-3xl">Live Tracking</h1>
          <p className="text-sm text-slate-500">Current staff positions, open visits, and today route activity.</p>
        </div>
        <button type="button" onClick={load} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active" value={liveCounts.active} icon={<Activity className="h-4 w-4" />} />
        <Stat label="On Visit" value={liveCounts.onVisit} icon={<MapPin className="h-4 w-4" />} />
        <Stat label="Idle" value={liveCounts.idle} icon={<Clock className="h-4 w-4" />} />
        <Stat label="Offline" value={liveCounts.offline} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold"><Map className="h-5 w-5" /> Live Map</h2>
            <select value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="">All staff</option>
              {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </div>

          <div className="relative mt-4 h-[440px] overflow-hidden rounded-lg border bg-[linear-gradient(135deg,#eef2ff,#ecfeff_45%,#f8fafc)] dark:border-slate-700 dark:bg-slate-950">
            <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
            {staff.filter((person) => person.latestLocation).map((person, index) => {
              const left = 12 + ((index * 23) % 76);
              const top = 14 + ((index * 31) % 70);
              return (
                <a
                  key={person.id}
                  href={`https://www.google.com/maps?q=${person.latestLocation?.latitude},${person.latestLocation?.longitude}`}
                  target="_blank"
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white px-3 py-2 text-xs font-semibold shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <span className={`mb-1 inline-flex rounded-full border px-2 py-0.5 ${statusClass[person.status]}`}>{person.status.replace("_", " ")}</span>
                  <span className="block">{person.name}</span>
                  <span className="block text-slate-500">{timeAgo(person.latestLocation?.createdAt)}</span>
                </a>
              );
            })}
            {staff.every((person) => !person.latestLocation) && (
              <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-slate-500">
                No live locations yet. Staff must start tracking from Field Staff screen.
              </div>
            )}
          </div>

          {selectedStaff?.latestLocation && (
            <a
              href={`https://www.google.com/maps?q=${selectedStaff.latestLocation.latitude},${selectedStaff.latestLocation.longitude}`}
              target="_blank"
              className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 text-sm font-semibold"
            >
              <ExternalLink className="h-4 w-4" />
              Open selected staff in Google Maps
            </a>
          )}
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-lg font-bold">Staff Status</h2>
          <div className="mt-4 space-y-3">
            {staff.map((person) => (
              <button
                type="button"
                key={person.id}
                onClick={() => setSelectedStaffId(person.id)}
                className="w-full rounded-lg border p-3 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{person.name}</p>
                    <p className="text-xs text-slate-500">{person.openVisit ? `At ${person.openVisit.customer.partyName}` : timeAgo(person.latestLocation?.createdAt)}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass[person.status]}`}>{person.status.replace("_", " ")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>Started: {person.attendance ? new Date(person.attendance.startedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}</span>
                  <span>Accuracy: {person.latestLocation?.accuracy ? `${Math.round(person.latestLocation.accuracy)}m` : "-"}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Navigation className="h-5 w-5" /> Route Points</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {routePoints.slice(-18).reverse().map((point) => (
            <a key={point.id} target="_blank" href={`https://www.google.com/maps?q=${point.latitude},${point.longitude}`} className="rounded-lg border p-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              <span className="font-semibold">{point.status.replace("_", " ")}</span>
              <span className="ml-2 text-slate-500">{timeAgo(point.createdAt)}</span>
              <span className="mt-1 block text-xs text-slate-500">{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span>
            </a>
          ))}
          {routePoints.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">No route points for this view.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs font-medium">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
