"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

type LinkState = {
  loading: boolean;
  shopName: string;
  isEnabled: boolean;
  error: string;
};

type SubmittedSummary = {
  customerName: string;
  mobile: string;
  orderText: string;
  deliveryDate: string | null;
};

export default function PublicCustomerOrderPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params.token || ""), [params.token]);
  const [linkState, setLinkState] = useState<LinkState>({ loading: true, shopName: "", isEnabled: false, error: "" });
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [orderText, setOrderText] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SubmittedSummary | null>(null);

  useEffect(() => {
    let active = true;
    async function loadLink() {
      try {
        const res = await fetch(`/vcard/order-link/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || data.success === false) {
          setLinkState({ loading: false, shopName: "", isEnabled: false, error: data.error ?? "This order link is invalid." });
          return;
        }
        setLinkState({ loading: false, shopName: data.shopName ?? "Shop", isEnabled: Boolean(data.isEnabled), error: "" });
      } catch {
        if (active) setLinkState({ loading: false, shopName: "", isEnabled: false, error: "Could not load this order link." });
      }
    }
    if (token) void loadLink();
    return () => {
      active = false;
    };
  }, [token]);

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || summary) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/vcard/order-link/${encodeURIComponent(token)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, mobile, address, orderText, deliveryDate, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setError(data.error ?? "Could not submit order.");
        return;
      }
      setSummary(data.summary ?? { customerName, mobile, orderText, deliveryDate: deliveryDate || null });
    } catch {
      setError("Could not submit order. Please check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  if (linkState.loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading order form...
        </div>
      </main>
    );
  }

  if (linkState.error || !linkState.isEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Place Order</h1>
          <p className="mt-3 text-sm text-slate-600">
            {linkState.error || "This order link is currently disabled."}
          </p>
        </div>
      </main>
    );
  }

  if (summary) {
    return (
      <main className="min-h-screen bg-slate-50 p-4">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md items-center">
          <div className="w-full rounded-xl bg-white p-6 shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-center text-2xl font-bold text-slate-900">Order submitted successfully</h1>
            <p className="mt-2 text-center text-sm text-slate-600">Thank you. Your order has been received.</p>
            <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-bold">{summary.customerName}</p>
              <p>{summary.mobile}</p>
              <p className="mt-3 whitespace-pre-wrap">{summary.orderText}</p>
              {summary.deliveryDate && <p className="mt-3">Delivery date: {summary.deliveryDate}</p>}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 pb-28">
      <form onSubmit={submitOrder} className="mx-auto max-w-md">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">{linkState.shopName}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Place Order</h1>
          <p className="mt-1 text-sm text-slate-600">Place your order</p>

          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Customer Name</span>
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required maxLength={120} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Mobile Number</span>
              <input value={mobile} onChange={(event) => setMobile(event.target.value)} required maxLength={30} inputMode="tel" className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Address / Area</span>
              <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Order Details</span>
              <textarea value={orderText} onChange={(event) => setOrderText(event.target.value)} required maxLength={4000} rows={7} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" placeholder={"305 - 20\n315G - 25\nBirla Super - 30 Bags"} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Delivery Date</span>
              <input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" />
            </label>
            <input type="text" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          <button type="submit" disabled={submitting} className="mx-auto flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:opacity-60">
            {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
            {submitting ? "Submitting..." : "Submit Order"}
          </button>
        </div>
      </form>
    </main>
  );
}
