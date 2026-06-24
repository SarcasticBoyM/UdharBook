"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, MapPin, RefreshCw, RotateCcw, Share2, ShieldOff } from "lucide-react";

type DriverRow = {
  id: string;
  name: string;
  email: string;
  disabled: boolean;
  linkEnabled: boolean;
  trackingLink: string | null;
  trip: {
    status: "ACTIVE" | "ENDED";
    startedAt: string;
    endedAt: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastAccuracy: number | null;
    lastLocationAt: string | null;
    totalDistanceMeters: number;
    pointCount: number;
  } | null;
  currentKm: number;
  todayKm: number;
  tripCountToday: number;
};

type TripLog = {
  id: string;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
  endedAt: string | null;
  totalDistanceMeters: number;
  movingDurationSeconds: number;
  pointCount: number;
  driver: { id: string; name: string };
};

type TripDetail = TripLog & {
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  maxSpeedKmph: number | null;
  avgSpeedKmph: number | null;
  points: {
    lat: number;
    lng: number;
    accuracy: number | null;
    speed: number | null;
    distanceFromPreviousMeters: number | null;
    calculatedSpeedKmph: number | null;
    isDistanceIgnored: boolean;
    ignoreReason: string | null;
    capturedAt: string;
  }[];
};

function timeAgo(value?: string | null) {
  if (!value) return "No location";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

function mapsEmbed(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
}

function km(meters?: number | null) {
  return ((meters ?? 0) / 1000).toFixed(2);
}

function timeLabel(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function durationLabel(seconds?: number | null) {
  const value = Math.max(0, seconds ?? 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function DriverTrackingPage() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [tripLogs, setTripLogs] = useState<TripLog[]>([]);
  const [tripDetail, setTripDetail] = useState<TripDetail | null>(null);

  const selected = useMemo(() => drivers.find((driver) => driver.id === selectedId) ?? drivers[0] ?? null, [drivers, selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/driver/admin/drivers", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      setDrivers(data.drivers ?? []);
      setSelectedId((current) => current || data.drivers?.[0]?.id || "");
    } else {
      setMessage(data.error ?? "Could not load drivers.");
    }
  }, []);

  const loadTripLogs = useCallback(async () => {
    const params = new URLSearchParams({ dateFilter });
    if (selected?.id) params.set("driverId", selected.id);
    const res = await fetch(`/api/driver/trips?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setTripLogs(data.trips ?? []);
  }, [dateFilter, selected?.id]);

  async function viewTripDetail(tripId: string) {
    const res = await fetch(`/api/driver/trips/${tripId}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setTripDetail(data.trip);
    else setMessage(data.error ?? "Could not load trip detail.");
  }

  async function linkAction(driverId: string, action: "REGENERATE" | "REVOKE" | "ENABLE") {
    const res = await fetch("/api/driver/admin/drivers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setDrivers(data.drivers ?? []);
      setMessage(action === "REGENERATE" ? "Tracking link regenerated." : action === "REVOKE" ? "Tracking link revoked." : "Tracking link enabled.");
    } else {
      setMessage(data.error ?? "Could not update tracking link.");
    }
  }

  async function copy(link: string | null) {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setMessage("Tracking link copied.");
  }

  async function share(link: string | null) {
    if (!link) return;
    if (navigator.share) await navigator.share({ title: "Driver live tracking", url: link });
    else await copy(link);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadTripLogs();
  }, [loadTripLogs]);

  const selectedTrip = selected?.trip;
  const hasMap = Boolean(selectedTrip?.lastLat && selectedTrip.lastLng);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-brand-600">Driver Tracking</p>
          <h1 className="text-2xl font-bold">Live Driver Locations</h1>
          <p className="text-sm text-slate-500">Polls while this page is open. Public links are permanent per driver.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{message}</div>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-2">
          {drivers.map((driver) => (
            <button key={driver.id} type="button" onClick={() => setSelectedId(driver.id)} className={`w-full rounded-lg border bg-white p-3 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900 ${selected?.id === driver.id ? "ring-2 ring-brand-500" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{driver.name}</p>
                  <p className="text-xs text-slate-500">{driver.email}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${driver.trip?.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
                  {driver.trip?.status === "ACTIVE" ? "Live" : "Inactive"}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">Updated {timeAgo(driver.trip?.lastLocationAt)}</p>
              <p className="mt-1 text-xs font-semibold text-slate-600">Today {driver.todayKm.toFixed(2)} KM | Current {driver.currentKm.toFixed(2)} KM | {driver.tripCountToday} trips</p>
            </button>
          ))}
          {drivers.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No drivers found. Create a DRIVER in Staff Management.</div>}
        </section>

        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {selected ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <p className="text-sm text-slate-500">{selected.trip?.status === "ACTIVE" ? "Live trip active" : selected.trip ? "Trip ended" : "No trip yet"}</p>
                  <p className="text-sm text-slate-500">Last updated: {timeAgo(selected.trip?.lastLocationAt)}</p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Today KM: {selected.todayKm.toFixed(2)} | Current KM: {selected.currentKm.toFixed(2)} | Trip count: {selected.tripCountToday}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copy(selected.trackingLink)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><Copy className="h-4 w-4" /> Copy</button>
                  <button type="button" onClick={() => void share(selected.trackingLink)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><Share2 className="h-4 w-4" /> Share</button>
                  <button type="button" onClick={() => void linkAction(selected.id, "REGENERATE")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><RotateCcw className="h-4 w-4" /> Regenerate</button>
                  <button type="button" onClick={() => void linkAction(selected.id, selected.linkEnabled ? "REVOKE" : "ENABLE")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><ShieldOff className="h-4 w-4" /> {selected.linkEnabled ? "Revoke" : "Enable"}</button>
                  <button type="button" onClick={() => void loadTripLogs()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold">View Logs</button>
                </div>
              </div>

              <div className="h-[460px] overflow-hidden rounded-lg border bg-slate-100 dark:border-slate-800 dark:bg-slate-950">
                {hasMap && selectedTrip?.lastLat && selectedTrip.lastLng ? (
                  <iframe title={`Location for ${selected.name}`} src={mapsEmbed(selectedTrip.lastLat, selectedTrip.lastLng)} className="h-full w-full" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Location not available yet</div>
                )}
              </div>
              {hasMap && selectedTrip?.lastLat && selectedTrip.lastLng && (
                <a href={`https://www.google.com/maps?q=${selectedTrip.lastLat},${selectedTrip.lastLng}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold">
                  <MapPin className="h-4 w-4" /> Open in Google Maps
                </a>
              )}
              <div className="rounded-lg border p-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold">Trip History</h3>
                  <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="min-h-10 rounded-lg border px-3 text-sm dark:border-slate-700 dark:bg-slate-950">
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last7days">Last 7 Days</option>
                    <option value="thisMonth">This Month</option>
                    <option value="all">All</option>
                  </select>
                </div>
                <div className="mt-3 space-y-2">
                  {tripLogs.map((trip) => (
                    <div key={trip.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-950">
                      <div>
                        <p className="font-semibold">{trip.driver.name} | {timeLabel(trip.startedAt)} - {timeLabel(trip.endedAt)}</p>
                        <p className="text-slate-500">{trip.status} | {km(trip.totalDistanceMeters)} KM | {durationLabel(trip.movingDurationSeconds)} | {trip.pointCount} points</p>
                      </div>
                      <button type="button" onClick={() => void viewTripDetail(trip.id)} className="rounded-lg border px-3 py-2 text-xs font-bold">View Details</button>
                    </div>
                  ))}
                  {tripLogs.length === 0 && <p className="text-sm text-slate-500">No trips found.</p>}
                </div>
              </div>
              {tripDetail && (
                <div className="rounded-lg border p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">Trip Detail</h3>
                      <p className="text-sm text-slate-500">{tripDetail.driver.name} | {km(tripDetail.totalDistanceMeters)} KM | Avg {tripDetail.avgSpeedKmph?.toFixed(1) ?? "-"} km/h | Max {tripDetail.maxSpeedKmph?.toFixed(1) ?? "-"} km/h</p>
                    </div>
                    <button type="button" onClick={() => setTripDetail(null)} className="rounded-lg border px-3 py-2 text-xs font-bold">Close</button>
                  </div>
                  <div className="mt-3 max-h-96 overflow-auto rounded-lg border dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-900">
                        <tr><th className="p-2">Time</th><th className="p-2">Lat</th><th className="p-2">Lng</th><th className="p-2">Accuracy</th><th className="p-2">Speed</th><th className="p-2">Distance</th><th className="p-2">Valid</th><th className="p-2">Reason</th></tr>
                      </thead>
                      <tbody>
                        {tripDetail.points.map((point, index) => (
                          <tr key={`${point.capturedAt}-${index}`} className="border-t dark:border-slate-800">
                            <td className="p-2">{timeLabel(point.capturedAt)}</td>
                            <td className="p-2">{point.lat.toFixed(6)}</td>
                            <td className="p-2">{point.lng.toFixed(6)}</td>
                            <td className="p-2">{point.accuracy ? `${Math.round(point.accuracy)}m` : "-"}</td>
                            <td className="p-2">{point.calculatedSpeedKmph ? `${point.calculatedSpeedKmph.toFixed(1)} km/h` : "-"}</td>
                            <td className="p-2">{point.distanceFromPreviousMeters ? `${Math.round(point.distanceFromPreviousMeters)}m` : "-"}</td>
                            <td className="p-2">{point.isDistanceIgnored ? "Ignored" : "Valid"}</td>
                            <td className="p-2">{point.ignoreReason ?? "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">Select a driver to view live location.</div>
          )}
        </section>
      </div>
    </div>
  );
}
