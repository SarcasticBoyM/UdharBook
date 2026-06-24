"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MapPin, RefreshCw } from "lucide-react";

type PublicLocation = {
  success: boolean;
  driverName?: string;
  isActive?: boolean;
  latestPoint?: { lat: number; lng: number; accuracy: number | null; capturedAt: string } | null;
  points?: { lat: number; lng: number; accuracy: number | null; capturedAt: string }[];
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  lastLocationAt: string | null;
  tripStartedAt: string | null;
  tripEndedAt: string | null;
  error?: string;
};

function timeLabel(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function mapsEmbed(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
}

export default function PublicDriverTrackingPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<PublicLocation | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/public/driver-location/${encodeURIComponent(params.token)}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    setData(json);
    setLoading(false);
  }, [params.token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const hasLocation = Boolean(data?.lat && data.lng);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-950">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase text-brand-600">Driver live tracking</p>
              <h1 className="text-2xl font-black">{data?.driverName ?? "Driver"}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {data?.success === false ? data.error : data?.isActive ? "Live" : data ? "Trip ended" : "Loading location"}
              </p>
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
            <span>Last updated: {timeLabel(data?.lastLocationAt)}</span>
            <span>Started: {timeLabel(data?.tripStartedAt)}</span>
            <span>Accuracy: {data?.accuracy ? `${Math.round(data.accuracy)}m` : "-"}</span>
          </div>
          {data?.latestPoint && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-bold">Latest location</p>
              <p>{data.latestPoint.lat.toFixed(6)}, {data.latestPoint.lng.toFixed(6)}</p>
              <p className="text-slate-500">{timeLabel(data.latestPoint.capturedAt)}</p>
            </div>
          )}
        </section>

        <section className="h-[70vh] min-h-[420px] overflow-hidden rounded-xl border bg-white shadow-sm">
          {hasLocation && data?.lat && data.lng ? (
            <iframe title="Driver live location" src={mapsEmbed(data.lat, data.lng)} className="h-full w-full" loading="lazy" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
              <MapPin className="h-8 w-8" />
              <p>{data?.success === false ? data.error : "Location not available yet"}</p>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="font-bold">Location Points</h2>
          <p className="text-sm text-slate-500">Latest {data?.points?.length ?? 0} points with timestamp.</p>
          <div className="mt-3 max-h-96 overflow-auto">
            <div className="space-y-2">
              {(data?.points ?? []).map((point, index) => (
                <div key={`${point.capturedAt}-${index}`} className={`rounded-lg border p-3 text-sm ${index === (data?.points?.length ?? 0) - 1 ? "border-brand-300 bg-brand-50" : ""}`}>
                  <p className="font-semibold">Point {index + 1} | {timeLabel(point.capturedAt)}</p>
                  <p>Lat: {point.lat.toFixed(6)} | Lng: {point.lng.toFixed(6)}</p>
                  <p className="text-slate-500">Accuracy: {point.accuracy ? `${Math.round(point.accuracy)}m` : "-"}</p>
                </div>
              ))}
              {(!data?.points || data.points.length === 0) && <p className="text-sm text-slate-500">No location points available.</p>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
