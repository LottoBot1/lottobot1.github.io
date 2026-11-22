// Service worker: aplikacja działa offline, a wyniki zawsze pobierane są najpierw z sieci.
const VERSION = 'typer49-v2.9.4';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'cloud.js', 'time.js', 'bilans.js', 'systemy.js', 'push.js', 'dostep.js', 'wersja.js', 'privacy.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(SHELL);
    try { await c.add(CDN); } catch { /* CDN niedostępny – spróbujemy przy następnym uruchomieniu */ }
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;      // m.in. HEAD z pomiarem czasu (app.js syncClock) – zawsze sieć
  if (url.searchParams.has('clock')) return;    // pomiar czasu nigdy z pamięci podręcznej

  // Biblioteka Supabase z CDN – wersja przypięta, więc najpierw cache.
  if (url.href === CDN) {
    e.respondWith(caches.match(CDN).then(r => r || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(CDN, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;   // API Supabase itp. – zawsze sieć, bez cache

  // Dane: najpierw sieć, w razie braku – ostatnia zapisana kopia.
  if (url.pathname.includes('/data/')) {
    const key = new Request(url.origin + url.pathname);
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key))
    );
    return;
  }

  // Pliki aplikacji: sieć z fallbackiem do cache (aktualizacje widać od razu).
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// Numer wersji dla aplikacji (wersja.js) – pokazuje, która wersja jest faktycznie załadowana.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'wersja' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
});

// Powiadomienia (Etap 4, krok 3). Treść układa funkcja Supabase „powiadomienia”.
// Każde powiadomienie musi zostać pokazane (wymóg Chrome i Safari), więc zawsze jest jakiś tekst.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Typer49'), {
    body: String(d.body || 'Nowe wyniki w Typer49'),
    icon: 'icons/icon-192.png',
    tag: String(d.tag || 'typer49'),
    data: { url: String(d.url || './#bets') },
  }));
});

// Kliknięcie: otwórz ekran Zakłady (w otwartym oknie aplikacji albo w nowym).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#bets', self.registration.scope);
  if (url.origin !== location.origin) return;   // tylko własne adresy
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).origin === location.origin);
    if (win) {
      await win.focus();
      try { await win.navigate(url.href); } catch { /* starsze przeglądarki – okno i tak jest na wierzchu */ }
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
