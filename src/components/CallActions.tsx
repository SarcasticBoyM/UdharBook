"use client";

import { useEffect, useState } from "react";
import { Copy, Phone, MessageCircle } from "lucide-react";
import { telHref, displayPhone } from "@/lib/phone";
import { paymentReminderMessage, whatsappHref, whatsappShareText } from "@/lib/whatsapp";

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

  const openWhatsApp = async () => {
    setMessage("");
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && navigator.share) {
      try {
        await navigator.share({
          title: `Reminder for ${partyName}`,
          text: whatsappShareText(contactNumber, reminderText),
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("Could not open Android share chooser. Opening WhatsApp Web instead.");
      }
    }
    window.open(waUrl, "_blank", "noopener,noreferrer");
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
        WhatsApp
      </button>
      {message && <span className="w-full text-xs text-amber-700">{message}</span>}
    </div>
  );
}
