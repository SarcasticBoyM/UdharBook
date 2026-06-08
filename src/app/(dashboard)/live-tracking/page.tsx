"use client";

import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
    googleMapsUrl?: string;
    googleMapsEmbedUrl?: string;
    stale?: boolean;
    lowAccuracy?: boolean;
    ageMinutes?: number | null;
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

function toCoordinate(value: unknown) {
  const coordinate = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(coordinate) ? coordinate : null;
}

function isValidLatLng(latitude: unknown, longitude: unknown) {
  const lat = toCoordinate(latitude);
  const lng = toCoordinate(longitude);
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

function locationIssue(location: StaffRow["latestLocation"]) {
  if (!location) return "No GPS location";
  if (!isValidLatLng(location.latitude, location.longitude)) return "Invalid GPS coordinates";
  if (location.stale) return "Stale location";
  return null;
}

function mapsUrl(latitude: number, longitude: number) {
  const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
  console.log("[Live Tracking] Google Maps link generated", url);
  return url;
}

function mapsEmbedUrl(latitude: number, longitude: number, zoom = 16) {
  return `https://www.google.com/maps?q=${latitude},${longitude}&z=${zoom}&output=embed`;
}

function accuracyLabel(accuracy?: number | null) {
  if (typeof accuracy !== "number") return "Accuracy unknown";
  return `Accuracy ${Math.round(accuracy)}m`;
}

function accuracyClass(accuracy?: number | null) {
  if (typeof accuracy !== "number") return "bg-slate-100 text-slate-700 border-slate-200";
  if (accuracy <= 50) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (accuracy <= 100) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[Live Tracking] map render failure", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-500">
          Map could not render. Staff list is still available.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function LiveTrackingPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(true);

  const selectedStaff = useMemo(
    () => (selectedStaffId ? staff.find((person) => person.id === selectedStaffId) ?? null : null),
    [staff, selectedStaffId],
  );
  const validStaffLocations = useMemo(
    () => staff.filter((person) => person.latestLocation && isValidLatLng(person.latestLocation.latitude, person.latestLocation.longitude)),
    [staff],
  );
  const invalidLocationCount = staff.length - validStaffLocations.length;
  const selectedLocationValid = Boolean(selectedStaff?.latestLocation && isValidLatLng(selectedStaff.latestLocation.latitude, selectedStaff.latestLocation.longitude));

  const load = useCallback(async () => {
    setLoading(true);
    const params = selectedStaffId ? `?staffId=${selectedStaffId}` : "";
    console.log("[Live Tracking] load start", { mode: selectedStaffId ? "single_staff" : "all_staff", selectedStaffId: selectedStaffId || null });
    try {
      const res = await fetch(`/api/field-staff/locations${params}`);
      const data = await res.json();
      if (data.success) {
        const nextStaff = Array.isArray(data.staff) ? data.staff : [];
        const invalidCount = nextStaff.filter((person: StaffRow) => !person.latestLocation || !isValidLatLng(person.latestLocation.latitude, person.latestLocation.longitude)).length;
        const routePoints = Array.isArray(data.routePoints) ? data.routePoints.filter((point: RoutePoint) => isValidLatLng(point.latitude, point.longitude)) : [];
        console.log("[Live Tracking] load success", {
          mode: selectedStaffId ? "single_staff" : "all_staff",
          totalStaff: nextStaff.length,
          validMarkers: nextStaff.length - invalidCount,
          invalidCoordinates: invalidCount,
          routePoints: routePoints.length,
        });
        setStaff(nextStaff);
        setRoutePoints(routePoints);
      } else {
        console.error("[Live Tracking] load failed", { status: res.status, error: data.error });
      }
    } catch (error) {
      console.error("[Live Tracking] load exception", error);
    } finally {
      setLoading(false);
    }
  }, [selectedStaffId]);

  useEffect(() => {
    const duplicateIds = staff.length - new Set(staff.map((person) => person.id)).size;
    console.log("[Live Tracking] marker diagnostics", {
      mode: selectedStaffId ? "single_staff" : "all_staff",
      selectedStaffId: selectedStaffId || null,
      totalStaff: staff.length,
      validMarkers: validStaffLocations.length,
      invalidCoordinates: invalidLocationCount,
      duplicateIds,
    });
  }, [invalidLocationCount, selectedStaffId, staff, validStaffLocations.length]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

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
          {!online && <p className="mt-1 text-sm font-semibold text-red-600">No internet connection. Showing last loaded locations.</p>}
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

          <div className="relative mt-4 h-[440px] overflow-hidden rounded-lg border bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
            <MapErrorBoundary>
              {selectedStaffId ? (
                selectedStaff && selectedStaff.latestLocation && selectedLocationValid ? (
                  <SingleStaffMap staff={selectedStaff} />
                ) : (
                  <MapEmptyState message={selectedStaff ? `${selectedStaff.name} has no valid live location.` : "Selected staff member was not found."} />
                )
              ) : (
                <AllStaffMap staff={validStaffLocations} invalidCount={invalidLocationCount} totalCount={staff.length} />
              )}
            </MapErrorBoundary>
          </div>

          {selectedStaff?.latestLocation && selectedLocationValid && (
            <a
              href={selectedStaff.latestLocation.googleMapsUrl ?? mapsUrl(selectedStaff.latestLocation.latitude, selectedStaff.latestLocation.longitude)}
              target="_blank"
              rel="noreferrer"
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
              <div
                role="button"
                tabIndex={0}
                key={person.id}
                onClick={() => setSelectedStaffId(person.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedStaffId(person.id);
                }}
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
                  <span>{accuracyLabel(person.latestLocation?.accuracy)}</span>
                  {person.latestLocation?.stale && <span className="font-semibold text-red-600">Stale location</span>}
                  {person.latestLocation?.lowAccuracy && <span className="font-semibold text-amber-700">Low accuracy</span>}
                </div>
                {person.latestLocation && isValidLatLng(person.latestLocation.latitude, person.latestLocation.longitude) && (
                  <a
                    href={person.latestLocation.googleMapsUrl ?? mapsUrl(person.latestLocation.latitude, person.latestLocation.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open in Google Maps
                  </a>
                )}
                {locationIssue(person.latestLocation) && (
                  <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{locationIssue(person.latestLocation)}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Navigation className="h-5 w-5" /> Route Points</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {routePoints.slice(-18).reverse().map((point) => (
            <a key={point.id} target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${point.latitude},${point.longitude}`} className="rounded-lg border p-3 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
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

function MapEmptyState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function SingleStaffMap({ staff }: { staff: StaffRow }) {
  const location = staff.latestLocation;
  if (!location || !isValidLatLng(location.latitude, location.longitude)) {
    return <MapEmptyState message={`${staff.name} has no valid live location.`} />;
  }

  console.log("[Live Tracking] render single marker", {
    staffId: staff.id,
    latitude: location.latitude,
    longitude: location.longitude,
    stale: location.stale,
  });

  return (
    <>
      <iframe
        key={`${staff.id}-${location.createdAt}`}
        title={`Live location for ${staff.name}`}
        src={location.googleMapsEmbedUrl ?? mapsEmbedUrl(location.latitude, location.longitude)}
        className="h-full w-full"
        loading="lazy"
      />
      <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${statusClass[staff.status]}`}>{staff.status.replace("_", " ")}</span>
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${accuracyClass(location.accuracy)}`}>{accuracyLabel(location.accuracy)}</span>
          {location.stale && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-700">Stale</span>}
        </div>
        <p className="mt-2 font-bold">{staff.name}</p>
        <p className="text-slate-500">Updated {timeAgo(location.createdAt)}</p>
        <p className="text-slate-500">{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</p>
      </div>
    </>
  );
}

function markerPosition(staff: StaffRow, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }, singleMarker: boolean) {
  const location = staff.latestLocation;
  if (!location) return { left: 50, top: 50 };
  if (singleMarker) return { left: 50, top: 50 };
  const latRange = Math.max(0.000001, bounds.maxLat - bounds.minLat);
  const lngRange = Math.max(0.000001, bounds.maxLng - bounds.minLng);
  const padding = 10;
  const usable = 100 - padding * 2;
  return {
    left: padding + ((location.longitude - bounds.minLng) / lngRange) * usable,
    top: padding + ((bounds.maxLat - location.latitude) / latRange) * usable,
  };
}

function AllStaffMap({ staff, invalidCount, totalCount }: { staff: StaffRow[]; invalidCount: number; totalCount: number }) {
  if (staff.length === 0) {
    console.warn("[Live Tracking] all staff map empty", { totalStaff: totalCount, invalidCoordinates: invalidCount });
    return <MapEmptyState message="No valid live locations available." />;
  }

  const latitudes = staff.map((person) => person.latestLocation?.latitude).filter((value): value is number => typeof value === "number");
  const longitudes = staff.map((person) => person.latestLocation?.longitude).filter((value): value is number => typeof value === "number");
  const bounds = {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLng: Math.min(...longitudes),
    maxLng: Math.max(...longitudes),
  };
  const center = {
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    longitude: (bounds.minLng + bounds.maxLng) / 2,
  };
  const singleMarker = staff.length === 1;

  console.log("[Live Tracking] render all staff map", {
    totalStaff: totalCount,
    validMarkers: staff.length,
    invalidCoordinates: invalidCount,
    bounds,
    center,
  });

  return (
    <>
      <iframe
        key={`all-staff-${staff.length}-${center.latitude.toFixed(5)}-${center.longitude.toFixed(5)}`}
        title="All staff live locations"
        src={mapsEmbedUrl(center.latitude, center.longitude, singleMarker ? 16 : 13)}
        className="h-full w-full"
        loading="lazy"
      />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-slate-950/10" />
      {staff.map((person, index) => {
        const location = person.latestLocation;
        if (!location) return null;
        const position = markerPosition(person, bounds, singleMarker);
        return (
          <div
            key={`${person.id}-${location.createdAt}`}
            className="pointer-events-auto absolute max-w-[180px] -translate-x-1/2 -translate-y-full rounded-xl border bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
            style={{ left: `${position.left}%`, top: `${position.top}%` }}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-900 dark:text-white">{person.name}</p>
                <p className="truncate text-slate-500">{timeAgo(location.createdAt)}</p>
              </div>
            </div>
          </div>
        );
      })}
      <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-lg border bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <p className="font-bold text-slate-900 dark:text-white">All Staff</p>
        <p className="text-slate-500">{staff.length} valid marker{staff.length === 1 ? "" : "s"} shown</p>
        {invalidCount > 0 && <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">{invalidCount} staff skipped due to invalid/no GPS</p>}
      </div>
    </>
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
