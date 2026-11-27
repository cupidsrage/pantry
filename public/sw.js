// Bump CACHE when the app shell changes so clients pick up the new version.
const CACHE = "pantry-v12";
// The lib modules are ES imports from index.html, so a cold offline start needs
// them cached alongside the page itself. test/client.test.js keeps this in sync.
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg",
  "/lib/units.js", "/lib/expiry.js", "/lib/pantry.js", "/lib/recipes.js",
  "/lib/durations.js", "/lib/cookalong.js", "/lib/waste.js", "/lib/offline.js", "/lib/aisles.js", "/lib/speech.js"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // The page imports its modules tagged with the server's version
    // ("/lib/units.js?v=abc1234", see server.js), so those exact URLs are what
    // an offline start asks for. Read them out of the page and cache them too.
    try {
      const page = await (await c.match("/")).text();
      const libs = [...page.matchAll(/from\s*"(\/lib\/[^"]+)"/g)].map((m) => m[1]);
      await c.addAll([...new Set(libs)]);
    } catch { /* they're cached as they load instead */ }
    await self.skipWaiting();
  })());
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
  // "Offline" in a store is often one bar that neither loads nor fails, so if
  // the network hasn't answered in 3 s the cached copy is served instead — the
  // fetch carries on in the background and refreshes the cache for next time.
  const net = fetch(e.request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
    }
    return res;
  });
  // Registered now, while the event is still being handled: Safari refuses a
  // waitUntil() that arrives later, and that refusal would fail the request.
  e.waitUntil(net.catch(() => {}));
  e.respondWith((async () => {
    const cached = (await caches.match(e.request)) ||
      (e.request.mode === "navigate" ? await caches.match("/index.html") : undefined);
    if (!cached) return net.catch(() => caches.match("/index.html")).then((r) => r || Response.error());
    const slow = new Promise((r) => setTimeout(() => r(null), 3000));
    return (await Promise.race([net.catch(() => null), slow])) || cached;
  })());
});
