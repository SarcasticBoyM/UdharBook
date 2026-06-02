"use client";

import { useState } from "react";
import { Download } from "lucide-react";

const reports = [
  { type: "outstanding", label: "Outstanding Report" },
  { type: "follow-up", label: "Follow-up Report" },
  { type: "aging", label: "Customer Aging Report" },
];

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const download = (type: string, format: "xlsx" | "csv") => {
    const params = new URLSearchParams({ format });
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    window.open(`/api/reports/${type}?${params}`, "_blank");
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="text-slate-500">Export outstanding, follow-up, and aging data</p>

      <div className="card mt-6 max-w-md space-y-4">
        <p className="text-sm font-medium">Date range (follow-up report only)</p>
        <div className="flex gap-3">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {reports.map((r) => (
          <div key={r.type} className="card">
            <h3 className="font-semibold">{r.label}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => download(r.type, "xlsx")}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white"
              >
                <Download className="h-4 w-4" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => download(r.type, "csv")}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm dark:border-slate-600"
              >
                <Download className="h-4 w-4" />
                CSV
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        PDF export: use CSV and print to PDF from Excel, or add puppeteer later for native PDF.
      </p>
    </div>
  );
}
