const CACHE_NAME = "udharbook-v6";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/track/driver/")) return;
  if (url.pathname.startsWith("/driver-trip") || url.pathname.startsWith("/driver-tracking")) return;
  if (url.pathname === "/tasks" || url.pathname.startsWith("/tasks/")) return;
  if (url.pathname.startsWith("/_next/")) return;
  if (request.mode === "navigate" || request.destination === "document") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "UDHARBOOK_SCHEDULE_NOTIFY") {
    const scheduledAt = Number(event.data.scheduledAt);
    if (!Number.isFinite(scheduledAt)) return;
    const delay = scheduledAt - Date.now();
    if (delay <= 0) {
      event.waitUntil(showUdharBookNotification(event.data));
      return;
    }
    const showTrigger = self.TimestampTrigger ? new self.TimestampTrigger(scheduledAt) : undefined;
    if (showTrigger) {
      event.waitUntil(showUdharBookNotification({ ...event.data, showTrigger }));
      return;
    }
    if (delay <= 24 * 60 * 60 * 1000) {
      setTimeout(() => {
        showUdharBookNotification(event.data);
      }, delay);
    }
    return;
  }
  if (event.data?.type !== "UDHARBOOK_NOTIFY") return;
  event.waitUntil(showUdharBookNotification(event.data));
});

function showUdharBookNotification(data) {
  const title = data.title || "UdharBook reminder";
  const body = data.body || "A follow-up is due.";
  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    requireInteraction: data.requireInteraction ?? true,
    tag: data.tag,
    data: { url: data.url || "/follow-ups" },
  };
  if (data.showTrigger) options.showTrigger = data.showTrigger;
  return self.registration.showNotification(title, options);
}

self.addEventListener("messageerror", () => undefined);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { body: event.data?.text() || "You have a new UdharBook notification." };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "UdharBook", {
      body: data.body || "You have a new notification.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      requireInteraction: Boolean(data.requireInteraction),
      tag: data.tag,
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url;
  const targetUrl = typeof requestedUrl === "string" && requestedUrl.startsWith("/") ? requestedUrl : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if ("navigate" in client) await client.navigate(targetUrl);
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
