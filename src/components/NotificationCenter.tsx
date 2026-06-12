"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, CheckCheck, ExternalLink, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationResponse = {
  unreadCount: number;
  notifications: AppNotification[];
};

const mutationMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const businessApiPattern = /^\/api\/(orders|cheques|customers|follow-ups|field-staff\/attendance)\b/;

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function firstMessageLine(message: string) {
  return message.split("\n").find(Boolean) ?? message;
}

function shouldRefreshForFetch(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!mutationMethods.has(method)) return false;
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = rawUrl.startsWith("http") ? new URL(rawUrl).pathname : rawUrl;
  return businessApiPattern.test(url);
}

export function NotificationCenter() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const refreshTimer = useRef<number | null>(null);

  const unreadLabel = useMemo(() => (unreadCount > 99 ? "99+" : String(unreadCount)), [unreadCount]);

  const showPwaNotification = useCallback((notification: AppNotification) => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!isStandalonePwa()) return;
    const payload = {
      type: "UDHARBOOK_NOTIFY",
      title: notification.title,
      body: firstMessageLine(notification.message),
      url: notification.actionUrl ?? "/",
    };
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    } else {
      new Notification(notification.title, { body: payload.body, icon: "/icon.svg", data: { url: payload.url } });
    }
  }, []);

  const loadNotifications = useCallback(async (showNew = true) => {
    try {
      const response = await fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as NotificationResponse;
      setUnreadCount(data.unreadCount ?? 0);
      setNotifications(data.notifications ?? []);

      const freshUnread = (data.notifications ?? [])
        .filter((item) => !item.isRead && !knownIds.current.has(item.id))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const item of data.notifications ?? []) knownIds.current.add(item.id);
      if (!initialized.current) {
        initialized.current = true;
        return;
      }
      if (showNew && freshUnread.length > 0) {
        const next = freshUnread[freshUnread.length - 1];
        setToast(next);
        showPwaNotification(next);
        window.clearTimeout(refreshTimer.current ?? undefined);
        refreshTimer.current = window.setTimeout(() => setToast(null), 4500);
      }
    } catch {
      // Notification refresh is intentionally best effort.
    }
  }, [showPwaNotification]);

  const mutateNotification = async (body: { action: "MARK_READ" | "MARK_ALL_READ" | "DELETE"; id?: string }) => {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    if (response.ok) await loadNotifications(false);
  };

  useEffect(() => {
    loadNotifications(false);
    const interval = window.setInterval(() => loadNotifications(true), 60000);
    const onFocus = () => loadNotifications(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") loadNotifications(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadNotifications]);

  useEffect(() => {
    loadNotifications(true);
  }, [pathname, loadNotifications]);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      if (response.ok && shouldRefreshForFetch(input, init)) {
        window.setTimeout(() => loadNotifications(true), 350);
      }
      return response;
    };
    return () => {
      window.fetch = nativeFetch;
    };
  }, [loadNotifications]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open notifications"
        className="fixed right-3 top-2 z-50 inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 md:right-5 md:top-5"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
            {unreadLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <section
            className="ml-auto flex h-[100dvh] w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-950 sm:border-l sm:border-slate-200 sm:dark:border-slate-800"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white p-4 pt-[max(1rem,env(safe-area-inset-top))] dark:border-slate-800 dark:bg-slate-950">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Notifications</h2>
                <p className="text-xs text-slate-500">{unreadCount} unread</p>
              </div>
              <button
                type="button"
                onClick={() => mutateNotification({ action: "MARK_ALL_READ" })}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {notifications.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">No notifications</div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((notification) => (
                    <article
                      key={notification.id}
                      className={cn(
                        "rounded-lg border p-3",
                        notification.isRead
                          ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
                          : "border-brand-200 bg-brand-50/70 dark:border-brand-900 dark:bg-brand-950/30"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", notification.isRead ? "bg-slate-300" : "bg-red-500")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{notification.title}</h3>
                            <span className="shrink-0 text-xs text-slate-500">{relativeTime(notification.createdAt)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line text-sm leading-5 text-slate-600 dark:text-slate-300">{notification.message}</p>
                          <p className="mt-2 text-[11px] font-semibold uppercase text-slate-400">{notification.entityType?.replace(/_/g, " ") || "General"}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 pl-5">
                        {notification.actionUrl && (
                          <Link
                            href={notification.actionUrl}
                            onClick={() => {
                              mutateNotification({ action: "MARK_READ", id: notification.id });
                              setOpen(false);
                            }}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open record
                          </Link>
                        )}
                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => mutateNotification({ action: "MARK_READ", id: notification.id })}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            <Check className="h-4 w-4" />
                            Mark read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => mutateNotification({ action: "DELETE", id: notification.id })}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 dark:border-red-900"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {toast && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setToast(null);
          }}
          className="fixed bottom-4 left-4 right-4 z-[80] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:left-auto sm:right-5 sm:w-80"
        >
          <p className="text-sm font-bold text-slate-900 dark:text-white">{toast.title}</p>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{firstMessageLine(toast.message)}</p>
        </button>
      )}
    </>
  );
}
