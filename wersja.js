/* Typer49 – numer wersji aplikacji pokazywany na dole zakładki Więcej.
   Jedno źródło: stała VERSION w sw.js (np. 'typer49-v2.9.2'). Aplikacja pyta działający service worker,
   którą wersję faktycznie załadował; gdy go nie ma (pierwsze otwarcie, przeglądarka bez service workera),
   odczytuje VERSION z pliku sw.js na serwerze. Tu jest też logika paska „Dostępna nowa wersja – Odśwież”.
   Funkcje czyste (label, fromSource, shouldOffer, packSnapshot, unpackSnapshot) są testowane w tests/wersja.test.js. */
(function (root) {
  'use strict';

  // 'typer49-v2.9.2' → 'v2.9.2'; null, gdy napis ma inny format.
  function label(version) {
    const m = /^typer49-(v\d+\.\d+\.\d+)$/.exec(String(version || '').trim());
    return m ? m[1] : null;
  }

  // Treść pliku sw.js → wartość stałej VERSION (albo null).
  function fromSource(text) {
    const m = /const\s+VERSION\s*=\s*'([^']+)'/.exec(String(text || ''));
    return m ? m[1] : null;
  }

  const timeout = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));

  // Wersja działającego service workera (odpowiedź na wiadomość {type: 'wersja'}); null po 2 s bez odpowiedzi.
  async function fromWorker() {
    const sw = root.navigator && root.navigator.serviceWorker;
    const ctl = sw && sw.controller;
    if (!ctl || typeof MessageChannel === 'undefined') return null;
    const ch = new MessageChannel();
    const answer = new Promise(r => { ch.port1.onmessage = e => r(e.data); });
    try { ctl.postMessage({ type: 'wersja' }, [ch.port2]); } catch { return null; }
    return Promise.race([answer, timeout(2000, null)]);
  }

  // {text: 'Typer49 v2.9.2', source: 'sw' | 'plik'} albo null, gdy wersji nie da się ustalić.
  async function loaded() {
    let v = label(await fromWorker().catch(() => null));
    if (v) return { text: 'Typer49 ' + v, source: 'sw' };
    try {
      const res = await Promise.race([root.fetch('sw.js', { cache: 'no-store' }), timeout(4000, null)]);
      v = res && res.ok ? label(fromSource(await res.text())) : null;
    } catch { v = null; }
    return v ? { text: 'Typer49 ' + v, source: 'plik' } : null;
  }

  // ---------------------------------------------------------------- nowa wersja – pasek „Odśwież” (backlog d)
  // Pasek pokazujemy, gdy na serwerze jest inna wersja niż ta, na której działa otwarta strona
  // (także przy cofnięciu do last-good). Obie wersje muszą mieć poprawny format.
  function shouldOffer(pageVersion, serverVersion) {
    const a = label(pageVersion), b = label(serverVersion);
    return !!(a && b && a !== b);
  }

  // Wersja na serwerze: stała VERSION z sw.js pobranego z sieci; null bez internetu albo po 4 s.
  async function fromServer() {
    try {
      const res = await Promise.race([root.fetch('sw.js?wersja=' + Date.now(), { cache: 'no-store' }), timeout(4000, null)]);
      return res && res.ok ? fromSource(await res.text()) : null;
    } catch { return null; }
  }

  // Niezapisana praca (wybrane liczby, wygenerowane zestawy, system, kupon) przechowana na chwilę
  // na czas przeładowania strony; po 10 minutach nieaktualna.
  const SNAPSHOT_MAX_MS = 10 * 60 * 1000;
  function packSnapshot(data, nowMs) {
    try { return JSON.stringify({ v: 1, t: nowMs, data }); } catch { return null; }
  }
  function unpackSnapshot(text, nowMs) {
    try {
      const s = JSON.parse(text);
      if (!s || s.v !== 1 || typeof s.t !== 'number' || !s.data || typeof s.data !== 'object') return null;
      if (nowMs - s.t > SNAPSHOT_MAX_MS || s.t - nowMs > 60 * 1000) return null;
      return s.data;
    } catch { return null; }
  }

  const api = { label, fromSource, loaded, fromWorker, fromServer, shouldOffer, packSnapshot, unpackSnapshot, SNAPSHOT_MAX_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperWersja = api;
})(typeof window !== 'undefined' ? window : globalThis);
