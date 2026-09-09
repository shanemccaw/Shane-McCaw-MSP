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

// The placeholder in the CACHE string below is substituted server-side (server.mjs's /sw.js
// handler) with the running deploy's real git commit sha -- see Git #3334. That ties this cache
// version to every real deploy automatically; nobody has to remember to bump it by hand again.
const CACHE = "shanes-life-shell-__SW_BUILD_ID__";
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
  // Real design-system tokens (Git #3120) -- app.css/share.html both need these to render.
  "/tokens/tokens.css",
  "/tokens/fonts.css",
  "/tokens/colors.css",
  "/tokens/typography.css",
  "/tokens/spacing.css",
  "/tokens/elevation.css",
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

// Web push. iOS 16.4+ delivers these to a Home-Screen web app's lock screen. Real sending is now
// wired server-side (src/push/webpush.mjs + src/core/push-subscriptions.mjs, Git #3160), pushed
// from queueNudge() whenever a real nudge actually sends (not held). The payload carries real
// `actions` (mark done / snooze / dismiss, per nudge kind -- see nudges.mjs actionsForKind) so
// this handler can show them as real slide-down action buttons.
self.addEventListener("push", (event) => {
  let payload = { title: "Shane's Life", body: "", url: "/", actions: [] };
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
      tag: payload.tag,
      // Real UNNotificationCategory-style action buttons. Chrome/Android honors these fully.
      // Safari's Home-Screen web-push support for `actions` is genuinely unverified from this
      // build (no physical iPhone to test against -- see build-journal/3160.md) -- if Safari
      // ignores the array, showNotification still succeeds and the tap-to-open path below is
      // the real, already-working fallback the design contract names for exactly this case.
      actions: (payload.actions || []).slice(0, 2).map((a) => ({ action: a.action, title: a.title })),
      data: { url: payload.url, nudgeId: payload.nudgeId },
    }),
  );
});

// Real act-on-notification (Git #3160): tapping a real action button fires this WITHOUT opening
// the app -- a background fetch straight to /api/nudges/:id/action, same-origin so the session
// cookie rides along automatically. Tapping the notification body itself (no action, or an iOS
// Safari that doesn't honor `actions` at all) falls through to the existing open-the-app
// behavior, which is the design contract's own stated fallback for exactly this uncertainty.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, nudgeId } = event.notification.data || {};
  const target = url || "/";

  if (event.action && nudgeId) {
    event.waitUntil(
      fetch(`/api/nudges/${nudgeId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: event.action }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`action fetch failed: ${res.status}`);
          // A real, quiet confirmation -- no window to focus, nothing to navigate. If a "done"
          // or "dismiss" tap fails (session expired, offline), fall back to opening the app so
          // it isn't silently lost.
        })
        .catch(() => openOrFocus(target)),
    );
    return;
  }

  event.waitUntil(openOrFocus(target));
});

function openOrFocus(target) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("focus" in client) {
        client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  });
}
