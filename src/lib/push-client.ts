export type PhoneNotificationSupport = "unsupported" | "denied" | "default" | "enabled" | "disabled";

export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function supportsWebPush() {
  return typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export async function currentPushSubscription() {
  if (!supportsWebPush()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function savePushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/notifications/push", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Could not enable phone notifications.");
  return data;
}

export async function syncExistingPushSubscription() {
  if (!supportsWebPush() || Notification.permission !== "granted") return null;
  const subscription = await currentPushSubscription();
  if (!subscription) return null;
  await savePushSubscription(subscription);
  return subscription;
}

export async function disableCurrentPushSubscription() {
  const subscription = await currentPushSubscription().catch(() => null);
  if (!subscription) return;
  await fetch("/api/notifications/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}
