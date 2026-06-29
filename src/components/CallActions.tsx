"use client";

import { useEffect, useState } from "react";
import { Copy, MessageCircle, Phone } from "lucide-react";
import { telHref, displayPhone } from "@/lib/phone";
import { openWhatsAppUrl, paymentReminderMessage, whatsappHref } from "@/lib/whatsapp";

interface Props {
  partyName: string;
  contactNumber: string;
  balance: number;
  dueDate?: Date | string | null;
  compact?: boolean;
}

export function CallActions({ partyName, contactNumber, balance, dueDate, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    setIsMobile(
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        window.matchMedia("(pointer: coarse)").matches
    );
  }, []);

  const waUrl = whatsappHref(contactNumber, paymentReminderMessage(partyName, balance, dueDate));
  const reminderText = paymentReminderMessage(partyName, balance, dueDate);

  const copyNumber = async () => {
    await navigator.clipboard.writeText(displayPhone(contactNumber));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(reminderText);
      setMessageIsError(false);
      setMessage("Reminder message copied.");
    } catch {
      setMessageIsError(true);
      setMessage("Could not copy the reminder message.");
    }
  };

  const openWhatsApp = () => {
    if (!waUrl) {
      setMessageIsError(true);
      setMessage("Customer WhatsApp number is missing or invalid.");
      return;
    }

    openWhatsAppUrl(waUrl);
    setMessageIsError(false);
    setMessage("WhatsApp opened. Please tap Send.");
  };

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-2"}`}>
      {isMobile ? (
        <a
          href={telHref(contactNumber)}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          <Phone className="h-4 w-4" />
          Call
        </a>
      ) : (
        <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600">
          <span>{displayPhone(contactNumber)}</span>
          <button
            type="button"
            onClick={copyNumber}
            className="text-brand-600 hover:text-brand-700"
            title="Copy number"
          >
            <Copy className="h-4 w-4" />
          </button>
          {copied && <span className="text-xs text-emerald-600">Copied</span>}
        </div>
      )}
      <button
        type="button"
        onClick={openWhatsApp}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
      >
        <MessageCircle className="h-4 w-4" />
        Send WhatsApp Reminder
      </button>
      {!waUrl && (
        <button
          type="button"
          onClick={copyMessage}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          <Copy className="h-4 w-4" />
          Copy Message
        </button>
      )}
      {message && (
        <span className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-xl ${messageIsError ? "bg-amber-700" : "bg-emerald-700"}`} role="status">
          {message}
        </span>
      )}
    </div>
  );
}
