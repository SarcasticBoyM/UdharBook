"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { MapplsLiveMap } from "@/components/maps/MapplsLiveMap";

type Driver = { id: string; name: string };
type Route = { id: string; name: string; description?: string | null; startPointName?: string | null; endPointName?: string | null; isActive: boolean };
type LinkRow = { id: string; token: string; isEnabled: boolean; routeId?: string | null; route?: { name: string } | null };
type Vehicle = { id: string; name: string; vehicleNumber?: string | null; driverId?: string | null; driver?: Driver | null; isActive: boolean; trackingLinks: LinkRow[] };
type Trip = { id: string; status: string; lastLatitude: number | null; lastLongitude: number | null; lastAccuracyM: number | null; lastHeading: number | null; lastLocationAt: string | null; vehicle: { name: string; vehicleNumber: string | null }; route: { name: string } | null; driver: { name: string } };

const LIVE_POLL_MS = 45_000;

export default function SchoolTransportPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [busy, setBusy] = useState(false);
  const [staticLoading, setStaticLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [vform, setVform] = useState({ name: "", vehicleNumber: "", driverId: "" });
  const [rform, setRform] = useState({ name: "", startPointName: "", endPointName: "", description: "" });
  const liveAbortRef = useRef<AbortController | null>(null);

  const loadStatic = useCallback(async () => {
    setStaticLoading(true);
    try {
      const [vehicleResponse, routeResponse] = await Promise.all([
        fetch("/api/school-transport/vehicles", { cache: "no-store" }),
        fetch("/api/school-transport/routes", { cache: "no-store" }),
      ]);
      const [vehicleData, routeData] = await Promise.all([
        vehicleResponse.json().catch(() => ({})),
        routeResponse.json().catch(() => ({})),
      ]);
      if (vehicleResponse.ok) {
        setVehicles(vehicleData.vehicles ?? []);
        setDrivers(vehicleData.drivers ?? []);
      }
      if (routeResponse.ok) setRoutes(routeData.routes ?? []);
    } finally {
      setStaticLoading(false);
    }
  }, []);

  const loadLive = useCallback(async (showLoading = false) => {
    if (document.visibilityState === "hidden") return;
    liveAbortRef.current?.abort();
    const controller = new AbortController();
    liveAbortRef.current = controller;
    if (showLoading) setLiveLoading(true);
    try {
      const response = await fetch("/api/school-transport/live", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok && !controller.signal.aborted) setTrips(data.trips ?? []);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage("Could not refresh live van locations.");
    } finally {
      if (liveAbortRef.current === controller) {
        liveAbortRef.current = null;
        setLiveLoading(false);
      }
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStatic(), loadLive(true)]);
  }, [loadLive, loadStatic]);

  useEffect(() => {
    void loadStatic();
    void loadLive(true);
    const interval = window.setInterval(() => void loadLive(false), LIVE_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") liveAbortRef.current?.abort();
      else void loadLive(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      liveAbortRef.current?.abort();
    };
  }, [loadLive, loadStatic]);

  async function send(url: string, body?: unknown, method = "POST") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error ?? "Action failed.");
        return null;
      }
      await refreshAll();
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function addVehicle(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/school-transport/vehicles", vform)) {
      setVform({ name: "", vehicleNumber: "", driverId: "" });
      setMessage("Vehicle saved.");
    }
  }

  async function addRoute(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/school-transport/routes", rform)) {
      setRform({ name: "", startPointName: "", endPointName: "", description: "" });
      setMessage("Route saved.");
    }
  }

  async function editVehicle(vehicle: Vehicle) {
    const name = prompt("Vehicle name", vehicle.name);
    if (!name) return;
    const vehicleNumber = prompt("Vehicle number", vehicle.vehicleNumber ?? "");
    const driverName = prompt("Assigned driver name (blank to unassign)", vehicle.driver?.name ?? "")?.trim() ?? "";
    const driver = drivers.find((item) => item.name.toLowerCase() === driverName.toLowerCase());
    if (driverName && !driver) {
      setMessage("Select an existing School Driver name.");
      return;
    }
    const isActive = confirm("Keep this vehicle active?");
    await send(`/api/school-transport/vehicles/${vehicle.id}`, { name, vehicleNumber, driverId: driver?.id ?? null, isActive }, "PATCH");
  }

  async function editRoute(route: Route) {
    const name = prompt("Route name", route.name);
    if (!name) return;
    const startPointName = prompt("Start point", route.startPointName ?? "");
    const endPointName = prompt("End point", route.endPointName ?? "");
    const description = prompt("Description", route.description ?? "");
    const isActive = confirm("Keep this route active?");
    await send(`/api/school-transport/routes/${route.id}`, { name, startPointName, endPointName, description, isActive }, "PATCH");
  }

  async function createLink(vehicleId: string) {
    const routeName = prompt("Route name for this parent link (blank for any route)", routes[0]?.name ?? "")?.trim() ?? "";
    const route = routes.find((item) => item.name.toLowerCase() === routeName.toLowerCase());
    if (routeName && !route) {
      setMessage("Route name was not found.");
      return;
    }
    await send("/api/school-transport/links", { vehicleId, routeId: route?.id ?? null });
  }

  const mapPoints = useMemo(() => trips
    .filter((trip) => trip.lastLatitude != null && trip.lastLongitude != null)
    .map((trip) => ({ latitude: trip.lastLatitude!, longitude: trip.lastLongitude!, accuracyM: trip.lastAccuracyM, heading: trip.lastHeading, vehicleName: trip.vehicle.name, routeName: trip.route?.name, lastLocationAt: trip.lastLocationAt })), [trips]);

  return <div className="space-y-6">
    <div><p className="text-xs font-bold uppercase text-brand-600">Premium Module</p><h1 className="text-2xl font-bold">School Van Live Tracking</h1><p className="text-sm text-slate-500">Manage vans, routes, parent links and active school trips.</p></div>
    {message && <div className="rounded-lg border p-3 text-sm">{message}</div>}
    <div className="grid gap-4 xl:grid-cols-2">
      <form onSubmit={addVehicle} className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-bold">Add School Vehicle</h2><input required placeholder="Van name" value={vform.name} onChange={(event) => setVform({ ...vform, name: event.target.value })} className="min-h-11 w-full rounded-lg border px-3"/><input placeholder="Vehicle number" value={vform.vehicleNumber} onChange={(event) => setVform({ ...vform, vehicleNumber: event.target.value })} className="min-h-11 w-full rounded-lg border px-3"/><select value={vform.driverId} onChange={(event) => setVform({ ...vform, driverId: event.target.value })} className="min-h-11 w-full rounded-lg border px-3"><option value="">Unassigned driver</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select><button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">Save Vehicle</button></form>
      <form onSubmit={addRoute} className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-bold">Add School Route</h2><input required placeholder="Route name" value={rform.name} onChange={(event) => setRform({ ...rform, name: event.target.value })} className="min-h-11 w-full rounded-lg border px-3"/><div className="grid grid-cols-2 gap-2"><input placeholder="Start point" value={rform.startPointName} onChange={(event) => setRform({ ...rform, startPointName: event.target.value })} className="min-h-11 rounded-lg border px-3"/><input placeholder="End point" value={rform.endPointName} onChange={(event) => setRform({ ...rform, endPointName: event.target.value })} className="min-h-11 rounded-lg border px-3"/></div><textarea placeholder="Description" value={rform.description} onChange={(event) => setRform({ ...rform, description: event.target.value })} className="w-full rounded-lg border p-3"/><button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">Save Route</button></form>
    </div>
    <section className="space-y-3"><h2 className="text-lg font-bold">Vehicles & Parent Links</h2>{staticLoading && vehicles.length === 0 ? <div className="space-y-2">{[1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div> : vehicles.map((vehicle) => <article key={vehicle.id} className="rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap justify-between gap-2"><div><b>{vehicle.name}</b> <span className="text-sm text-slate-500">{vehicle.vehicleNumber} · {vehicle.driver?.name ?? "Unassigned"}</span></div><button onClick={() => void editVehicle(vehicle)} className="rounded border px-3 py-1 text-xs">Edit</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void createLink(vehicle.id)} className="rounded border px-3 py-2 text-xs font-semibold"><Link2 className="mr-1 inline h-3 w-3"/>Create Parent Link</button>{vehicle.trackingLinks.map((link) => <span key={link.id} className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-2 text-xs dark:bg-slate-800"><button onClick={() => navigator.clipboard.writeText(`${location.origin}/school-track/${link.token}`)}><Copy className="h-3 w-3"/></button>{link.route?.name ?? "Any route"}<button onClick={() => void send(`/api/school-transport/links/${link.id}/regenerate`)}><RefreshCw className="h-3 w-3"/></button><button onClick={() => void send(`/api/school-transport/links/${link.id}/${link.isEnabled ? "disable" : "enable"}`)}>{link.isEnabled ? "Disable" : "Enable"}</button></span>)}</div></article>)}</section>
    <section className="space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Active Vans</h2><p className="text-xs text-slate-500">Live locations refresh every 45 seconds while this tab is visible.</p></div><button type="button" onClick={() => void loadLive(true)} disabled={liveLoading} aria-label="Refresh live van locations">{liveLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}</button></div>{liveLoading && trips.length === 0 ? <div className="h-[380px] animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" /> : <MapplsLiveMap latitude={mapPoints[0]?.latitude} longitude={mapPoints[0]?.longitude} isLive locations={mapPoints} height="380px"/>}<div className="grid gap-3 md:grid-cols-2">{trips.map((trip) => <div key={trip.id} className="rounded-xl border p-3 text-sm"><b>{trip.vehicle.name}</b><p>{trip.route?.name ?? "No route"} · {trip.driver.name}</p><p className="text-slate-500">Last updated {trip.lastLocationAt ? new Date(trip.lastLocationAt).toLocaleTimeString() : "waiting for GPS"} · {trip.lastAccuracyM ? `${Math.round(trip.lastAccuracyM)}m` : "-"}</p></div>)}</div></section>
    <section><h2 className="font-bold">Routes</h2>{routes.map((route) => <button key={route.id} onClick={() => void editRoute(route)} className="mr-2 mt-2 rounded-lg border px-3 py-2 text-sm">{route.name} · Edit</button>)}</section>
  </div>;
}
