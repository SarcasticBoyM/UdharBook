"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  Filter,
  IndianRupee,
  ListChecks,
  Map as MapIcon,
  Route,
  Sparkles,
} from "lucide-react";

type Visit = {
  id: string;
  status: "CHECKED_IN" | "COMPLETED" | "CANCELLED";
  checkInAt: string;
  checkOutAt: string | null;
  checkInLat: number;
  checkInLng: number;
  checkOutLat: number | null;
  checkOutLng: number | null;
  verified: boolean;
  outsideWarning: boolean;
  notes: string | null;
  result: string | null;
  visitType: string;
  outcome: string | null;
  paymentMode: string | null;
  recoveryAmount: number;
  travelKm: number;
  orderProductCategory: string | null;
  staff: { id: string; name: string; role: string };
  customer: { partyName: string; contactNumber: string; outstandingBalance: number };
  cheques?: { id: string; amount: number; status: string }[];
};

type RoutePoint = {
  id: string;
  staffId: string;
  latitude: number;
  longitude: number;
  status: string;
  source: string | null;
  createdAt: string;
};

type ViewMode = "timeline" | "map";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function duration(start: string, end?: string | null) {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((endTime - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function durationMinutes(start: string, end?: string | null) {
  const endTime = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endTime - new Date(start).getTime()) / 60000));
}

function time(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function isOrderVisit(visit: Visit) {
  return ["Sales Visit", "New Lead Visit", "Prospect Visit"].includes(visit.visitType) && visit.outcome === "Order Received";
}

function isProductive(visit: Visit) {
  return visit.status === "COMPLETED" && !["Customer unavailable", "No response", "Customer Busy"].includes(visit.outcome ?? visit.result ?? "");
}

function visitTone(visit: Visit) {
  if (isOrderVisit(visit)) return { fill: "#16a34a", stroke: "#14532d", label: "Order Received" };
  if (visit.cheques?.length || visit.paymentMode === "Cheque Collected") return { fill: "#7c3aed", stroke: "#4c1d95", label: "Cheque" };
  if (visit.visitType.includes("Recovery") || visit.visitType.includes("Payment") || visit.recoveryAmount > 0) return { fill: "#dc2626", stroke: "#7f1d1d", label: "Recovery" };
  if (visit.visitType.includes("Lead") || visit.visitType.includes("Prospect")) return { fill: "#0891b2", stroke: "#164e63", label: "Lead" };
  if (visit.visitType.includes("Complaint")) return { fill: "#ea580c", stroke: "#7c2d12", label: "Complaint" };
  if (visit.visitType.includes("Sales")) return { fill: "#2563eb", stroke: "#1e3a8a", label: "Sales" };
  return { fill: "#475569", stroke: "#0f172a", label: "Visit" };
}

function notesSummary(visit: Visit) {
  return (visit.result ?? visit.outcome ?? visit.notes ?? "Visit recorded").slice(0, 80);
}

function toPoint(visit: Visit) {
  return { lat: visit.checkInLat, lng: visit.checkInLng };
}

function canUsePoint(point: { lat: number; lng: number }) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

function groupByStaff<T extends { staffId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    const items = map.get(row.staffId) ?? [];
    items.push(row);
    map.set(row.staffId, items);
  });
  return Array.from(map.values());
}

