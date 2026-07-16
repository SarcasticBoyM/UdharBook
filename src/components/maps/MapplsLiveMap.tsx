"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { loadMapplsSdk } from "@/lib/maps/mappls";
import { mapplsOpenUrl } from "@/lib/maps/provider";

type Point = { latitude: number; longitude: number; accuracyM?: number | null; heading?: number | null; vehicleName?: string; routeName?: string; lastLocationAt?: string | null };
type Position = { lat: number; lng: number };
type MapLike = { setCenter?: (position: Position | [number, number]) => void; resize?: () => void; invalidateSize?: () => void; remove?: () => void };
type MarkerLike = { setPosition?: (position: Position) => void; remove?: () => void };
type MapplsGlobal = { Map: new (id: string, options: Record<string, unknown>) => MapLike; Marker: new (options: Record<string, unknown>) => MarkerLike };

const MISSING_KEY = "Mappls browser configuration is missing. Add NEXT_PUBLIC_MAPPLS_MAP_SDK_KEY, then restart locally or redeploy.";

function isValidPoint(point: Point) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}

function safeMapError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Mappls error";
  console.error("[Mappls] Map initialization failed:", error);
  if (message === "MAPPLS_KEY_MISSING") return MISSING_KEY;
  if (message === "MAPPLS_GLOBAL_UNAVAILABLE") return "The Mappls SDK loaded but did not initialize. Verify that Web Maps is enabled for the key.";
  if (message === "MAPPLS_SCRIPT_BLOCKED_OR_FAILED") return "The Mappls SDK was blocked or could not load.";
  return "The Mappls map could not initialize. You can still open the coordinates below.";
}

function openStreetMapEmbedUrl(latitude: number, longitude: number) {
  const latitudeDelta = 0.012;
  const longitudeDelta = 0.018;
  const bbox = [
    longitude - longitudeDelta,
    latitude - latitudeDelta,
    longitude + longitudeDelta,
    latitude + latitudeDelta,
  ].map((value) => value.toFixed(6)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function openStreetMapUrl(latitude: number, longitude: number) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=16/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
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
    if (locationMissing) return;
    let cancelled = false;
    loadMapplsSdk(key).then((loadedSdk) => {
      if (cancelled || !containerRef.current) return;
      const sdk = loadedSdk as MapplsGlobal;
      if (!sdk?.Map || !sdk?.Marker) {
        console.error("[Mappls] window.mappls/window.Mappls is missing Map or Marker after SDK load.");
        throw new Error("MAPPLS_GLOBAL_UNAVAILABLE");
      }
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
  return (
    <div className="space-y-2">
      <div className="relative min-h-[260px] overflow-hidden rounded-xl border bg-slate-100 dark:border-slate-800 dark:bg-slate-900" style={{ height, minHeight: "260px" }}>
        {reason ? (
          <div className="flex h-full min-h-[260px] flex-col">
            <div className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-slate-700 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-semibold">Live map provider could not load. Showing fallback location view.</p>
              <p className="mt-0.5 opacity-80">{reason}</p>
            </div>
            <iframe
              title={`Fallback map for ${first.vehicleName ?? "school van"}`}
              src={openStreetMapEmbedUrl(first.latitude, first.longitude)}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="min-h-[210px] w-full flex-1 border-0"
            />
          </div>
        ) : (
          <div ref={containerRef} id={id} className="h-full min-h-[260px] w-full" />
        )}
        {!isLive && <span className="absolute right-2 top-2 rounded-full bg-slate-700 px-2 py-1 text-xs font-bold text-white">Stale</span>}
      </div>
      {reason && (
        <div className="grid gap-2 sm:grid-cols-2">
          {points.map((point, index) => (
            <div key={`${point.latitude}-${point.longitude}-${index}`} className="rounded-lg border px-3 py-2 text-xs dark:border-slate-800">
              <p className="font-semibold">{point.vehicleName ?? (points.length > 1 ? `School Van ${index + 1}` : "School Van")}</p>
              {point.routeName && <p className="text-slate-500">{point.routeName}</p>}
              <p className="mt-1 font-mono">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</p>
              <a href={openStreetMapUrl(point.latitude, point.longitude)} target="_blank" rel="noreferrer" className="mt-1 inline-flex font-semibold text-brand-700">Open fallback map</a>
            </div>
          ))}
        </div>
      )}
      <a href={mapplsOpenUrl(first.latitude, first.longitude)} target="_blank" rel="noreferrer" className="inline-flex text-xs font-semibold text-brand-700">Open in Mappls</a>
    </div>
  );
}
