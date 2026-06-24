"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, MapPin, Play, Share2, Square } from "lucide-react";

type Trip = {
  id: string;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
  endedAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastSpeed?: number | null;
  lastLocationAt: string | null;
  totalDistanceMeters: number;
  movingDurationSeconds: number;
  idleDurationSeconds: number;
  pointCount: number;
  maxSpeedKmph?: number | null;
  avgSpeedKmph?: number | null;
};

type TripPoint = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  distanceFromPreviousMeters: number | null;
  calculatedSpeedKmph: number | null;
  isDistanceIgnored: boolean;
  ignoreReason: string | null;
  capturedAt: string;
};

type DriverMe = {
  driver: { name: string };
  trip: Trip | null;
  trackingLink: string;
  linkEnabled: boolean;
};

function timeLabel(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function km(meters?: number | null) {
  return ((meters ?? 0) / 1000).toFixed(2);
}

function durationLabel(seconds?: number | null) {
  const value = Math.max(0, seconds ?? 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function positionPayload(position: GeolocationPosition) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    speed: position.coords.speed,
    heading: position.coords.heading,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}

export default function DriverTripPage() {
  const [data, setData] = useState<DriverMe | null>(null);
  const [gpsStatus, setGpsStatus] = useState("GPS permission pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentTrips, setRecentTrips] = useState<Trip[]>([]);
  const [detailTrip, setDetailTrip] = useState<(Trip & { points: TripPoint[] }) | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/driver/me", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setData(json);
    else setError(json.error ?? "Could not load driver trip.");
  }, []);

  const loadTrips = useCallback(async () => {
    const res = await fetch("/api/driver/trips?dateFilter=all", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setRecentTrips(json.trips ?? []);
  }, []);

  async function viewTrip(tripId: string) {
    const res = await fetch(`/api/driver/trips/${tripId}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setDetailTrip(json.trip);
    else setError(json.error ?? "Could not load trip detail.");
  }

  const sendLocation = useCallback(async (position: GeolocationPosition, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentRef.current < 5000) return;
    lastSentRef.current = now;
    const payload = positionPayload(position);
    const res = await fetch("/api/driver/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setGpsStatus(`GPS active | Accuracy ${Math.round(payload.accuracy ?? 0)}m | ${timeLabel(payload.capturedAt)}`);
      await load();
    }
  }, [load]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Location is not supported on this device.");
      return;
    }
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setError("");
        void sendLocation(position);
      },
      (geoError) => {
        setGpsStatus("GPS permission pending");
        setError(geoError.code === geoError.PERMISSION_DENIED ? "Location permission required to start trip." : geoError.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }, [sendLocation, stopWatch]);

  async function startTrip() {
    setBusy(true);
    setError("");
    if (!("geolocation" in navigator)) {
      setError("Location is not supported on this device.");
      setBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      const payload = positionPayload(position);
      const res = await fetch("/api/driver/trip/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(json.error ?? "Could not start trip.");
        return;
      }
      setGpsStatus("Live tracking active");
      await sendLocation(position, true);
      startWatch();
      await load();
    }, (geoError) => {
      setBusy(false);
      setError(geoError.code === geoError.PERMISSION_DENIED ? "Location permission required to start trip." : geoError.message);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }

  async function stopTrip() {
    setBusy(true);
    setError("");
    stopWatch();
    const finish = async (payload: Record<string, unknown> = {}) => {
      const res = await fetch("/api/driver/trip/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) setError(json.error ?? "Could not stop trip.");
      else {
      setGpsStatus("Trip ended");
      await load();
      await loadTrips();
      }
    };
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => void finish(positionPayload(position)), () => void finish(), { enableHighAccuracy: true, timeout: 8000 });
    } else {
      await finish();
    }
  }

  async function copyLink() {
    if (!data?.trackingLink) return;
    await navigator.clipboard.writeText(data.trackingLink);
    setGpsStatus("Tracking link copied");
  }

  async function shareLink() {
    if (!data?.trackingLink) return;
    if (navigator.share) {
      await navigator.share({ title: "Driver live tracking", url: data.trackingLink });
    } else {
      await copyLink();
    }
  }

  useEffect(() => {
    void load();
    void loadTrips();
    return stopWatch;
  }, [load, loadTrips, stopWatch]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && data?.trip?.status === "ACTIVE") startWatch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [data?.trip?.status, startWatch]);

  const live = data?.trip?.status === "ACTIVE";

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-28">
      <div>
        <p className="text-xs font-bold uppercase text-brand-600">Driver Trip</p>
        <h1 className="text-2xl font-bold">{data?.driver.name ?? "Driver"}</h1>
        <p className="text-sm text-slate-500">Browser live tracking works best while the app is open or foreground.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

      <section className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500">Trip status</p>
        <p className="mt-1 text-3xl font-black">{live ? "Live" : data?.trip?.status === "ENDED" ? "Ended" : "Not Started"}</p>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span>Location: {gpsStatus}</span>
          <span>Start time: {timeLabel(data?.trip?.startedAt)}</span>
          <span>Current duration: {durationLabel(data?.trip?.movingDurationSeconds)}</span>
          <span>Current trip KM: {km(data?.trip?.totalDistanceMeters)}</span>
          <span>Last updated: {timeLabel(data?.trip?.lastLocationAt)}</span>
          <span>Accuracy: {data?.trip?.lastAccuracy ? `${Math.round(data.trip.lastAccuracy)}m` : "-"}</span>
          <span>Total points: {data?.trip?.pointCount ?? 0}</span>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-bold">Recent Trip Logs</h2>
        <div className="mt-3 space-y-2">
          {recentTrips.slice(0, 10).map((trip) => (
            <div key={trip.id} className="rounded-lg border p-3 text-sm dark:border-slate-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{timeLabel(trip.startedAt)} - {timeLabel(trip.endedAt)}</p>
                  <p className="text-slate-500">{trip.status} | {km(trip.totalDistanceMeters)} KM | {durationLabel(trip.movingDurationSeconds)} | {trip.pointCount} points</p>
                </div>
                <button type="button" onClick={() => void viewTrip(trip.id)} className="rounded-lg border px-3 py-2 text-xs font-bold">View Details</button>
              </div>
            </div>
          ))}
          {recentTrips.length === 0 && <p className="text-sm text-slate-500">No trip logs yet.</p>}
        </div>
      </section>

      {detailTrip && (
        <section className="rounded-xl border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-bold">Trip Detail</h2>
              <p className="text-sm text-slate-500">{km(detailTrip.totalDistanceMeters)} KM | {durationLabel(detailTrip.movingDurationSeconds)} | {detailTrip.pointCount} points</p>
            </div>
            <button type="button" onClick={() => setDetailTrip(null)} className="rounded-lg border px-3 py-2 text-xs font-bold">Close</button>
          </div>
          <div className="mt-3 max-h-80 overflow-auto rounded-lg border dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr><th className="p-2">Time</th><th className="p-2">Lat</th><th className="p-2">Lng</th><th className="p-2">Accuracy</th><th className="p-2">Speed</th><th className="p-2">Distance</th></tr>
              </thead>
              <tbody>
                {detailTrip.points.map((point, index) => (
                  <tr key={`${point.capturedAt}-${index}`} className="border-t dark:border-slate-800">
                    <td className="p-2">{timeLabel(point.capturedAt)}</td>
                    <td className="p-2">{point.lat.toFixed(6)}</td>
                    <td className="p-2">{point.lng.toFixed(6)}</td>
                    <td className="p-2">{point.accuracy ? `${Math.round(point.accuracy)}m` : "-"}</td>
                    <td className="p-2">{point.calculatedSpeedKmph ? `${point.calculatedSpeedKmph.toFixed(1)} km/h` : "-"}</td>
                    <td className="p-2">{point.distanceFromPreviousMeters ? `${Math.round(point.distanceFromPreviousMeters)}m` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={busy || live} onClick={() => void startTrip()} className="inline-flex min-h-16 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-bold text-white disabled:opacity-50">
          {busy && !live ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
          Start Trip
        </button>
        <button type="button" disabled={busy || !live} onClick={() => void stopTrip()} className="inline-flex min-h-16 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-base font-bold text-white disabled:opacity-50">
          <Square className="h-5 w-5" />
          Stop Trip
        </button>
      </div>

      {data?.trip?.lastLat && data.trip.lastLng && (
        <a className="flex min-h-12 items-center justify-center gap-2 rounded-lg border text-sm font-semibold" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${data.trip.lastLat},${data.trip.lastLng}`}>
          <MapPin className="h-4 w-4" />
          Open current location
        </a>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950 md:left-64">
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-2">
          <button type="button" onClick={() => void shareLink()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white">
            <Share2 className="h-4 w-4" /> Share Tracking Link
          </button>
          <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold">
            <Copy className="h-4 w-4" /> Copy Link
          </button>
        </div>
      </div>
    </div>
  );
}
