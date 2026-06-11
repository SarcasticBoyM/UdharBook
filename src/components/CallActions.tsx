"use client";

import { useEffect, useState } from "react";
import { Copy, Phone } from "lucide-react";
import { telHref, displayPhone } from "@/lib/phone";

interface Props {
  partyName: string;
  contactNumber: string;
  balance: number;
  dueDate?: Date | string | null;
  compact?: boolean;
}

export function CallActions({ contactNumber, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        window.matchMedia("(pointer: coarse)").matches
    );
  }, []);

  const copyNumber = async () => {
    await navigator.clipboard.writeText(displayPhone(contactNumber));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    </div>
  );
}
