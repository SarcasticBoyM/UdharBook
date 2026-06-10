"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Clipboard, MessageCircle, RotateCcw, Save, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

type CalculatorForm = {
  baseRate: string;
  discount: string;
  quantity: string;
  extraDiscount: string;
  schemeDiscount: string;
  gst: string;
  transport: string;
};

type RecentCalculation = {
  id: string;
  createdAt: string;
  form: CalculatorForm;
  finalUnitRate: number;
  finalBillingValue: number;
  savings: number;
};

const STORAGE_KEY = "udharbook:trade-calculator:recent";
const discountPresets = ["10", "12", "13", "14", "16"];
const emptyForm: CalculatorForm = {
  baseRate: "",
  discount: "",
  quantity: "1",
  extraDiscount: "",
  schemeDiscount: "",
  gst: "",
  transport: "",
};

function valueOf(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function calculate(form: CalculatorForm) {
  const baseRate = Math.max(0, valueOf(form.baseRate));
  const quantity = Math.max(0, valueOf(form.quantity) || 1);
  const discount = Math.max(0, valueOf(form.discount));
  const extraDiscount = Math.max(0, valueOf(form.extraDiscount));
  const schemeDiscount = Math.max(0, valueOf(form.schemeDiscount));
  const gst = Math.max(0, valueOf(form.gst));
  const transport = Math.max(0, valueOf(form.transport));

  const afterPrimary = baseRate * (1 - discount / 100);
  const afterExtra = afterPrimary * (1 - extraDiscount / 100);
  const finalRate = afterExtra * (1 - schemeDiscount / 100);
  const taxableTotal = finalRate * quantity;
  const gstAmount = taxableTotal * (gst / 100);
  const finalBillingValue = taxableTotal + gstAmount + transport;
  const finalUnitRate = quantity > 0 ? finalBillingValue / quantity : 0;
  const grossTotal = baseRate * quantity;
  const savings = Math.max(0, grossTotal - taxableTotal);
  const savingsPercent = grossTotal > 0 ? (savings / grossTotal) * 100 : 0;

  return {
    baseRate,
    quantity,
    finalRate,
    taxableTotal,
    gstAmount,
    finalBillingValue,
    finalUnitRate,
    savings,
    savingsPercent,
  };
}

function numberInputProps(label: string) {
  return {
    inputMode: "decimal" as const,
    placeholder: label,
    className: "min-h-14 w-full rounded-lg border border-slate-300 bg-white px-4 text-xl font-bold text-slate-950 shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white",
  };
}

export function TradeCalculator() {
  const [form, setForm] = useState<CalculatorForm>(emptyForm);
  const [recent, setRecent] = useState<RecentCalculation[]>([]);
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => calculate(form), [form]);

  useEffect(() => {
    try {
      const rows = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as RecentCalculation[];
      setRecent(Array.isArray(rows) ? rows.slice(0, 6) : []);
    } catch {
      setRecent([]);
    }
  }, []);

  const update = (key: keyof CalculatorForm, value: string) => {
    setCopied(false);
    setForm((current) => ({ ...current, [key]: value.replace(/[^\d.]/g, "") }));
  };

  const saveRecent = () => {
    if (!result.baseRate) return;
    const next = [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        form,
        finalUnitRate: result.finalUnitRate,
        finalBillingValue: result.finalBillingValue,
        savings: result.savings,
      },
      ...recent,
    ].slice(0, 6);
    setRecent(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const clearRecent = () => {
    setRecent([]);
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const quoteText = [
    "Quick Discount Calculation",
    `Base Rate: ${formatCurrency(result.baseRate)}`,
    `Discount: ${percent(valueOf(form.discount))}${valueOf(form.extraDiscount) ? ` + ${percent(valueOf(form.extraDiscount))}` : ""}${valueOf(form.schemeDiscount) ? ` + Scheme ${percent(valueOf(form.schemeDiscount))}` : ""}`,
    `Qty: ${result.quantity}`,
    `Final Unit Rate: ${formatCurrency(result.finalUnitRate)}`,
    `Billing Value: ${formatCurrency(result.finalBillingValue)}`,
  ].join("\n");

  const copyQuote = async () => {
    await navigator.clipboard?.writeText(quoteText);
    setCopied(true);
  };

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(quoteText)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="mx-auto max-w-6xl pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600">Owner private tool</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">Quick Discount Calculator</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Fast distributor pricing for discount, scheme, GST, loading, landing rate, and billing value.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm(emptyForm)} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold">
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <button type="button" onClick={saveRecent} className="flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm font-semibold">MRP / Base Rate</span>
              <input {...numberInputProps("0")} value={form.baseRate} onChange={(e) => update("baseRate", e.target.value)} autoFocus />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">Quantity</span>
              <input {...numberInputProps("1")} value={form.quantity} onChange={(e) => update("quantity", e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">Discount %</span>
              <input {...numberInputProps("0")} value={form.discount} onChange={(e) => update("discount", e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">Extra Discount %</span>
              <input {...numberInputProps("0")} value={form.extraDiscount} onChange={(e) => update("extraDiscount", e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">Scheme Discount %</span>
              <input {...numberInputProps("0")} value={form.schemeDiscount} onChange={(e) => update("schemeDiscount", e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-semibold">GST %</span>
              <input {...numberInputProps("0")} value={form.gst} onChange={(e) => update("gst", e.target.value)} />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm font-semibold">Transport / Loading</span>
              <input {...numberInputProps("0")} value={form.transport} onChange={(e) => update("transport", e.target.value)} />
            </label>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {discountPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => update("discount", preset)}
                className={cn(
                  "min-h-12 min-w-16 shrink-0 rounded-lg border px-4 text-lg font-black",
                  form.discount === preset ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200",
                )}
              >
                {preset}%
              </button>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-slate-950 p-4 text-white shadow-sm dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Calculator className="h-4 w-4" />
              Live Result
            </div>
            <div className="mt-4 space-y-4">
              <Result label="Final Unit Rate" value={formatCurrency(result.finalUnitRate)} large />
              <Result label="Final Rate before GST" value={formatCurrency(result.finalRate)} />
              <Result label="Total Amount" value={formatCurrency(result.taxableTotal)} />
              <Result label="GST Amount" value={formatCurrency(result.gstAmount)} />
              <Result label="Final Billing Value" value={formatCurrency(result.finalBillingValue)} large />
              <Result label="Savings" value={`${formatCurrency(result.savings)} (${percent(result.savingsPercent)})`} />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={copyQuote} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-slate-950">
                <Clipboard className="h-4 w-4" />
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={shareWhatsApp} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-white">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </button>
            </div>
          </section>

          <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">Recent</h2>
              {recent.length > 0 && (
                <button type="button" onClick={clearRecent} className="text-slate-500 hover:text-red-600" aria-label="Clear recent calculations">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {recent.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">Saved calculations stay on this device only.</p>
              ) : (
                recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setForm(item.form)}
                    className="w-full rounded-lg border p-3 text-left text-sm hover:border-brand-300 dark:border-slate-800"
                  >
                    <span className="block font-bold">{formatCurrency(item.finalUnitRate)} / unit</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Base {formatCurrency(valueOf(item.form.baseRate))} | Qty {item.form.quantity || 1} | Bill {formatCurrency(item.finalBillingValue)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Result({ label, value, large = false }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-white/10 pb-3 last:border-b-0">
      <span className="text-sm text-slate-300">{label}</span>
      <span className={cn("text-right font-black", large ? "text-2xl" : "text-lg")}>{value}</span>
    </div>
  );
}
