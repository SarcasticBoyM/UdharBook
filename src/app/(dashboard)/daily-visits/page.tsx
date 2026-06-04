"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, Download, Filter, IndianRupee, MapPin, Route } from "lucide-react";

type Visit = {
  id: string;
  status: "CHECKED_IN" | "COMPLETED" | "CANCELLED";
  checkInAt: string;
  checkOutAt: string | null;
  verified: boolean;
  outsideWarning: boolean;
  notes: string | null;
  result: string | null;
  recoveryAmount: number;
  travelKm: number;
  staff: { id: string; name: string; role: string };
  customer: { partyName: string; contactNumber: string; outstandingBalance: number };
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function duration(start: string, end?: string | null) {
  const endTime = end ? new Date(end).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((endTime - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function DailyVisitsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [staffId, setStaffId] = useState("");
  const [loading, setLoading] = useState(false);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    visits.forEach((visit) => map.set(visit.staff.id, visit.staff.name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [visits]);

  const filteredVisits = useMemo(
    () => visits.filter((visit) => !staffId || visit.staff.id === staffId),
    [visits, staffId],
  );

  const summary = {
    total: filteredVisits.length,
    completed: filteredVisits.filter((visit) => visit.status === "COMPLETED").length,
    active: filteredVisits.filter((visit) => visit.status === "CHECKED_IN").length,
    verified: filteredVisits.filter((visit) => visit.verified).length,
    recovery: filteredVisits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
    km: filteredVisits.reduce((sum, visit) => sum + visit.travelKm, 0),
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/field-staff/visits?date=${date}`);
    const data = await res.json();
    setLoading(false);
    if (data.success) setVisits(data.visits);
  }, [date]);

  function exportCsv() {
    const rows = [
      ["Staff", "Customer", "Mobile", "Status", "Check In", "Check Out", "Duration", "Verified", "Recovery", "Notes"],
      ...filteredVisits.map((visit) => [
        visit.staff.name,
        visit.customer.partyName,
        visit.customer.contactNumber,
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
    load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Visit Management</p>
          <h1 className="text-2xl font-bold md:text-3xl">Daily Visits</h1>
          <p className="text-sm text-slate-500">Staff timeline, customer visits, productivity, and recovery outcomes.</p>
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
          <button type="button" onClick={load} className="flex min-h-11 items-center justify-center gap-2 self-end rounded-lg border border-slate-300 px-4 text-sm font-semibold">
            <Filter className="h-4 w-4" />
            Apply
          </button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="Visits" value={summary.total} icon={<CalendarDays className="h-4 w-4" />} />
        <Stat label="Completed" value={summary.completed} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Active" value={summary.active} icon={<Clock className="h-4 w-4" />} />
        <Stat label="Verified" value={summary.verified} icon={<MapPin className="h-4 w-4" />} />
        <Stat label="Recovery" value={money(summary.recovery)} icon={<IndianRupee className="h-4 w-4" />} />
        <Stat label="KM" value={summary.km.toFixed(1)} icon={<Route className="h-4 w-4" />} />
      </div>

      <section className="overflow-hidden rounded-lg border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b p-4 dark:border-slate-700">
          <h2 className="text-lg font-bold">Visit Timeline</h2>
        </div>
        <div className="hidden overflow-auto lg:block">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Check In</th>
                <th className="px-4 py-3">Check Out</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Recovery</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredVisits.map((visit) => (
                <tr key={visit.id} className="border-t dark:border-slate-700">
                  <td className="px-4 py-3 font-medium">{visit.staff.name}</td>
                  <td className="px-4 py-3">
                    <span className="block font-semibold">{visit.customer.partyName}</span>
                    <span className="text-xs text-slate-500">{visit.customer.contactNumber}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
                  </td>
                  <td className="px-4 py-3">{new Date(visit.checkInAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3">{visit.checkOutAt ? new Date(visit.checkOutAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                  <td className="px-4 py-3">{duration(visit.checkInAt, visit.checkOutAt)}</td>
                  <td className="px-4 py-3 font-semibold">{money(visit.recoveryAmount)}</td>
                  <td className="px-4 py-3">{visit.result ?? visit.notes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 p-4 lg:hidden">
          {filteredVisits.map((visit) => (
            <div key={visit.id} className="rounded-lg border p-3 dark:border-slate-700">
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-semibold">{visit.customer.partyName}</p>
                  <p className="text-xs text-slate-500">{visit.staff.name} · {duration(visit.checkInAt, visit.checkOutAt)}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
              </div>
              <p className="mt-2 text-sm">{visit.result ?? visit.notes ?? "Visit recorded"}</p>
              <p className="mt-2 text-sm font-bold">{money(visit.recoveryAmount)}</p>
            </div>
          ))}
        </div>
        {!loading && filteredVisits.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No visits found for this view.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
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
