"use client";

import { Check, ExternalLink, ShieldAlert, X } from "lucide-react";

type CriticalAlert = {
  id: string;
  title: string;
  message: string;
  actionUrl: string | null;
  entityType: string | null;
};

function firstLine(message: string) {
  return message.split("\n").find(Boolean) ?? message;
}

function actionLabel(entityType: string | null) {
  if (entityType === "CHEQUE") return "View Cheque";
  if (entityType === "TASK") return "Open Task";
  return "View Alert";
}

export function CriticalAlertBanner({
  notification,
  count,
  onDismiss,
  onMarkRead,
  onOpen,
  onViewAlerts,
}: {
  notification: CriticalAlert;
  count: number;
  onDismiss: () => void;
  onMarkRead: () => void;
  onOpen: () => void;
  onViewAlerts: () => void;
}) {
  return (
    <aside
      aria-live="assertive"
      className="fixed inset-x-3 top-16 z-[45] rounded-lg border border-red-300 bg-red-50 p-3 shadow-xl dark:border-red-900 dark:bg-red-950 md:left-[17rem] md:right-20 md:top-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-600 text-white">
          <ShieldAlert aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-red-950 dark:text-red-100">
                {count > 1 ? `${count} critical alerts require attention` : notification.title}
              </p>
              <p className="mt-0.5 break-words text-xs leading-5 text-red-800 dark:text-red-200">
                {count > 1 ? "Open Critical alerts to review them." : firstLine(notification.message)}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss critical banner for this session"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {count > 1 ? (
              <button
                type="button"
                onClick={onViewAlerts}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800"
              >
                <ShieldAlert aria-hidden="true" className="h-4 w-4" />
                View Alerts
              </button>
            ) : (
              <>
                {notification.actionUrl && (
                  <button
                    type="button"
                    onClick={onOpen}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    {actionLabel(notification.entityType)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onMarkRead}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-100 dark:hover:bg-red-900"
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                  Mark as Read
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
