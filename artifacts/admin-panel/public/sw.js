self.addEventListener("push", function (event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: event.data.text(), body: "", linkPath: null, playSound: false };
  }

  const title = payload.title || "Admin Panel";
  const options = {
    body: payload.body || "",
    icon: "/admin-panel/favicon.svg",
    badge: "/admin-panel/favicon.svg",
    data: { linkPath: payload.linkPath || null, playSound: !!payload.playSound },
    requireInteraction: false,
  };

  // If this push requests a sound, broadcast PLAY_PURCHASE_SOUND to all open
  // admin-panel clients so the tab can play it (or queue it for next focus).
  if (payload.playSound) {
    event.waitUntil(
      Promise.all([
        self.registration.showNotification(title, options),
        clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then(function (windowClients) {
            for (let i = 0; i < windowClients.length; i++) {
              if (windowClients[i].url.includes("/admin-panel")) {
                windowClients[i].postMessage({ type: "PLAY_PURCHASE_SOUND" });
              }
            }
          }),
      ])
    );
  } else {
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const linkPath = event.notification.data && event.notification.data.linkPath;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          const url = client.url;
          if (url.includes("/admin-panel")) {
            if (linkPath) {
              client.postMessage({ type: "NAVIGATE", path: linkPath });
            }
            return client.focus();
          }
        }
        const target = linkPath
          ? "/admin-panel" + linkPath
          : "/admin-panel/";
        return clients.openWindow(target);
      })
  );
});
