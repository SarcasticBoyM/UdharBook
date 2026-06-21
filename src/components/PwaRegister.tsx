"use client";

import { useEffect, useRef } from "react";

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
  const dueCheckInFlight = useRef(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((registration) => registration.update()).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) return;

    const check = async () => {
      if (dueCheckInFlight.current) return;
      if (Notification.permission !== "granted") return;
      if (document.visibilityState === "hidden") return;
      dueCheckInFlight.current = true;
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
              url: `/today-follow-ups?followUpId=${encodeURIComponent(reminder.id)}`,
            });
          } else {
            const notification = new Notification(`${label} follow-up reminder`, { body, icon: "/icon.svg" });
            notification.onclick = () => {
              window.focus();
              window.location.assign(`/today-follow-ups?followUpId=${encodeURIComponent(reminder.id)}`);
            };
          }
        }
      } catch {
        // Notification polling should never interrupt the app.
      } finally {
        dueCheckInFlight.current = false;
      }
    };

    check();
    const id = window.setInterval(check, 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
