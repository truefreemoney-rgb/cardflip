/* CardFlip service worker — Web Push (Tier 2 #9) and one offline page. The app
   is online-only by design: the ONLY thing cached is /offline.html, shown when a
   page navigation fails with no network. No API response and no page is cached. */

const OFFLINE_CACHE = "cardflip-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  // A failed cache write must not block the install (push still has to work).
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n)))),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "CardFlip", body: "", url: "/app", tag: "cardflip" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* a plain-text payload: keep the defaults */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
