"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImportSummary } from "@/types";

function normalizeBatchTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 40);
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [firmConfirmation, setFirmConfirmation] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [showTagOptions, setShowTagOptions] = useState(false);
  const normalizedTag = normalizeBatchTag(batchTag);
  const normalizedConfirmation = normalizeBatchTag(firmConfirmation);
  const normalizedQuery = normalizeBatchTag(tagQuery || batchTag);
  const visibleTags = useMemo(() => {
    const query = normalizedQuery.toLowerCase();
    return existingTags.filter((tag) => !query || tag.toLowerCase().includes(query)).slice(0, 8);
  }, [existingTags, normalizedQuery]);
  const canCreateTag = Boolean(normalizedQuery && !existingTags.includes(normalizedQuery));

  useEffect(() => {
    let alive = true;
    fetch("/api/customers/batch-tags", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { tags?: string[] } | null) => {
        if (alive) setExistingTags(payload?.tags ?? []);
      })
      .catch(() => {
        if (alive) setExistingTags([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !normalizedTag) return;
    if (normalizedConfirmation !== normalizedTag) {
      setError(`Type ${normalizedTag} to confirm this upload belongs to the selected Batch / Firm.`);
      return;
    }
    setLoading(true);
    setError("");
    setSummary(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("batchTag", normalizedTag);
    formData.append("batchTagConfirmation", normalizedConfirmation);

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

      const result = await res.json();
      setSummary(result);
      if (result.batchTag && !existingTags.includes(result.batchTag)) {
        setExistingTags((current) => [...current, result.batchTag].sort((a, b) => a.localeCompare(b)));
      }
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
        Add a Batch / Firm tag first, then upload customer balances for that ledger.
      </p>

      <form onSubmit={upload} className="card mt-6">
        <label className="mb-4 block">
          <span className="text-sm font-semibold">Batch / Firm Name</span>
          <div className="relative mt-2">
            <input
              value={tagQuery || batchTag}
              onChange={(event) => {
                setTagQuery(event.target.value);
                setBatchTag(event.target.value);
                setFirmConfirmation("");
                setShowTagOptions(true);
              }}
              onFocus={() => setShowTagOptions(true)}
              onBlur={() => {
                window.setTimeout(() => setShowTagOptions(false), 150);
                setBatchTag((current) => normalizeBatchTag(current));
                setTagQuery("");
              }}
              placeholder="Search or create: YE, BT, CEMENT"
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm uppercase dark:border-slate-700 dark:bg-slate-900"
              maxLength={40}
              required
            />
            {showTagOptions && (visibleTags.length > 0 || canCreateTag) && (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-950">
                {visibleTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setBatchTag(tag);
                      setFirmConfirmation("");
                      setTagQuery("");
                      setShowTagOptions(false);
                    }}
                    className="flex min-h-10 w-full items-center rounded-md px-3 text-left font-semibold hover:bg-slate-100 dark:hover:bg-slate-900"
                  >
                    {tag}
                  </button>
                ))}
                {canCreateTag && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setBatchTag(normalizedQuery);
                      setFirmConfirmation("");
                      setTagQuery("");
                      setShowTagOptions(false);
                    }}
                    className="flex min-h-10 w-full items-center rounded-md px-3 text-left font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-slate-900"
                  >
                    Create &quot;{normalizedQuery}&quot;
                  </button>
                )}
              </div>
            )}
          </div>
          {existingTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {existingTags.slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setBatchTag(tag);
                    setFirmConfirmation("");
                    setTagQuery("");
                  }}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold dark:border-slate-700"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </label>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
        <p className="mt-2 text-xs text-slate-500">
          Existing customers are updated by name; new rows are created with Pending status. Empty rows
          with no usable data are ignored. Matching is scoped to the Batch / Firm tag.
        </p>
        {normalizedTag && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-bold">Confirm firm before upload</p>
            <p className="mt-1">
              Selected Batch / Firm: <strong>{normalizedTag}</strong>. Type <strong>{normalizedTag}</strong> below to prevent uploading this Excel into the wrong ledger.
            </p>
            <input
              value={firmConfirmation}
              onChange={(event) => setFirmConfirmation(event.target.value)}
              placeholder={`Type ${normalizedTag}`}
              className="mt-3 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm font-bold uppercase dark:border-amber-800 dark:bg-slate-950"
              autoComplete="off"
            />
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!file || !normalizedTag || normalizedConfirmation !== normalizedTag || loading}
          className="mt-4 rounded-lg bg-brand-600 px-6 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Importing customers..." : "Import"}
        </button>
      </form>

      {summary && (
        <div className="card mt-6">
          <h2 className="font-semibold">Import Summary</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Batch / Firm tag</dt>
              <dd className="text-2xl font-bold text-sky-600">{summary.batchTag ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Total rows processed</dt>
              <dd className="text-2xl font-bold">{summary.totalProcessed}</dd>
            </div>
            <div>
              <dt className="text-slate-500">New customers created</dt>
              <dd className="text-2xl font-bold text-emerald-600">{summary.created}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Duplicate-name customers created separately</dt>
              <dd className="text-2xl font-bold text-violet-600">{summary.duplicateNameCreated ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Existing customers updated</dt>
              <dd className="text-2xl font-bold text-brand-600">{summary.updated}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Invalid rows skipped</dt>
              <dd className="text-2xl font-bold text-amber-600">{summary.skipped}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Skipped zero balance customers</dt>
              <dd className="text-2xl font-bold text-slate-600">{summary.skippedZeroBalance ?? 0}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Failed rows</dt>
              <dd className="text-2xl font-bold text-red-600">{summary.errors.length}</dd>
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
