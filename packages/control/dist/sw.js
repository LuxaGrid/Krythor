// Krythor PWA Service Worker
// CACHE_NAME is injected by scripts/deploy-dist.js at build time.
// Changing it forces all clients to evict old cached assets on next load.
//
// Caching strategy:
//   - /assets/* (content-hashed)  → cache-first, immutable (safe forever)
//   - /index.html, /manifest.json → network-first (picks up new bundles immediately)
//   - /api/*, /ws/*               → network-only (never cache live data)
//   - everything else             → network-first with cache fallback

const CACHE_NAME = 'krythor-0.1.0-1774370258444'; // replaced by deploy-dist.js

// ── Install ────────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately (don't wait for tab close)
  event.waitUntil(self.skipWaiting());
});

// ── Activate ───────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  // Delete all caches from previous versions, claim clients, then tell every
  // open tab to reload so they pick up the new bundle immediately.
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' })))
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API + WebSocket — network-only, never cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Hashed assets (/assets/index-XXXX.js, /assets/index-XXXX.css, fonts)
  // These are safe to cache forever — the hash changes when content changes.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // index.html, manifest.json, logo.png — network-first so new bundles
  // are picked up immediately without requiring a hard refresh.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached || new Response('Offline', { status: 503 });
      })
  );
});
