/* Minimaalinen service worker: network-first app-kuorelle.
 * Online -> aina tuore versio Verceliltä (ei vanhentunutta koodia).
 * Offline -> palvele viimeisin välimuistista, jotta uudelleenlataus toimii ilman verkkoa.
 * Firebase/gstatic (eri origin) ohitetaan kokonaan. */
const CACHE = 'maitoset-shell-v1';
const SHELL = ['./', './index.html', './app.js', './styles.css', './firebase-config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // ohita Firebase/gstatic ym.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
