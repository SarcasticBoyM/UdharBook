export type PhoneNotificationSupport = "unsupported" | "denied" | "default" | "enabled" | "disabled";

export function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export function subscriptionUsesPublicKey(subscription: PushSubscription, publicKey: string) {
  const actualKey = subscription.options.applicationServerKey;
  if (!actualKey) return false;
  const actual = new Uint8Array(actualKey);
  const expected = urlBase64ToUint8Array(publicKey);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

export function supportsWebPush() {
  return typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export async function pushEndpointHash(endpoint: string) {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function fetchPushStatus(subscription: PushSubscription | null) {
  const endpointHash = subscription ? await pushEndpointHash(subscription.endpoint) : "";
  const query = endpointHash ? `?endpointHash=${encodeURIComponent(endpointHash)}` : "";
  const response = await fetch(`/api/notifications/push${query}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not check phone notification status.");
  return data as { enabled: boolean; activeCount: number; currentDeviceEnabled: boolean | null };
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
  if (!response.ok) throw new Error(data.message ?? data.error ?? "Could not enable phone notifications.");
  if (!data.enabled) throw new Error("Push subscription was not enabled by the server.");
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
