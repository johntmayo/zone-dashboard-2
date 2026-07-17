/* Zone Dashboard service worker — Phase D
 * Cache the static app shell for faster reopen / home-screen launches.
 * Never treat /api/* or sheet data as an offline source of truth.
 */
'use strict';

const SW_VERSION = 'zd-shell-v3';
const SHELL_CACHE = `shell-${SW_VERSION}`;

// Same-origin assets safe to precache. Keep this list small and deploy-bump SW_VERSION when it changes.
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/public/css/styles.css?v=2',
  '/public/js/utils.js',
  '/public/js/address-id.js',
  '/public/js/contact-checkin.js',
  '/public/images/app_icon.png'
];

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  if (!isSameOrigin(url)) return false;
  if (isApiRequest(url)) return false;
  const path = url.pathname;
  return (
    path.startsWith('/public/') ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js' ||
    /\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(path)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // Precache failure should not block install forever.
        console.warn('[sw] precache failed', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never intercept API / auth / sheet proxy traffic.
  if (isApiRequest(url)) return;

  // Navigations / HTML: network-first so deploys win quickly.
  const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
  if (request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Same-origin static assets.
  if (isStaticAsset(url)) {
    // CSS/JS change on every deploy — serve them network-first so a new deploy always wins
    // when online, falling back to cache only when offline. Images/fonts stay cache-first for speed.
    if (/\.(?:css|js)$/i.test(url.pathname)) {
      event.respondWith(networkFirstStatic(request));
    } else {
      event.respondWith(cacheFirstStatic(request));
    }
  }
});

// Network-first with a short timeout: a new deploy wins when online, but a slow/hung
// connection falls back to the saved copy quickly instead of blocking the load.
const STATIC_NETWORK_TIMEOUT_MS = 3000;

async function networkFirstStatic(request) {
  const cachedPromise = caches.match(request);

  try {
    const fresh = await fetchWithTimeout(request, STATIC_NETWORK_TIMEOUT_MS);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    // Network failed or was too slow — use the saved copy if we have one.
    const cached = await cachedPromise;
    if (cached) return cached;
    throw err;
  }
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw-network-timeout')), timeoutMs);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function networkFirstNavigation(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/', fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match('/') || await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Revalidate in background.
    fetch(request).then((response) => {
      if (response && response.ok) {
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, response)).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
