"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setMessage(data.error ?? "Could not reset password");
      return;
    }
    setMessage("Password updated. Redirecting to login...");
    setTimeout(() => router.push("/login"), 900);
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        placeholder="At least 8 characters"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
        required
      />
      <button
        type="submit"
        disabled={loading || !token}
        className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? "Updating..." : "Update password"}
      </button>
      {message && <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>}
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold text-brand-700 dark:text-brand-400">Set New Password</h1>
        <Suspense fallback={<p className="mt-6 text-sm text-slate-500">Loading reset form...</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
