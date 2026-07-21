"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { CriticalAlertBanner } from "@/components/CriticalAlertBanner";
import { PhoneNotificationControls } from "@/components/PhoneNotificationControls";
import {
  notificationCategory,
  priorityRank,
  shouldPushNotification,
  shouldToastNotification,
  type NotificationPriorityValue,
} from "@/lib/notification-priority";
import { cn } from "@/lib/utils";
import { currentPushSubscription } from "@/lib/push-client";

type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  priority: NotificationPriorityValue;
  isRead: boolean;
  createdAt: string;
};

type NotificationResponse = {
  success: boolean;
  unreadCount: number;
  criticalUnreadCount: number;
  notifications: AppNotification[];
  error?: string;
};

type NotificationFilter =
  | "ALL"
  | "UNREAD"
  | "CRITICAL"
  | "IMPORTANT"
  | "NORMAL"
  | "ORDERS"
  | "TASKS"
  | "CHEQUES"
  | "FOLLOW_UPS";

const CRITICAL_DISMISS_KEY = "udharbook-critical-alert-dismissed-v1";

const filters: { value: NotificationFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "CRITICAL", label: "Critical" },
  { value: "IMPORTANT", label: "Important" },
  { value: "NORMAL", label: "Normal" },
  { value: "ORDERS", label: "Orders" },
  { value: "TASKS", label: "Tasks" },
  { value: "CHEQUES", label: "Cheques" },
  { value: "FOLLOW_UPS", label: "Follow-ups" },
];

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
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

function priorityTone(priority: NotificationPriorityValue) {
  if (priority === "CRITICAL") {
    return {
      dot: "bg-red-600",
      badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      unread: "border-red-300 bg-red-50/80 dark:border-red-900 dark:bg-red-950/40",
    };
  }
  if (priority === "IMPORTANT") {
    return {
      dot: "bg-amber-500",
      badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
      unread: "border-amber-300 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30",
    };
  }
  return {
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    unread: "border-brand-200 bg-brand-50/70 dark:border-brand-900 dark:bg-brand-950/30",
  };
}

function actionLabel(notification: AppNotification) {
  if (notification.entityType === "CHEQUE") return "View Cheque";
  if (notification.entityType === "TASK") return "Open Task";
  if (notification.entityType === "ORDER") return "Open Order";
  if (notification.entityType === "CUSTOMER" || notification.entityType === "FOLLOW_UP") return "Open Customer";
  return "Open Record";
}

