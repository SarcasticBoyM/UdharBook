"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, Clipboard, Pencil, Plus, RotateCcw, Save, Trash2, XCircle } from "lucide-react";
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

type ProductPreset = {
  id: string;
  productName: string;
  baseRate: number;
  discountPercent: number;
  extraDiscountPercent: number;
  schemeDiscountPercent: number;
  gstPercent: number;
  transportLoading: number;
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

function formFromPreset(preset: ProductPreset, quantity: string): CalculatorForm {
  return {
    baseRate: String(preset.baseRate ?? ""),
    discount: String(preset.discountPercent ?? ""),
    quantity: quantity || "1",
    extraDiscount: String(preset.extraDiscountPercent ?? ""),
    schemeDiscount: String(preset.schemeDiscountPercent ?? ""),
    gst: String(preset.gstPercent ?? ""),
    transport: String(preset.transportLoading ?? ""),
  };
}

function presetPayload(productName: string, form: CalculatorForm) {
  return {
    productName: productName.trim(),
    baseRate: valueOf(form.baseRate),
    discountPercent: valueOf(form.discount),
    extraDiscountPercent: valueOf(form.extraDiscount),
    schemeDiscountPercent: valueOf(form.schemeDiscount),
    gstPercent: valueOf(form.gst),
    transportLoading: valueOf(form.transport),
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
  const [presets, setPresets] = useState<ProductPreset[]>([]);
  const [presetQuery, setPresetQuery] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetMessage, setPresetMessage] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ProductPreset | null>(null);
  const [presetDraft, setPresetDraft] = useState({ productName: "", ...emptyForm });
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => calculate(form), [form]);
  const filteredPresets = useMemo(() => {
    const query = presetQuery.trim().toLowerCase();
    if (!query) return presets;
    return presets.filter((preset) => preset.productName.toLowerCase().includes(query));
  }, [presetQuery, presets]);
  const favoritePresets = useMemo(() => presets.slice(0, 8), [presets]);

  useEffect(() => {
    try {
      const rows = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as RecentCalculation[];
      setRecent(Array.isArray(rows) ? rows.slice(0, 6) : []);
    } catch {
      setRecent([]);
    }
  }, []);

  const loadPresets = async () => {
    const res = await fetch("/api/product-presets", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPresets(data.presets ?? []);
    }
  };

  useEffect(() => {
    void loadPresets();
  }, []);

  const update = (key: keyof CalculatorForm, value: string) => {
    setCopied(false);
    setForm((current) => ({ ...current, [key]: value.replace(/[^\d.]/g, "") }));
  };

  const applyPreset = (preset: ProductPreset) => {
    setCopied(false);
    setSelectedPresetId(preset.id);
    setPresetQuery(preset.productName);
    setPresetMessage("");
    setForm((current) => formFromPreset(preset, current.quantity));
  };

  const saveProductPreset = async () => {
    if (!result.baseRate) {
      setPresetMessage("Enter a base rate before saving a preset.");
      return;
    }
    const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
    const productName = selectedPreset?.productName ?? window.prompt("Product name for this preset", presetQuery.trim())?.trim();
    if (!productName) return;
    const payload = presetPayload(productName, form);
    const res = await fetch("/api/product-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPresetMessage(data.error ?? "Could not save product preset.");
      return;
    }
    setPresetMessage("Product preset saved.");
    setSelectedPresetId(data.preset?.id ?? selectedPresetId);
    setPresetQuery(data.preset?.productName ?? productName);
    await loadPresets();
  };

  const startAddPreset = () => {
    setEditingPreset(null);
    setPresetDraft({ productName: presetQuery.trim(), ...form });
    setManageOpen(true);
  };

  const startEditPreset = (preset: ProductPreset) => {
    setEditingPreset(preset);
    setPresetDraft({ productName: preset.productName, ...formFromPreset(preset, "1") });
    setManageOpen(true);
  };

  const saveManagedPreset = async () => {
    const payload = presetPayload(presetDraft.productName, presetDraft);
    const url = editingPreset ? `/api/product-presets/${editingPreset.id}` : "/api/product-presets";
    const res = await fetch(url, {
      method: editingPreset ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPresetMessage(data.error ?? "Could not save product preset.");
      return;
    }
    setPresetMessage("Product preset saved.");
    setManageOpen(false);
    await loadPresets();
  };

  const deletePreset = async (preset: ProductPreset) => {
    if (!window.confirm(`Delete ${preset.productName}?`)) return;
    const res = await fetch(`/api/product-presets/${preset.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPresetMessage(data.error ?? "Could not delete product preset.");
      return;
    }
    if (selectedPresetId === preset.id) {
      setSelectedPresetId("");
      setPresetQuery("");
    }
    setPresetMessage("Product preset deleted.");
    await loadPresets();
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
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-sm font-semibold">Select Product</span>
                <input
                  list="product-presets"
                  value={presetQuery}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPresetQuery(value);
                    const preset = presets.find((item) => item.productName.toLowerCase() === value.trim().toLowerCase());
                    if (preset) applyPreset(preset);
                    else setSelectedPresetId("");
                  }}
                  placeholder="Search product preset"
                  className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900"
                />
                <datalist id="product-presets">
                  {filteredPresets.map((preset) => (
                    <option key={preset.id} value={preset.productName} />
                  ))}
                </datalist>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveProductPreset} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-bold text-white">
                  <Save className="h-4 w-4" />
                  Save as Product Preset
                </button>
                <button type="button" onClick={startAddPreset} className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">
                  <Plus className="h-4 w-4" />
                  Manage Presets
                </button>
              </div>
            </div>

            {favoritePresets.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {favoritePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 text-sm font-black",
                      selectedPresetId === preset.id
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                    )}
                  >
                    {preset.productName}
                  </button>
                ))}
              </div>
            )}
            {presetMessage && <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{presetMessage}</p>}
          </div>

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
            <div className="mt-5">
              <button type="button" onClick={copyQuote} className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-slate-950">
                <Clipboard className="h-4 w-4" />
                {copied ? "Copied" : "Copy"}
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

      {manageOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl dark:bg-slate-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">Manage Presets</h2>
                <p className="mt-1 text-sm text-slate-500">Add, edit, or remove products used in the calculator.</p>
              </div>
              <button type="button" onClick={() => setManageOpen(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900" aria-label="Close preset manager">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <PresetDraftInput label="Product Name" value={presetDraft.productName} onChange={(value) => setPresetDraft((current) => ({ ...current, productName: value }))} />
              <PresetDraftInput label="MRP / Base Rate" value={presetDraft.baseRate} onChange={(value) => setPresetDraft((current) => ({ ...current, baseRate: value }))} number />
              <PresetDraftInput label="Default Discount %" value={presetDraft.discount} onChange={(value) => setPresetDraft((current) => ({ ...current, discount: value }))} number />
              <PresetDraftInput label="Default Extra Discount %" value={presetDraft.extraDiscount} onChange={(value) => setPresetDraft((current) => ({ ...current, extraDiscount: value }))} number />
              <PresetDraftInput label="Default Scheme Discount %" value={presetDraft.schemeDiscount} onChange={(value) => setPresetDraft((current) => ({ ...current, schemeDiscount: value }))} number />
              <PresetDraftInput label="GST %" value={presetDraft.gst} onChange={(value) => setPresetDraft((current) => ({ ...current, gst: value }))} number />
              <PresetDraftInput label="Default Transport / Loading" value={presetDraft.transport} onChange={(value) => setPresetDraft((current) => ({ ...current, transport: value }))} number />
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setManageOpen(false)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-bold dark:border-slate-700">
                Cancel
              </button>
              <button type="button" onClick={saveManagedPreset} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">
                {editingPreset ? "Update Preset" : "Add Preset"}
              </button>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <h3 className="text-sm font-bold">Saved Presets</h3>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {presets.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">No product presets saved yet.</p>
                ) : (
                  presets.map((preset) => (
                    <div key={preset.id} className="flex flex-col gap-3 rounded-lg border p-3 text-sm dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-black">{preset.productName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatCurrency(preset.baseRate)} | Disc {percent(preset.discountPercent)} | GST {percent(preset.gstPercent)} | Loading {formatCurrency(preset.transportLoading)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => startEditPreset(preset)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold dark:border-slate-700">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button type="button" onClick={() => deletePreset(preset)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-700">
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
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

function PresetDraftInput({ label, value, onChange, number = false }: { label: string; value: string; onChange: (value: string) => void; number?: boolean }) {
  return (
    <label>
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(number ? event.target.value.replace(/[^\d.]/g, "") : event.target.value)}
        inputMode={number ? "decimal" : "text"}
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );
}
