// Testy service workera (sw.js): pliki aplikacji zawsze z serwera, z pominięciem pamięci HTTP przeglądarki.
// Bez tego tuż po publikacji w cache nowej wersji mogły zostać stare pliki (GitHub Pages: max-age=600).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const BASE = 'https://typer.test/';

// Uruchamia sw.js z atrapami przeglądarki; zapisuje, co i z jaką opcją pamięci było pobierane.
function load({ online = true } = {}) {
  const handlers = {}, fetches = [], added = [], puts = [];
  class FakeRequest {
    constructor(input, init = {}) {
      this.url = new URL(typeof input === 'string' ? input : input.url, BASE).href;
      this.method = init.method || 'GET';
      this.cache = init.cache || 'default';
    }
  }
  const response = () => ({ ok: true, clone() { return this; } });
  const cache = {
    addAll: async list => { for (const r of list) added.push(r); },
    add: async () => {},
    put: async (key, res) => { puts.push(typeof key === 'string' ? key : key.url); },
  };
  const sandbox = {
    URL, Request: FakeRequest, location: { origin: new URL(BASE).origin },
    caches: { open: async () => cache, keys: async () => [], match: async () => 'Z CACHE' },
    fetch: async (req, init) => {
      fetches.push({ url: req.url, cache: (init && init.cache) || req.cache });
      if (!online) throw new Error('offline');
      return response();
    },
    self: { addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
  };
  vm.runInNewContext(SOURCE, sandbox);
  return {
    fetches, added, puts,
    async install() { let p; handlers.install({ waitUntil: x => { p = x; } }); await p; },
    // Zwraca { handled, result }: handled = false → przeglądarka obsługuje zapytanie sama.
    async get(url, init) {
      let p;
      handlers.fetch({ request: new FakeRequest(url, init), respondWith: x => { p = x; } });
      return { handled: !!p, result: p && await p };
    },
  };
}

test('instalacja: każdy plik z SHELL pobierany z cache: reload', async () => {
  const sw = load();
  await sw.install();
  const shell = vm.runInNewContext(/const SHELL = (\[[^\]]+\]);/.exec(SOURCE)[1]);
  assert.ok(shell.length > 10);
  assert.deepEqual(sw.added.map(r => r.url), [...shell].map(f => new URL(f, BASE).href));
  for (const r of sw.added) assert.equal(r.cache, 'reload', r.url);
});

test('pliki aplikacji (HTML, CSS, JS, manifest): sieć z cache: no-cache i zapis do cache', async () => {
  for (const f of ['./', 'index.html', 'app.css', 'app.js', 'zmiany.js', 'privacy.html', 'manifest.webmanifest']) {
    const sw = load();
    const { handled } = await sw.get(f);
    assert.ok(handled, f);
    assert.deepEqual(sw.fetches, [{ url: new URL(f, BASE).href, cache: 'no-cache' }]);
    await new Promise(r => setImmediate(r));
    assert.deepEqual(sw.puts, [new URL(f, BASE).href]);
  }
});

test('bez internetu pliki aplikacji nadal z cache', async () => {
  const sw = load({ online: false });
  assert.equal((await sw.get('app.js')).result, 'Z CACHE');
});

test('wyniki (data/) i biblioteka z CDN: pobieranie bez zmian', async () => {
  const sw = load();
  await sw.get('data/lotto.json');
  assert.deepEqual(sw.fetches, [{ url: BASE + 'data/lotto.json', cache: 'default' }]);
  const cdn = load();
  assert.equal((await cdn.get(/const CDN = '([^']+)'/.exec(SOURCE)[1])).result, 'Z CACHE');
  assert.deepEqual(cdn.fetches, []);
});

test('Supabase, pomiar zegara i sprawdzanie wersji: service worker się nie wtrąca', async () => {
  const sw = load();
  assert.equal((await sw.get('https://baza.supabase.co/rest/v1/bets')).handled, false);
  assert.equal((await sw.get('manifest.webmanifest?clock=1', { method: 'HEAD' })).handled, false);
  assert.equal((await sw.get('manifest.webmanifest?clock=1')).handled, false);
  assert.equal((await sw.get('sw.js?wersja=1')).handled, false);
  assert.deepEqual(sw.fetches, []);
});