export default function DailyVisitsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [staffId, setStaffId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  const canViewRouteMap = role === "SHOP_ADMIN";

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    visits.forEach((visit) => map.set(visit.staff.id, visit.staff.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [visits]);

  const filteredVisits = useMemo(
    () => visits.filter((visit) => !staffId || visit.staff.id === staffId),
    [visits, staffId],
  );

  const filteredRoutePoints = useMemo(
    () => routePoints.filter((point) => !staffId || point.staffId === staffId),
    [routePoints, staffId],
  );

  const orderedVisits = useMemo(
    () => [...filteredVisits].sort((a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime()),
    [filteredVisits],
  );

  const insight = useMemo(() => productivityInsights(orderedVisits), [orderedVisits]);

  const summary = {
    total: filteredVisits.length,
    completed: filteredVisits.filter((visit) => visit.status === "COMPLETED").length,
    active: filteredVisits.filter((visit) => visit.status === "CHECKED_IN").length,
    verified: filteredVisits.filter((visit) => visit.verified).length,
    productive: filteredVisits.filter(isProductive).length,
    orders: filteredVisits.filter(isOrderVisit).length,
    recovery: filteredVisits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
    km: filteredVisits.reduce((sum, visit) => sum + visit.travelKm, 0),
    timeSpent: filteredVisits.reduce((sum, visit) => sum + durationMinutes(visit.checkInAt, visit.checkOutAt), 0),
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/field-staff/visits?date=${date}`);
    const data = await res.json();
    setLoading(false);
    if (data.success) setVisits(data.visits);
  }, [date]);

  const loadRoutePoints = useCallback(async () => {
    if (!canViewRouteMap) {
      setRoutePoints([]);
      return;
    }
    const params = new URLSearchParams({ date });
    if (staffId) params.set("staffId", staffId);
    const res = await fetch(`/api/field-staff/locations?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (data.success) setRoutePoints(data.routePoints ?? []);
  }, [canViewRouteMap, date, staffId]);

  function exportCsv() {
    const rows = [
      ["Staff", "Customer", "Mobile", "Visit Type", "Status", "Check In", "Check Out", "Duration", "Verified", "Recovery", "Notes"],
      ...filteredVisits.map((visit) => [
        visit.staff.name,
        visit.customer.partyName,
        visit.customer.contactNumber,
        visit.visitType,
        visit.status,
        new Date(visit.checkInAt).toISOString(),
        visit.checkOutAt ? new Date(visit.checkOutAt).toISOString() : "",
        duration(visit.checkInAt, visit.checkOutAt),
        visit.verified ? "Yes" : "No",
        String(visit.recoveryAmount),
        visit.result ?? visit.notes ?? "",
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvEscape).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-visits-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRole(data?.user?.role ?? ""))
      .catch(() => setRole(""));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRoutePoints();
  }, [loadRoutePoints]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Visit Management</p>
          <h1 className="text-2xl font-bold md:text-3xl">Daily Visits</h1>
          <p className="text-sm text-slate-500">Staff timeline, route map, productivity, and recovery outcomes.</p>
        </div>
        <button type="button" onClick={exportCsv} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Date</span>
            <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Staff</span>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="min-h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
              <option value="">All staff</option>
              {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => { void load(); void loadRoutePoints(); }} className="flex min-h-11 items-center justify-center gap-2 self-end rounded-lg border border-slate-300 px-4 text-sm font-semibold">
            <Filter className="h-4 w-4" />
            Apply
          </button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="Visits" value={summary.total} icon={<CalendarDays className="h-4 w-4" />} />
        <Stat label="Productive" value={summary.productive} icon={<Sparkles className="h-4 w-4" />} />
        <Stat label="Completed" value={summary.completed} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Orders" value={summary.orders} icon={<ListChecks className="h-4 w-4" />} />
        <Stat label="Recovery" value={money(summary.recovery)} icon={<IndianRupee className="h-4 w-4" />} />
        <Stat label="KM" value={summary.km.toFixed(1)} icon={<Route className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Insight label="Time spent" value={formatMinutes(summary.timeSpent)} />
        <Insight label="Average visit" value={formatMinutes(insight.averageDuration)} />
        <Insight label="First visit" value={insight.firstVisit ? time(insight.firstVisit) : "-"} />
        <Insight label="Longest idle gap" value={formatMinutes(insight.longestIdleGap)} />
      </div>

      <section className="overflow-hidden rounded-lg border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b p-4 dark:border-slate-700 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold">Visit Route Timeline</h2>
            <p className="mt-1 text-sm text-slate-500">
              {canViewRouteMap ? "Switch between business timeline and map route visualization." : "Timeline view is available for this role."}
            </p>
          </div>
          <div className="inline-flex rounded-lg border bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800">
            <TabButton active={viewMode === "timeline"} onClick={() => setViewMode("timeline")} icon={<ListChecks className="h-4 w-4" />} label="Timeline View" />
            {canViewRouteMap && <TabButton active={viewMode === "map"} onClick={() => setViewMode("map")} icon={<MapIcon className="h-4 w-4" />} label="Map View" />}
          </div>
        </div>

        {viewMode === "map" && canViewRouteMap ? (
          <RouteMap visits={orderedVisits} routePoints={filteredRoutePoints} />
        ) : (
          <Timeline visits={filteredVisits} loading={loading} />
        )}
      </section>
    </div>
  );
}

function Timeline({ visits, loading }: { visits: Visit[]; loading: boolean }) {
  return (
    <>
      <div className="hidden overflow-auto lg:block">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Visit</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Check In</th>
              <th className="px-4 py-3">Check Out</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Recovery</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((visit) => (
              <tr key={visit.id} className="border-t dark:border-slate-700">
                <td className="px-4 py-3 font-medium">{visit.staff.name}</td>
                <td className="px-4 py-3">
                  <span className="block font-semibold">{visit.customer.partyName}</span>
                  <span className="text-xs text-slate-500">{visit.customer.contactNumber}</span>
                </td>
                <td className="px-4 py-3">{visit.visitType}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
                </td>
                <td className="px-4 py-3">{time(visit.checkInAt)}</td>
                <td className="px-4 py-3">{time(visit.checkOutAt)}</td>
                <td className="px-4 py-3">{duration(visit.checkInAt, visit.checkOutAt)}</td>
                <td className="px-4 py-3 font-semibold">{money(visit.recoveryAmount)}</td>
                <td className="px-4 py-3">{notesSummary(visit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-4 lg:hidden">
        {visits.map((visit, index) => (
          <div key={visit.id} className="rounded-lg border p-3 dark:border-slate-700">
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-semibold">{index + 1}. {visit.customer.partyName}</p>
                <p className="text-xs text-slate-500">{visit.staff.name} | {visit.visitType} | {duration(visit.checkInAt, visit.checkOutAt)}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
            </div>
            <p className="mt-2 text-sm">{notesSummary(visit)}</p>
            <p className="mt-2 text-sm font-bold">{money(visit.recoveryAmount)}</p>
          </div>
        ))}
      </div>
      {!loading && visits.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No visits found for this view.</p>}
    </>
  );
}

function RouteMap({ visits, routePoints }: { visits: Visit[]; routePoints: RoutePoint[] }) {
  const visitPoints = visits.map(toPoint).filter(canUsePoint);
  const gpsPoints = routePoints.map((point) => ({ lat: point.latitude, lng: point.longitude })).filter(canUsePoint);
  const allPoints = [...visitPoints, ...gpsPoints];

  if (allPoints.length === 0) {
    return <p className="p-8 text-center text-sm text-slate-500">No GPS coordinates are available for this day.</p>;
  }

  const project = createProjector(allPoints);
  const visitPolyline = visits.map((visit) => project(toPoint(visit))).filter(Boolean) as { x: number; y: number }[];
  const routeGroups = groupByStaff(routePoints)
    .map((points) => points.map((point) => project({ lat: point.latitude, lng: point.longitude })).filter(Boolean) as { x: number; y: number }[])
    .filter((points) => points.length > 1);

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-h-[420px] overflow-hidden rounded-lg border bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
        <svg viewBox="0 0 100 100" className="h-[420px] w-full md:h-[520px]" role="img" aria-label="Daily visit route map">
          <defs>
            <pattern id="map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#cbd5e1" strokeWidth="0.18" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#map-grid)" />
          <text x="4" y="8" className="fill-slate-500 text-[3px] font-semibold">Route Map</text>
          {routeGroups.map((points, index) => (
            <polyline
              key={`route-${index}`}
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="#64748b"
              strokeDasharray="1.3 1"
              strokeWidth="0.8"
              opacity="0.75"
            />
          ))}
          {visitPolyline.length > 1 && (
            <polyline
              points={visitPolyline.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="#0f172a"
              strokeWidth="1.15"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.88"
            />
          )}
          {visits.map((visit, index) => {
            const point = project(toPoint(visit));
            if (!point) return null;
            const tone = visitTone(visit);
            return (
              <g key={visit.id}>
                <title>{`${index + 1}. ${visit.customer.partyName} | ${time(visit.checkInAt)} | ${visit.visitType} | ${notesSummary(visit)} | ${duration(visit.checkInAt, visit.checkOutAt)}`}</title>
                <circle cx={point.x} cy={point.y} r="3.1" fill={tone.fill} stroke={tone.stroke} strokeWidth="0.55" />
                <text x={point.x} y={point.y + 1.15} textAnchor="middle" className="fill-white text-[2.9px] font-bold">{index + 1}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border p-4 dark:border-slate-700">
          <h3 className="font-bold">Visit Markers</h3>
          <div className="mt-3 max-h-[420px] space-y-3 overflow-auto pr-1">
            {visits.map((visit, index) => {
              const tone = visitTone(visit);
              return (
                <div key={visit.id} className="rounded-lg border p-3 text-sm dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: tone.fill }}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className="font-semibold">{visit.customer.partyName}</p>
                      <p className="text-xs text-slate-500">{time(visit.checkInAt)} - {time(visit.checkOutAt)} | {duration(visit.checkInAt, visit.checkOutAt)}</p>
                      <p className="mt-1 text-xs font-semibold" style={{ color: tone.fill }}>{tone.label}</p>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{notesSummary(visit)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {isOrderVisit(visit) && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">Order received</span>}
                    {visit.recoveryAmount > 0 && <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">{money(visit.recoveryAmount)}</span>}
                    {visit.cheques?.length ? <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-800">Cheque</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

function createProjector(points: { lat: number; lng: number }[]) {
  const padding = 7;
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLng = Math.min(...points.map((point) => point.lng));
  const maxLng = Math.max(...points.map((point) => point.lng));
  const latRange = Math.max(maxLat - minLat, 0.0001);
  const lngRange = Math.max(maxLng - minLng, 0.0001);
  return (point: { lat: number; lng: number }) => {
    if (!canUsePoint(point)) return null;
    return {
      x: padding + ((point.lng - minLng) / lngRange) * (100 - padding * 2),
      y: padding + ((maxLat - point.lat) / latRange) * (100 - padding * 2),
    };
  };
}

function productivityInsights(visits: Visit[]) {
  const completed = visits.filter((visit) => visit.checkOutAt);
  const averageDuration = completed.length
    ? Math.round(completed.reduce((sum, visit) => sum + durationMinutes(visit.checkInAt, visit.checkOutAt), 0) / completed.length)
    : 0;
  let longestIdleGap = 0;
  groupByStaff(visits.map((visit) => ({ ...visit, staffId: visit.staff.id }))).forEach((staffVisits) => {
    const ordered = staffVisits.sort((a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime());
    for (let index = 1; index < ordered.length; index += 1) {
      const previousOut = ordered[index - 1].checkOutAt;
      if (!previousOut) continue;
      const gap = Math.max(0, Math.round((new Date(ordered[index].checkInAt).getTime() - new Date(previousOut).getTime()) / 60000));
      longestIdleGap = Math.max(longestIdleGap, gap);
    }
  });
  return {
    averageDuration,
    longestIdleGap,
    firstVisit: visits[0]?.checkInAt ?? null,
    lastVisit: visits[visits.length - 1]?.checkInAt ?? null,
  };
}

function formatMinutes(minutes: number) {
  if (!minutes) return "0m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold ${active ? "bg-white text-brand-700 shadow-sm dark:bg-slate-950 dark:text-brand-300" : "text-slate-600 dark:text-slate-300"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-xs font-medium">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
