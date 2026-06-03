"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application route failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Something went wrong</p>
            <h1 className="mt-2 text-2xl font-bold">UdharBook could not load this screen</h1>
            <p className="mt-3 text-sm text-slate-600">
              Please retry once. If it continues, check production environment variables and Vercel function logs.
            </p>
            {error.digest && <p className="mt-3 text-xs text-slate-500">Error digest: {error.digest}</p>}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                Retry
              </button>
              <a href="/login" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">
                Go to Login
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
