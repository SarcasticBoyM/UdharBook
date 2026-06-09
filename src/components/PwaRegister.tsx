"use client";

import { useEffect } from "react";

const notified = new Set<string>();

function timingLabel(scheduledAt: string | null, missed: boolean) {
  if (!scheduledAt) return "Upcoming";
  if (missed) return "Missed";
  const minutes = Math.round((new Date(scheduledAt).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "Now";
  if (minutes <= 10) return "10 min";
  if (minutes <= 30) return "30 min";
  if (minutes <= 60) return "1 hour";
  return "Upcoming";
}

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) return;

    const check = async () => {
      if (Notification.permission !== "granted") return;
      try {
        const res = await fetch("/api/notifications/due", { credentials: "same-origin" });
        if (!res.ok) return;
        const data = await res.json();
        for (const reminder of data.reminders ?? []) {
          const label = timingLabel(reminder.scheduledAt, reminder.missed);
          const key = `${reminder.id}:${label}`;
          if (notified.has(key)) continue;
          notified.add(key);
          const body = `Call ${reminder.partyName} regarding ${new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
          }).format(reminder.amount)} balance.${reminder.callbackNote ? ` Note: ${reminder.callbackNote}` : ""}`;
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: "UDHARBOOK_NOTIFY",
              title: `${label} follow-up reminder`,
              body,
            });
          } else {
            new Notification(`${label} follow-up reminder`, { body, icon: "/icon.svg" });
          }
        }
      } catch {
        // Notification polling should never interrupt the app.
      }
    };

    check();
    const id = window.setInterval(check, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
