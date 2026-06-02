"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setResetUrl("");
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setLoading(false);
    setMessage(data.message ?? data.error ?? "Request processed");
    if (data.resetUrl) setResetUrl(data.resetUrl);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold text-brand-700 dark:text-brand-400">Reset UdharBook Password</h1>
        <p className="mt-1 text-sm text-slate-500">Enter your admin or staff email.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Preparing link..." : "Send reset link"}
          </button>
        </form>
        {message && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{message}</p>}
        {resetUrl && (
          <Link href={resetUrl} className="mt-3 block break-all text-sm text-brand-600 hover:underline">
            Development reset link
          </Link>
        )}
        <Link href="/login" className="mt-4 block text-sm text-slate-500 hover:text-brand-600">
          Back to login
        </Link>
      </div>
    </div>
  );
}

