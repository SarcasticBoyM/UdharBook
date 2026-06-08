"use client";

import { useState } from "react";
import type { ImportSummary } from "@/types";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError("");
    setSummary(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/customers/import", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
          const data = await res.json();
          message = data.error ?? message;
        } catch {
          /* non-JSON body */
        }
        if (res.status === 504) {
          message = "Upload timed out while importing. The server may still be processing a very large file; try again with a smaller batch if this repeats.";
        }
        setError(message);
        return;
      }

      setSummary(await res.json());
    } catch (err) {
      const hint =
        file.size > 1024 * 1024
          ? " Try a smaller file or restart the dev server (npm run dev)."
          : "";
      setError(
        (err instanceof Error ? err.message : "Failed to fetch") +
          ". Ensure the dev server is running and you are logged in." +
          hint
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadErrors = () => {
    if (!summary?.errors.length) return;
    const csv = [
      "Row,Error",
      ...summary.errors.map((err) => `${err.row},"${err.message.replace(/"/g, '""')}"`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "udharbook-import-errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold">Upload Excel</h1>
      <p className="mt-1 text-slate-500">
        Columns: <strong>Customer Name</strong> (or Party Name),{" "}
        <strong>Contact Number</strong>, <strong>Outstanding Balance</strong>.
        Matches by contact first, then by name if contact is empty.
      </p>

      <form onSubmit={upload} className="card mt-6">
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
        <p className="mt-2 text-xs text-slate-500">
          Existing customers are updated; new rows are created with Pending status. Empty rows
          (no name and no contact) are ignored.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!file || loading}
          className="mt-4 rounded-lg bg-brand-600 px-6 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import"}
        </button>
      </form>

      {summary && (
        <div className="card mt-6">
          <h2 className="font-semibold">Import Summary</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Total rows processed</dt>
              <dd className="text-2xl font-bold">{summary.totalProcessed}</dd>
            </div>
            <div>
              <dt className="text-slate-500">New customers created</dt>
              <dd className="text-2xl font-bold text-emerald-600">{summary.created}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Existing customers updated</dt>
              <dd className="text-2xl font-bold text-brand-600">{summary.updated}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Invalid rows skipped</dt>
              <dd className="text-2xl font-bold text-amber-600">{summary.skipped}</dd>
            </div>
          </dl>
          {summary.errors.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h3 className="text-sm font-medium text-red-600">Validation errors</h3>
              <button
                type="button"
                onClick={downloadErrors}
                className="mt-2 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
              >
                Download error report
              </button>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-700 dark:text-red-400">
                {summary.errors.map((err, i) => (
                  <li key={i}>
                    Row {err.row}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
