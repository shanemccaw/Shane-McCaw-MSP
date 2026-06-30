self.addEventListener("push", function (event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: event.data.text(), body: "", linkPath: null };
  }

  const title = payload.title || "Admin Panel";
  const options = {
    body: payload.body || "",
    icon: "/admin-panel/favicon.svg",
    badge: "/admin-panel/favicon.svg",
    data: { linkPath: payload.linkPath || null },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
