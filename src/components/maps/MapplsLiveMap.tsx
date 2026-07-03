"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { loadMapplsSdk } from "@/lib/maps/mappls";
import { mapplsOpenUrl } from "@/lib/maps/provider";

type Point = { latitude: number; longitude: number; accuracyM?: number | null; heading?: number | null; vehicleName?: string; routeName?: string; lastLocationAt?: string | null };
type Position = { lat: number; lng: number };
type MapLike = { setCenter?: (position: Position | [number, number]) => void; resize?: () => void; invalidateSize?: () => void; remove?: () => void };
type MarkerLike = { setPosition?: (position: Position) => void; remove?: () => void };
type MapplsGlobal = { Map: new (id: string, options: Record<string, unknown>) => MapLike; Marker: new (options: Record<string, unknown>) => MarkerLike };

const MISSING_KEY = "Mappls map key is missing. Add NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY in Vercel and redeploy.";

function isValidPoint(point: Point) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}

function safeMapError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Mappls error";
  if (process.env.NODE_ENV !== "production") console.error("Mappls map error:", error);
  if (message.includes("SDK script failed")) return "SDK script failed";
  if (message.includes("SDK object not found")) return "Mappls SDK object not found after load";
  return "SDK script failed";
}

export function MapplsLiveMap({ latitude, longitude, accuracyM, heading, vehicleName, routeName, lastLocationAt, isLive, height = "320px", autoCenter = true, locations }: { latitude?: number | null; longitude?: number | null; accuracyM?: number | null; heading?: number | null; vehicleName?: string; routeName?: string; lastLocationAt?: string | null; isLive: boolean; height?: string; autoCenter?: boolean; showAccuracyCircle?: boolean; showPopup?: boolean; locations?: Point[] }) {
  const id = `mappls-${useId().replace(/:/g, "")}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLike | null>(null);
  const markersRef = useRef<MarkerLike[]>([]);
  const [error, setError] = useState("");
  const key = process.env.NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY;
  const suppliedPoints = useMemo(() => locations?.length ? locations : latitude != null && longitude != null ? [{ latitude, longitude, accuracyM, heading, vehicleName, routeName, lastLocationAt }] : [], [locations, latitude, longitude, accuracyM, heading, vehicleName, routeName, lastLocationAt]);
  const points = useMemo(() => suppliedPoints.filter(isValidPoint), [suppliedPoints]);
  const locationMissing = points.length === 0;

  useEffect(() => {
    if (!key || locationMissing || !containerRef.current) return;
    let cancelled = false;
    loadMapplsSdk(key).then(() => {
      if (cancelled || !containerRef.current) return;
      const sdk = (window as Window & { mappls?: MapplsGlobal }).mappls;
      if (!sdk?.Map || !sdk?.Marker) throw new Error("Mappls SDK object not found after load");
      const first = points[0];
      if (!mapRef.current) mapRef.current = new sdk.Map(id, { center: [first.latitude, first.longitude], zoom: 15 });

      if (markersRef.current.length === points.length && markersRef.current.every((marker) => marker.setPosition)) {
        markersRef.current.forEach((marker, index) => marker.setPosition?.({ lat: points[index].latitude, lng: points[index].longitude }));
      } else {
        markersRef.current.forEach((marker) => marker.remove?.());
        markersRef.current = points.map((point) => {
          const base = { map: mapRef.current, position: { lat: point.latitude, lng: point.longitude }, fitbounds: points.length > 1, popupHtml: `<strong>${escapeHtml(point.vehicleName ?? "School Van")}</strong><br/>${escapeHtml(point.routeName ?? "")}` };
          try {
            return new sdk.Marker({ ...base, icon_url: "/icons/school-van-marker.svg", width: 44, height: 44, rotation: point.heading ?? 0 });
          } catch (markerError) {
            if (process.env.NODE_ENV !== "production") console.error("Mappls custom marker error; using default marker:", markerError);
            return new sdk.Marker(base);
          }
        });
      }
      if (autoCenter && points.length === 1) mapRef.current.setCenter?.({ lat: first.latitude, lng: first.longitude });
      window.requestAnimationFrame(() => {
        mapRef.current?.resize?.();
        mapRef.current?.invalidateSize?.();
      });
      setError("");
    }).catch((caught) => {
      if (!cancelled) setError(safeMapError(caught));
    });
    return () => { cancelled = true; };
  }, [id, key, locationMissing, autoCenter, points]);

  useEffect(() => () => {
    markersRef.current.forEach((marker) => marker.remove?.());
    mapRef.current?.remove?.();
  }, []);

  if (locationMissing) return <div className="flex min-h-[320px] items-center justify-center rounded-xl border bg-slate-50 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900" style={{ height }}>Location not available yet</div>;
  const first = points[0];
  const reason = !key ? MISSING_KEY : error;
  return <div className="space-y-2"><div className="relative min-h-[260px] overflow-hidden rounded-xl border dark:border-slate-800" style={{ height, minHeight: "260px" }}><div ref={containerRef} id={id} className="h-full min-h-[260px] w-full" />{reason && <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100/95 p-4 text-center text-sm dark:bg-slate-900/95"><p className="font-semibold">Map could not load.</p><p className="mt-1">{reason}</p><p className="mt-2 font-mono text-xs">{first.latitude.toFixed(6)}, {first.longitude.toFixed(6)}</p></div>}{!isLive && <span className="absolute right-2 top-2 rounded-full bg-slate-700 px-2 py-1 text-xs font-bold text-white">Stale</span>}</div><a href={mapplsOpenUrl(first.latitude, first.longitude)} target="_blank" rel="noreferrer" className="inline-flex text-xs font-semibold text-brand-700">Open in Mappls</a></div>;
}
