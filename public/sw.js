const CACHE_NAME = 'rill-app-shell-v1';
const CORE_URLS = ['/manifest.webmanifest', '/icon.svg'];
const SHELL_ASSET_PATTERN = /(?:src|href)=["']([^"']+)["']/g;

function shellAssetUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(SHELL_ASSET_PATTERN)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin !== self.location.origin) continue;
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/@vite/') || url.pathname === '/src/client/main.tsx') {
      urls.add(`${url.pathname}${url.search}`);
    }
  }
  return [...urls];
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch('/index.html', { cache: 'reload' });
  if (indexResponse.ok) {
    const indexHtml = await indexResponse.text();
    const cachedIndex = new Response(indexHtml, {
      status: indexResponse.status,
      statusText: indexResponse.statusText,
      headers: indexResponse.headers
    });
    await cache.put('/index.html', cachedIndex.clone());
    await cache.put('/', cachedIndex.clone());
    await Promise.all([...CORE_URLS, ...shellAssetUrls(indexHtml)].map((url) => cache.add(url).catch(() => undefined)));
    return;
  }
  await cache.addAll(['/', '/index.html', ...CORE_URLS]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('/index.html').then((cached) => cached || fetch(event.request)));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