export function NotificationCenter({ sessionReady }: { sessionReady: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("ALL");
  const [unreadCount, setUnreadCount] = useState(0);
  const [criticalUnreadCount, setCriticalUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [dismissedCriticalIds, setDismissedCriticalIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const refreshTimer = useRef<number | null>(null);
  const fullRefreshInFlight = useRef(false);
  const countRefreshInFlight = useRef(false);
  const countUnauthorized = useRef(false);
  const fullPanelLoaded = useRef(false);

  const unreadLabel = useMemo(() => (unreadCount > 99 ? "99+" : String(unreadCount)), [unreadCount]);
  const unreadCritical = useMemo(
    () => notifications.filter((notification) => notification.priority === "CRITICAL" && !notification.isRead),
    [notifications],
  );
  const bannerNotification = unreadCritical.find((notification) => !dismissedCriticalIds.has(notification.id)) ?? null;
  const filteredNotifications = useMemo(() => notifications.filter((notification) => {
    if (filter === "ALL") return true;
    if (filter === "UNREAD") return !notification.isRead;
    if (["CRITICAL", "IMPORTANT", "NORMAL"].includes(filter)) return notification.priority === filter;
    return notificationCategory(notification.type, notification.entityType) === filter;
  }), [filter, notifications]);

  const showPwaNotification = useCallback((notification: AppNotification) => {
    if (!shouldPushNotification(notification.type)) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!isStandalonePwa()) return;
    void currentPushSubscription().then((subscription) => {
      if (subscription) return;
    const payload = {
      type: "UDHARBOOK_NOTIFY",
      title: notification.title,
      body: firstMessageLine(notification.message),
      url: notification.actionUrl ?? "/",
      requireInteraction: notification.priority === "CRITICAL",
      tag: notification.id,
    };
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    } else {
      new Notification(notification.title, {
        body: payload.body,
        icon: "/icon-192.png",
        data: { url: payload.url },
        requireInteraction: payload.requireInteraction,
        tag: payload.tag,
      });
    }
    }).catch(() => undefined);
  }, []);

  const mergeIncomingNotifications = useCallback((incoming: AppNotification[], showNew: boolean) => {
    setNotifications((current) => {
      const map = new Map(current.map((notification) => [notification.id, notification]));
      for (const notification of incoming) map.set(notification.id, notification);
      return [...map.values()].sort((left, right) => {
        if (left.isRead !== right.isRead) return left.isRead ? 1 : -1;
        const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
        if (priorityDifference !== 0) return priorityDifference;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
    });

    const freshUnread = incoming
      .filter((item) => !item.isRead && !knownIds.current.has(item.id))
      .sort((left, right) => {
        const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
        if (priorityDifference !== 0) return priorityDifference;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });

    for (const item of incoming) knownIds.current.add(item.id);
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const next = freshUnread.find((notification) => shouldToastNotification(notification.type));
    if (showNew && next) {
      setToast(next);
      showPwaNotification(next);
      window.clearTimeout(refreshTimer.current ?? undefined);
      refreshTimer.current = window.setTimeout(
        () => setToast(null),
        next.priority === "CRITICAL" ? 7000 : 4500,
      );
    }
  }, [showPwaNotification]);

  const loadNotificationCounts = useCallback(async (showNew = true) => {
    if (!sessionReady || countUnauthorized.current || countRefreshInFlight.current || document.visibilityState === "hidden") return;
    countRefreshInFlight.current = true;
    try {
      const response = await fetch("/api/notifications?mode=count", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<NotificationResponse>;
      if (response.status === 401) {
        countUnauthorized.current = true;
        setUnreadCount(0);
        setCriticalUnreadCount(0);
        setLoadError("");
        return;
      }
      if (!response.ok || data.success === false) {
        setLoadError(data.error ?? "Notifications could not be loaded. Please retry.");
        return;
      }
      setLoadError("");
      setUnreadCount(data.unreadCount ?? 0);
      setCriticalUnreadCount(data.criticalUnreadCount ?? 0);
      mergeIncomingNotifications(data.notifications ?? [], showNew);
    } catch {
      setLoadError("Notifications could not be loaded. Check your connection and retry.");
    } finally {
      countRefreshInFlight.current = false;
    }
  }, [mergeIncomingNotifications, sessionReady]);

  const loadNotifications = useCallback(async (showNew = true, forceStorageCheck = false) => {
    if (fullRefreshInFlight.current) return;
    fullRefreshInFlight.current = true;
    setLoadingNotifications(true);
    try {
      const search = new URLSearchParams({ limit: "50" });
      if (forceStorageCheck) search.set("storageCheck", "force");
      const response = await fetch(`/api/notifications?${search.toString()}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Partial<NotificationResponse>;
      if (!response.ok || data.success === false) {
        setLoadError(data.error ?? "Notifications could not be loaded. Please retry.");
        return;
      }
      setLoadError("");
      setUnreadCount(data.unreadCount ?? 0);
      setCriticalUnreadCount(data.criticalUnreadCount ?? 0);
      setNotifications(data.notifications ?? []);
      fullPanelLoaded.current = true;
      mergeIncomingNotifications(data.notifications ?? [], showNew);
    } catch {
      setLoadError("Notifications could not be loaded. Check your connection and retry.");
    } finally {
      fullRefreshInFlight.current = false;
      setLoadingNotifications(false);
    }
  }, [mergeIncomingNotifications]);

  const mutateNotification = useCallback(async (body: { action: "MARK_READ" | "MARK_ALL_READ" | "DELETE"; id?: string }) => {
    setActionError("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(data.error ?? "Notification could not be updated.");
        return false;
      }
      if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
      if (typeof data.criticalUnreadCount === "number") setCriticalUnreadCount(data.criticalUnreadCount);
      setNotifications((current) => {
        if (body.action === "MARK_ALL_READ") {
          return current.map((notification) => ({ ...notification, isRead: true }));
        }
        if (!body.id) return current;
        if (body.action === "DELETE") {
          return current.filter((notification) => notification.id !== body.id);
        }
        return current.map((notification) =>
          notification.id === body.id ? { ...notification, isRead: true } : notification,
        );
      });
      return true;
    } catch {
      setActionError("Notification could not be updated. Check your connection and retry.");
      return false;
    }
  }, []);

  const openRecord = useCallback(async (notification: AppNotification) => {
    setActionError("");
    try {
      const response = await fetch(`/api/notifications?resolveId=${encodeURIComponent(notification.id)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.actionUrl) {
        setActionError(data.error ?? "This record is no longer available.");
        setOpen(true);
        return;
      }
      await mutateNotification({ action: "MARK_READ", id: notification.id });
      setOpen(false);
      router.push(data.actionUrl);
    } catch {
      setActionError("This record could not be opened. Check your connection and retry.");
      setOpen(true);
    }
  }, [mutateNotification, router]);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(CRITICAL_DISMISS_KEY);
      if (stored) setDismissedCriticalIds(new Set(JSON.parse(stored) as string[]));
    } catch {
      // Session-only banner dismissal is optional.
    }
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    void loadNotificationCounts(true);
    const interval = window.setInterval(() => void loadNotificationCounts(true), 180000);
    const onFocus = () => void loadNotificationCounts(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadNotificationCounts(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadNotificationCounts, sessionReady]);

  useEffect(() => {
    if (open && !fullPanelLoaded.current) void loadNotifications(false);
  }, [loadNotifications, open]);

  function dismissCriticalBanner() {
    const next = new Set(dismissedCriticalIds);
    for (const notification of unreadCritical) next.add(notification.id);
    setDismissedCriticalIds(next);
    try {
      window.sessionStorage.setItem(CRITICAL_DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      // The notification remains unread even when session storage is unavailable.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={loadError ? "Open notifications, notification service unavailable" : "Open notifications"}
        className={cn(
          "ui-control fixed right-3 top-2 z-40 inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-lg border px-2 shadow-sm transition md:right-5 md:top-5",
          criticalUnreadCount > 0
            ? "border-red-300 text-red-700 dark:border-red-900"
            : loadError
              ? "border-amber-400 text-amber-700 dark:border-amber-800"
            : "border-slate-200 text-slate-700 dark:border-slate-700",
        )}
      >
        <Bell className={cn("h-5 w-5", criticalUnreadCount > 0 && "critical-bell-pulse")} />
        {loadError && unreadCount === 0 && <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />}
        {unreadCount > 0 && (
          <span className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 text-white",
            criticalUnreadCount > 0 ? "bg-red-600" : "bg-brand-600",
          )}>
            {unreadLabel}
          </span>
        )}
      </button>

      {bannerNotification && (
        <CriticalAlertBanner
          notification={bannerNotification}
          count={criticalUnreadCount}
          onDismiss={dismissCriticalBanner}
          onMarkRead={() => void mutateNotification({ action: "MARK_READ", id: bannerNotification.id })}
          onOpen={() => void openRecord(bannerNotification)}
          onViewAlerts={() => {
            setFilter("CRITICAL");
            setOpen(true);
          }}
        />
      )}

      {open && (
        <div className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <section
            className="ui-surface-elevated ml-auto flex h-[100dvh] w-full max-w-md flex-col border-l shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ui-surface-elevated sticky top-0 z-10 border-b p-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Notifications</h2>
                  <p className="text-xs text-slate-500">
                    {unreadCount} unread{criticalUnreadCount > 0 ? ` · ${criticalUnreadCount} critical` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void mutateNotification({ action: "MARK_ALL_READ" })}
                  className="ui-control ml-auto inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="ui-control inline-flex h-10 w-10 items-center justify-center rounded-md border"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {filters.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    className={cn(
                      "min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold",
                      filter === item.value
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <PhoneNotificationControls />
              {actionError && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}
              {loadError && (
                <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1">{loadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadNotifications(false, true)}
                    disabled={loadingNotifications}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 font-semibold text-white disabled:opacity-60"
                  >
                    <RefreshCw className={cn("h-4 w-4", loadingNotifications && "animate-spin")} />
                    Retry
                  </button>
                </div>
              )}
              {filteredNotifications.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center text-sm text-slate-500">
                  {loadingNotifications ? "Loading notifications..." : "No notifications in this view"}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredNotifications.map((notification) => {
                    const tone = priorityTone(notification.priority);
                    return (
                      <article
                        key={notification.id}
                        className={cn(
                          "rounded-lg border p-3",
                          notification.isRead
                            ? "ui-surface"
                            : tone.unread,
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", notification.isRead ? "bg-slate-300" : tone.dot)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="break-words text-sm font-bold text-slate-900 dark:text-white">{notification.title}</h3>
                              <span className="shrink-0 text-xs text-slate-500">{relativeTime(notification.createdAt)}</span>
                            </div>
                            <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold", tone.badge)}>
                              {notification.priority}
                            </span>
                            <p className="mt-1 whitespace-pre-line break-words text-sm leading-5 text-slate-600 dark:text-slate-300">{notification.message}</p>
                            <p className="mt-2 text-[11px] font-semibold uppercase text-slate-400">
                              {notification.entityType?.replace(/_/g, " ") || "General"}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 pl-5">
                          {notification.actionUrl && (
                            <button
                              type="button"
                              onClick={() => void openRecord(notification)}
                              className={cn(
                                "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-white",
                                notification.priority === "CRITICAL" ? "bg-red-700" : "bg-brand-600",
                              )}
                            >
                              <ExternalLink className="h-4 w-4" />
                              {actionLabel(notification)}
                            </button>
                          )}
                          {!notification.isRead && (
                            <button
                              type="button"
                              onClick={() => void mutateNotification({ action: "MARK_READ", id: notification.id })}
                              className="ui-control inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold"
                            >
                              <Check className="h-4 w-4" />
                              Mark read
                            </button>
                          )}
                          {(notification.isRead || notification.priority !== "CRITICAL") && (
                            <button
                              type="button"
                              onClick={() => void mutateNotification({ action: "DELETE", id: notification.id })}
                              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-600 dark:border-red-900"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
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
            setFilter(toast.priority);
            setToast(null);
          }}
          className={cn(
            "fixed bottom-4 left-4 right-4 z-[80] rounded-lg border p-3 text-left shadow-2xl sm:left-auto sm:right-5 sm:w-80",
            toast.priority === "CRITICAL"
              ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950"
              : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
          )}
        >
          <p className={cn("text-sm font-bold", toast.priority === "CRITICAL" ? "text-red-950 dark:text-red-100" : "text-amber-950 dark:text-amber-100")}>
            {toast.title}
          </p>
          <p className={cn("mt-1 line-clamp-2 text-sm", toast.priority === "CRITICAL" ? "text-red-800 dark:text-red-200" : "text-amber-800 dark:text-amber-200")}>
            {firstMessageLine(toast.message)}
          </p>
        </button>
      )}
    </>
  );
}
