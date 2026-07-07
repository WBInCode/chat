// Minimal service worker for Web Push. Registered from lib/push.ts.
// Kept dependency-free (no build step) since it must be served as a
// static file at the origin root for the correct push scope.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "chatv2", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "chatv2", {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { channelId: payload.channelId, messageId: payload.messageId },
      tag: payload.channelId // collapse multiple notifications from the same channel
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const channelId = event.notification.data?.channelId;
  const messageId = event.notification.data?.messageId;
  const url = channelId && messageId ? `/?channel=${channelId}&msg=${messageId}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
