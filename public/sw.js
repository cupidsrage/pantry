// Bump CACHE when the app shell changes so clients pick up the new version.
const CACHE = "pantry-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Reminder pushes carry no payload — they just wake this worker up. The text
// lives on the server, keyed by this device's subscription endpoint.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch("/api/push/pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (r.ok) items = (await r.json()).items || [];
      }
    } catch {}
    // A push must always show something, so fall back to a nudge if the fetch
    // failed (offline, server down) rather than letting the browser say
    // "this site was updated in the background".
    if (!items.length) items = [{ title: "Pantry reminder", body: "Open the app to see what's next.", tag: "pantry" }];
    await Promise.all(items.map((n) =>
      self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag || undefined,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      })));
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all.find((c) => c.url.includes(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow("/");
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API traffic — always hit the network so data stays live.
  if (url.pathname.startsWith("/api/")) return;
  if (e.request.method !== "GET") return;

  // App shell: network-first so updates land, falling back to cache offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
