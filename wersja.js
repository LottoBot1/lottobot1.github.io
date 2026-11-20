/* Typer49 – numer wersji aplikacji pokazywany na dole zakładki Więcej.
   Jedno źródło: stała VERSION w sw.js (np. 'typer49-v2.9.2'). Aplikacja pyta działający service worker,
   którą wersję faktycznie załadował; gdy go nie ma (pierwsze otwarcie, przeglądarka bez service workera),
   odczytuje VERSION z pliku sw.js na serwerze. Funkcje czyste (label, fromSource) są testowane w tests/wersja.test.js. */
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

  const api = { label, fromSource, loaded };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperWersja = api;
})(typeof window !== 'undefined' ? window : globalThis);
