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
  } | null;
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

export default function DriverTrackingPage() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copy(selected.trackingLink)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><Copy className="h-4 w-4" /> Copy</button>
                  <button type="button" onClick={() => void share(selected.trackingLink)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><Share2 className="h-4 w-4" /> Share</button>
                  <button type="button" onClick={() => void linkAction(selected.id, "REGENERATE")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><RotateCcw className="h-4 w-4" /> Regenerate</button>
                  <button type="button" onClick={() => void linkAction(selected.id, selected.linkEnabled ? "REVOKE" : "ENABLE")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold"><ShieldOff className="h-4 w-4" /> {selected.linkEnabled ? "Revoke" : "Enable"}</button>
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
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">Select a driver to view live location.</div>
          )}
        </section>
      </div>
    </div>
  );
}
