"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { AppDatePicker } from "@/components/AppDateTimePicker";
import { currentIstDate } from "@/lib/app-date-time";
import { formatCurrency } from "@/lib/utils";

export type PaymentCollectionMode = "FULL" | "PARTIAL" | "CHEQUE";
export type PaymentMethod = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";

export type PaymentCollectionValue = {
  mode: PaymentCollectionMode;
  method: PaymentMethod;
  amount: number;
  paymentDate: string;
  notes: string;
  referenceNumber: string;
  bankName: string;
  chequeNumber: string;
  chequeDate: string;
  accountHolderName: string;
};

type Props = {
  open: boolean;
  customerId: string;
  customerName: string;
  outstandingBalance: number;
  defaultMode?: PaymentCollectionMode;
  defaultAmount?: number;
  source: "TODAY_FOLLOW_UP" | "DAILY_VISIT" | "CUSTOMER" | "OTHER";
  relatedFollowUpId?: string;
  allowedMethods?: PaymentMethod[];
  onSuccess: (value: PaymentCollectionValue) => Promise<void> | void;
  onClose: () => void;
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI / Online",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
};

const DEFAULT_ALLOWED_METHODS: PaymentMethod[] = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"];

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export function PaymentCollectionModal({
  open,
  customerId,
  customerName,
  outstandingBalance,
  defaultMode = "PARTIAL",
  defaultAmount,
  source,
  relatedFollowUpId,
  allowedMethods = DEFAULT_ALLOWED_METHODS,
  onSuccess,
  onClose,
}: Props) {
  const [mode, setMode] = useState<PaymentCollectionMode>(defaultMode);
  const [method, setMethod] = useState<PaymentMethod>(defaultMode === "CHEQUE" ? "CHEQUE" : allowedMethods[0] ?? "CASH");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(currentIstDate());
  const [notes, setNotes] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState(currentIstDate());
  const [accountHolderName, setAccountHolderName] = useState(customerName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const nextMethod = defaultMode === "CHEQUE" && allowedMethods.includes("CHEQUE") ? "CHEQUE" : allowedMethods[0] ?? "CASH";
    setMode(defaultMode);
    setMethod(nextMethod);
    setAmount(String(defaultMode === "FULL" ? outstandingBalance : defaultAmount ?? ""));
    setPaymentDate(currentIstDate());
    setChequeDate(currentIstDate());
    setNotes("");
    setReferenceNumber("");
    setBankName("");
    setChequeNumber("");
    setAccountHolderName(customerName);
    setError("");
    setSaving(false);
  }, [allowedMethods, customerName, defaultAmount, defaultMode, open, outstandingBalance]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (defaultMode !== "FULL") amountInputRef.current?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [defaultMode, open]);

  const numericAmount = Number(amount);
  const isValid = useMemo(() => {
    if (!allowedMethods.includes(method) || !isValidDateValue(paymentDate)) return false;
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > outstandingBalance) return false;
    if (mode === "FULL" && numericAmount !== outstandingBalance) return false;
    if (mode === "CHEQUE" && method !== "CHEQUE") return false;
    if (method === "CHEQUE") {
      return Boolean(chequeNumber.trim() && isValidDateValue(chequeDate) && bankName.trim() && accountHolderName.trim());
    }
    return true;
  }, [accountHolderName, allowedMethods, bankName, chequeDate, chequeNumber, method, mode, numericAmount, outstandingBalance, paymentDate]);

  if (!open) return null;

  const selectMode = (nextMode: PaymentCollectionMode) => {
    setError("");
    setMode(nextMode);
    if (nextMode === "FULL") setAmount(String(outstandingBalance));
    if (nextMode === "CHEQUE") setMethod("CHEQUE");
    if (nextMode !== "CHEQUE" && method === "CHEQUE") setMethod(allowedMethods.find((item) => item !== "CHEQUE") ?? "CASH");
  };

  const submit = async () => {
    if (saving || !isValid) return;
    if (!isValidDateValue(paymentDate)) return setError("Select a valid payment date.");
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setError("Enter an amount greater than zero.");
    if (numericAmount > outstandingBalance) return setError("Amount cannot exceed the outstanding balance.");
    if (method === "CHEQUE" && (!chequeNumber.trim() || !chequeDate || !bankName.trim() || !accountHolderName.trim())) {
      return setError("Cheque number, date, bank and account holder are required.");
    }
    setError("");
    setSaving(true);
    try {
      await onSuccess({ mode, method, amount: numericAmount, paymentDate, notes: notes.trim(), referenceNumber: referenceNumber.trim(), bankName: bankName.trim(), chequeNumber: chequeNumber.trim(), chequeDate, accountHolderName: accountHolderName.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not collect payment. Please try again.");
      setSaving(false);
    }
  };

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="payment-collection-title" data-customer-id={customerId} data-source={source} data-follow-up-id={relatedFollowUpId} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="pointer-events-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl sm:p-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="payment-collection-title" className="text-lg font-bold">Collect Payment</h2><p className="text-sm text-slate-500">{customerName} · Outstanding {formatCurrency(outstandingBalance)}</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close payment collection" className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-xl border"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["FULL", "PARTIAL", "CHEQUE"] as const).map((item) => <button key={item} type="button" onClick={() => selectMode(item)} className={`min-h-11 rounded-xl border px-2 text-sm font-bold ${mode === item ? "ui-control-selected" : "ui-control"}`}>{item === "FULL" ? "Paid Fully" : item === "PARTIAL" ? "Paid Partially" : "Cheque"}</button>)}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {allowedMethods.map((item) => <button key={item} type="button" disabled={mode === "CHEQUE" && item !== "CHEQUE"} onClick={() => { setError(""); setMethod(item); if (item === "CHEQUE") setMode("CHEQUE"); }} className={`min-h-11 rounded-xl border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${method === item ? "ui-control-selected" : "ui-control"}`}>{METHOD_LABELS[item]}</button>)}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Amount received *<input ref={amountInputRef} name="amount" type="number" min="0.01" max={outstandingBalance} step="0.01" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={amount} required readOnly={mode === "FULL"} onChange={(event) => { setError(""); setAmount(event.target.value); }} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3 read-only:cursor-default read-only:bg-slate-100 dark:read-only:bg-slate-900" /></label>
          <AppDatePicker label="Payment date" value={paymentDate} onChange={setPaymentDate} required />
          {(method === "UPI" || method === "BANK_TRANSFER") && <label className="text-sm font-semibold">Reference number<input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} autoComplete="off" className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label>}
          {method === "BANK_TRANSFER" && <label className="text-sm font-semibold">Bank name<input value={bankName} onChange={(event) => setBankName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label>}
          {method === "CHEQUE" && <><label className="text-sm font-semibold">Cheque number *<input value={chequeNumber} onChange={(event) => setChequeNumber(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label><AppDatePicker label="Cheque date" value={chequeDate} onChange={setChequeDate} required /><label className="text-sm font-semibold">Bank name *<input value={bankName} onChange={(event) => setBankName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label><label className="text-sm font-semibold">Account holder *<input value={accountHolderName} onChange={(event) => setAccountHolderName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label></>}
        </div>
        {Number.isFinite(numericAmount) && numericAmount > 0 && numericAmount <= outstandingBalance && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Balance after payment: <span className="font-bold">{formatCurrency(Math.max(0, outstandingBalance - numericAmount))}</span></p>
        )}
        {amount && (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > outstandingBalance) && <p className="mt-2 text-sm font-semibold text-red-600">Enter an amount greater than zero and not more than {formatCurrency(outstandingBalance)}.</p>}
        <label className="mt-3 block text-sm font-semibold">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="ui-control mt-1 w-full rounded-lg border px-3 py-2" /></label>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
        <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 bg-white pt-2 dark:bg-slate-950"><button type="button" disabled={saving} onClick={onClose} className="ui-control min-h-12 rounded-xl border font-bold">Cancel</button><button type="submit" disabled={saving || !isValid} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Saving Payment..." : "Save Payment"}</button></div>
      </form>
    </div>,
    document.body,
  );
}
