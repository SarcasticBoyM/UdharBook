"use client";

import { useEffect, useState } from "react";
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

export function PaymentCollectionModal({
  open,
  customerId,
  customerName,
  outstandingBalance,
  defaultMode = "PARTIAL",
  defaultAmount,
  source,
  relatedFollowUpId,
  allowedMethods = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"],
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

  if (!open) return null;

  const selectMode = (nextMode: PaymentCollectionMode) => {
    setMode(nextMode);
    if (nextMode === "FULL") setAmount(String(outstandingBalance));
    if (nextMode === "CHEQUE") setMethod("CHEQUE");
    if (nextMode !== "CHEQUE" && method === "CHEQUE") setMethod(allowedMethods.find((item) => item !== "CHEQUE") ?? "CASH");
  };

  const submit = async () => {
    if (saving) return;
    const numericAmount = Number(amount);
    if (!paymentDate) return setError("Select a payment date.");
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

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="payment-collection-title" data-customer-id={customerId} data-source={source} data-follow-up-id={relatedFollowUpId}>
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="payment-collection-title" className="text-lg font-bold">Collect Payment</h2><p className="text-sm text-slate-500">{customerName} · Outstanding {formatCurrency(outstandingBalance)}</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close payment collection" className="ui-control inline-flex h-11 w-11 items-center justify-center rounded-xl border"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["FULL", "PARTIAL", "CHEQUE"] as const).map((item) => <button key={item} type="button" onClick={() => selectMode(item)} className={`min-h-11 rounded-xl border px-2 text-sm font-bold ${mode === item ? "ui-control-selected" : "ui-control"}`}>{item === "FULL" ? "Paid Fully" : item === "PARTIAL" ? "Paid Partially" : "Cheque"}</button>)}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {allowedMethods.map((item) => <button key={item} type="button" disabled={mode === "CHEQUE" && item !== "CHEQUE"} onClick={() => { setMethod(item); if (item === "CHEQUE") setMode("CHEQUE"); }} className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${method === item ? "ui-control-selected" : "ui-control"}`}>{METHOD_LABELS[item]}</button>)}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Amount received *<input type="number" min="0" step="0.01" inputMode="decimal" value={amount} disabled={mode === "FULL"} onChange={(event) => setAmount(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
          <AppDatePicker label="Payment date" value={paymentDate} onChange={setPaymentDate} required />
          {(method === "UPI" || method === "BANK_TRANSFER") && <label className="text-sm font-semibold">Reference number<input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label>}
          {method === "BANK_TRANSFER" && <label className="text-sm font-semibold">Bank name<input value={bankName} onChange={(event) => setBankName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label>}
          {method === "CHEQUE" && <><label className="text-sm font-semibold">Cheque number *<input value={chequeNumber} onChange={(event) => setChequeNumber(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label><AppDatePicker label="Cheque date" value={chequeDate} onChange={setChequeDate} required /><label className="text-sm font-semibold">Bank name *<input value={bankName} onChange={(event) => setBankName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label><label className="text-sm font-semibold">Account holder *<input value={accountHolderName} onChange={(event) => setAccountHolderName(event.target.value)} className="ui-control mt-1 min-h-11 w-full rounded-lg border px-3" /></label></>}
        </div>
        <label className="mt-3 block text-sm font-semibold">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="ui-control mt-1 w-full rounded-lg border px-3 py-2" /></label>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
        <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 bg-white pt-2 dark:bg-slate-950"><button type="button" disabled={saving} onClick={onClose} className="ui-control min-h-12 rounded-xl border font-bold">Cancel</button><button type="button" disabled={saving} onClick={submit} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? "Saving Payment..." : "Save Payment"}</button></div>
      </div>
    </div>
  );
}
