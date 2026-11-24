/* COMPTIVA PWA shell cache. No customer records or API responses are cached. */
const CACHE_NAME = 'comptiva-pwa-shell-v2';
const APP_URL = new URL('./application.html', self.registration.scope).href;
const SHELL_URLS = [
  APP_URL,
  new URL('./manifest.webmanifest', self.registration.scope).href,
  new URL('./icons/comptiva.svg', self.registration.scope).href
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)));
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'COMPTIVA_SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('comptiva-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.href === APP_URL) {
    event.respondWith(fetch(request).then(response => {
      if (!response || !response.ok) return response;
      const copy = response.clone();
      return caches.open(CACHE_NAME)
        .then(cache => cache.put(APP_URL, copy))
        .then(() => response);
    }).catch(() => caches.match(APP_URL)));
    return;
  }
  if (SHELL_URLS.includes(url.href)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});
