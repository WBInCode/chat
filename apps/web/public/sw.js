// Service worker for chatv2: Web Push (registered from lib/push.ts) + an
// offline app-shell cache (registered from main.tsx in production).
//
// Kept dependency-free (no build step) since it must be served as a static
// file at the origin root for the correct scope. Asset URLs are hashed by
// Vite, so we cache them at runtime (stale-while-revalidate) rather than
// precaching a build manifest.

// Bumping the version in this name drops the previous cache on activation.
// v2 clears entries stored while nginx served .mjs files as
// application/octet-stream. That bad Content-Type stayed pinned in Cache
// Storage under an unchanged hashed filename, so the PDF preview kept failing
// long after the server was fixed.
const CACHE = "chatv2-shell-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|webmanifest)$/.test(url.pathname)
  );
}

/**
 * A response is only worth storing when its Content-Type matches the file
 * extension. Without this guard a single bad header from the server sticks in
 * Cache Storage forever and keeps breaking the app after the server is fixed.
 */
function responseLooksValid(url, res) {
  if (!res || res.status !== 200) return false;
  const typ = (res.headers.get("content-type") || "").toLowerCase();
  if (/\.(?:js|mjs)$/.test(url.pathname)) return typ.includes("javascript") || typ.includes("ecmascript");
  if (url.pathname.endsWith(".css")) return typ.includes("css");
  return true;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests. API, WebSockets and cross-origin
  // (R2 uploads, avatars, etc.) pass straight through to the network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  // Navigations: network-first, fall back to the cached app shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match("/").then((m) => m || caches.match(req)))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (responseLooksValid(url, res)) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          // Ignore a cached entry whose type does not match and wait for the
          // network instead, so a poisoned cache cannot serve the bad response
          // indefinitely.
          if (cached && !responseLooksValid(url, cached)) {
            cache.delete(req);
            return network;
          }
          return cached || network;
        })
      )
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Chat WB-Platform", body: event.data.text() };
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
  const url = channelId && messageId ? `/?channel=${channelId}&msg=${messageId}` : channelId ? `/?channel=${channelId}` : "/";

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
