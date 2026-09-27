/*
 * Offline shell for a published game. Plain JS on purpose: this file is copied
 * verbatim from `public/` and must run without a build step or bundler helpers.
 *
 * Why: a game page is opened from a phone home screen, on hotel wifi, in a
 * subway. Once the first visit lands, every asset (art sheets, audio, the JS
 * bundle) is on disk and the game starts with no network at all.
 *
 * How it stays fresh — no version bumping by hand:
 *   1. `index.html` (and any navigation) is network-first, so a fresh deploy is
 *      picked up on the next online load; the cache is only its fallback.
 *   2. Vite fingerprints every built bundle (`assets/index-<hash>.js`), so those
 *      URLs are immutable and served cache-first. Old entries stop being asked
 *      for and the activate sweep drops them with the cache generation.
 *   3. Everything else under `public/` (art sheets, audio, icons, the manifest)
 *      keeps a stable path across deploys, so it is stale-while-revalidate:
 *      instant from cache, quietly refreshed in the background. That also keeps
 *      local `vite preview` honest when two games reuse the same port.
 * Bump CACHE only to force-drop everything (e.g. a poisoned entry); the
 * activate handler deletes every other `game-` cache of this origin.
 */
const CACHE = 'game-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('game-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Cache the response only when it is a usable, complete same-origin body. */
async function put(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Never touch POSTs, range requests or cross-origin traffic (analytics pings,
  // CDN fonts): letting them fall through keeps this worker invisible.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  const isNavigation =
    request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // Network-first: a redeploy must not be shadowed by a stale index.html.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          await put(request, fresh);
          return fresh;
        } catch {
          const cached = (await caches.match(request)) || (await caches.match('./'));
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Vite build output: `<name>-<8+ hex>.<ext>` is content-addressed, so a hit is
  // by definition current — serve it and never re-fetch.
  const immutable = /-[0-9a-f]{8,}\.[a-z0-9]+$/i.test(new URL(request.url).pathname);

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached && immutable) return cached;
      if (cached) {
        // Stale-while-revalidate: the player waits for nobody; the copy on disk
        // is replaced for the next load if the network has something newer.
        event.waitUntil(
          fetch(request)
            .then((fresh) => put(request, fresh))
            .catch(() => {
              /* offline — the cached copy already answered */
            }),
        );
        return cached;
      }
      const fresh = await fetch(request);
      await put(request, fresh);
      return fresh;
    })(),
  );
});
