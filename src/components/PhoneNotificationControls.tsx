"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import {
  currentPushSubscription,
  disableCurrentPushSubscription,
  fetchPushStatus,
  savePushSubscription,
  subscriptionUsesPublicKey,
  supportsWebPush,
  urlBase64ToUint8Array,
  type PhoneNotificationSupport,
} from "@/lib/push-client";

const statusLabels: Record<PhoneNotificationSupport, string> = {
  enabled: "Enabled on this device",
  disabled: "Disabled",
  denied: "Permission denied",
  default: "Not enabled",
  unsupported: "Unsupported on this browser",
};

export function PhoneNotificationControls() {
  const [status, setStatus] = useState<PhoneNotificationSupport>("disabled");
  const [publicKey, setPublicKey] = useState("");
  const [configured, setConfigured] = useState(true);
  const [configError, setConfigError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnostics, setDiagnostics] = useState({
    notificationPermission: "unavailable",
    serviceWorkerSupported: false,
    pushManagerSupported: false,
    serviceWorkerControllerPresent: false,
    currentBrowserSubscriptionExists: false,
    serverEnabled: false,
    serverSubscriptionCount: 0,
    lastTest: "not run",
  });

  const refresh = useCallback(async () => {
    if (!supportsWebPush()) {
      setStatus("unsupported");
      setDiagnostics((current) => ({
        ...current,
        notificationPermission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
        serviceWorkerSupported: "serviceWorker" in navigator,
        pushManagerSupported: "PushManager" in window,
        serviceWorkerControllerPresent: Boolean(navigator.serviceWorker?.controller),
      }));
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const response = await fetch("/api/notifications/config", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    let resolvedPublicKey = "";
    if (response.ok) {
      setConfigured(Boolean(data.configured));
      resolvedPublicKey = data.publicKey ?? "";
      setPublicKey(resolvedPublicKey);
      setConfigError(typeof data.configError === "string" ? data.configError : "");
    } else {
      setConfigured(false);
      setConfigError(typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "Could not check phone notification configuration.");
    }
    const subscription = await currentPushSubscription().catch(() => null);
    const subscriptionKeyMatches = Boolean(subscription && resolvedPublicKey && subscriptionUsesPublicKey(subscription, resolvedPublicKey));
    let serverEnabled = false;
    let serverSubscriptionCount = 0;
    try {
      let serverStatus = await fetchPushStatus(subscription);
      if (subscription && subscriptionKeyMatches && Notification.permission === "granted" && !serverStatus.enabled) {
        await savePushSubscription(subscription);
        serverStatus = await fetchPushStatus(subscription);
      }
      serverEnabled = serverStatus.enabled;
      serverSubscriptionCount = serverStatus.activeCount;
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Could not check phone notification status.");
    }
    setDiagnostics((current) => ({
      ...current,
      notificationPermission: Notification.permission,
      serviceWorkerSupported: "serviceWorker" in navigator,
      pushManagerSupported: "PushManager" in window,
      serviceWorkerControllerPresent: Boolean(navigator.serviceWorker.controller),
      currentBrowserSubscriptionExists: Boolean(subscription && subscriptionKeyMatches),
      serverEnabled,
      serverSubscriptionCount,
    }));
    if (subscription && !subscriptionKeyMatches) {
      setConfigError("This device uses an older VAPID key. Enable phone notifications again to refresh it.");
    }
    setStatus(subscription && subscriptionKeyMatches && serverEnabled && Notification.permission === "granted"
      ? "enabled"
      : Notification.permission === "default"
        ? "default"
        : "disabled");
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setMessage("");
    try {
      if (!supportsWebPush()) throw new Error("This browser does not support background phone notifications. Use an installed Android Chrome/PWA over HTTPS.");
      if (!configured || !publicKey) throw new Error(configError || "Missing VAPID public key.");
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission);
        throw new Error(permission === "denied" ? "Permission is blocked. Enable notifications from browser/site settings." : "Notification permission was not granted.");
      }
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      let existing = await registration.pushManager.getSubscription();
      if (existing && !subscriptionUsesPublicKey(existing, publicKey)) {
        await fetch("/api/notifications/push", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        }).catch(() => undefined);
        await existing.unsubscribe().catch(() => false);
        existing = null;
      }
      let subscription = existing;
      if (!subscription) {
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        } catch (error) {
          throw new Error(`Browser push subscription failed: ${error instanceof Error ? error.message : "Unknown browser error"}`);
        }
      }
      const saved = await savePushSubscription(subscription);
      if (!saved.enabled) throw new Error("Server did not enable this push subscription.");
      setStatus("enabled");
      await refresh();
      setMessage("Phone notifications enabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable phone notifications.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage("");
    await disableCurrentPushSubscription();
    setStatus(Notification.permission === "denied" ? "denied" : "disabled");
    setMessage("Phone notifications disabled on this device.");
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      const subscription = await currentPushSubscription();
      if (!subscription) throw new Error("Enable phone notifications first.");
      const response = await fetch("/api/notifications/push/test", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const data = await response.json().catch(() => ({}));
      setDiagnostics((current) => ({
        ...current,
        lastTest: `${Number(data.sentCount ?? 0)} sent / ${Number(data.failedCount ?? 0)} failed`,
        serverSubscriptionCount: Number(data.totalSubscriptions ?? current.serverSubscriptionCount),
      }));
      if (!response.ok || data.sentCount === 0) throw new Error(data.message ?? data.error ?? "No active push subscription found for this user/device");
      setMessage(data.message ?? "Test notification sent. Check your phone notification panel.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test notification could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 h-4 w-4 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Phone notifications</p>
          <p className="text-xs text-slate-500">{statusLabels[status]}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {status !== "enabled" ? (
          <button type="button" onClick={enable} disabled={busy || status === "denied" || status === "unsupported"} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Enable phone notifications
          </button>
        ) : (
          <>
            <button type="button" onClick={test} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </button>
            <button type="button" onClick={disable} disabled={busy} className="ui-control min-h-10 rounded-md border px-3 text-xs font-semibold disabled:opacity-50">Disable</button>
          </>
        )}
      </div>
      {message && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300" role="status">{message}</p>}
      {configError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">{configError}</p>}
      <details className="mt-2 text-[11px] text-slate-500">
        <summary className="cursor-pointer">Phone notification diagnostics</summary>
        <div className="mt-1 grid gap-0.5">
          <span>Permission: {diagnostics.notificationPermission}</span>
          <span>Service worker: {diagnostics.serviceWorkerSupported ? "supported" : "unsupported"}</span>
          <span>Push manager: {diagnostics.pushManagerSupported ? "supported" : "unsupported"}</span>
          <span>SW controller: {diagnostics.serviceWorkerControllerPresent ? "present" : "missing"}</span>
          <span>Browser subscription: {diagnostics.currentBrowserSubscriptionExists ? "present" : "missing"}</span>
          <span>Server enabled: {diagnostics.serverEnabled ? "yes" : "no"}</span>
          <span>Server subscriptions: {diagnostics.serverSubscriptionCount}</span>
          <span>Last test: {diagnostics.lastTest}</span>
        </div>
      </details>
      {typeof window !== "undefined" && !window.isSecureContext && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">HTTPS is required outside localhost.</p>}
    </div>
  );
}
