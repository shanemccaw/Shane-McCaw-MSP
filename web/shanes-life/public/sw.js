// Service worker.
//
// Two jobs, and deliberately no more:
//   1. Make the app shell load instantly and survive a dead connection.
//   2. Exist at all -- iOS requires a registered service worker and a manifest before it will
//      grant web push to a Home Screen web app (contract pack Section 10).
//
// It NEVER caches an API response. Every row on screen must come from a live read; a cached
// /api/entities would be indistinguishable from fixture data the moment it went stale, which is
// exactly the failure this project has already paid for once.

const CACHE = "shanes-life-shell-v2";
const SHELL = [
  "/",
  "/index.html",
  "/share.html",
  "/app.css",
  "/app.js",
  "/critters.js",
  "/critters-sprite.svg",
  "/share.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // Never intercept data, media, MCP or health.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp") || url.pathname === "/healthz") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // A share URL and any client-side route both fall back to their own shell.
        const shell = url.pathname.startsWith("/s/") ? "/share.html" : "/index.html";
        return (await caches.match(shell)) || Response.error();
      }),
  );
});

// Web push. iOS 16.4+ delivers these to a Home-Screen web app's lock screen. Nothing sends one
// yet -- the notification tray that will (contract pack Section 3) is a later Feature -- but the
// handler exists so the subscription surface is real when it lands.
self.addEventListener("push", (event) => {
  let payload = { title: "Shane's Life", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
