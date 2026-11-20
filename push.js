/* Typer49 – powiadomienia po losowaniu (Etap 4, krok 3): obsługa w przeglądarce.
   Android: przeglądarka i zainstalowana aplikacja. iPhone/iPad: tylko aplikacja dodana do ekranu
   początkowego, iOS 16.4+. Funkcje czyste (support, autoEnable, iosVersion, keyBytes) są testowane w tests/push.test.js. */
(function (root) {
  'use strict';

  // Wersja iOS z napisu przeglądarki, np. "iPhone OS 17_4" → [17, 4]; null, gdy to nie iOS lub brak wersji.
  function iosVersion(ua = '') {
    const m = /(?:iPhone|CPU) OS (\d+)_(\d+)/i.exec(ua) || /Version\/(\d+)\.(\d+).*Safari/i.exec(ua);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  /* Czy na tym urządzeniu da się włączyć powiadomienia:
     'ok' | 'ios-install' (iPhone w Safari – najpierw dodaj do ekranu początkowego) |
     'ios-old' (iOS starszy niż 16.4) | 'unsupported' (przeglądarka bez powiadomień). */
  function support(env) {
    const { os, ua = '', standalone = false, hasSW = false, hasPush = false, hasNotification = false } = env || {};
    if (os === 'ios') {
      const v = iosVersion(ua);
      if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return 'ios-old';
      if (!standalone) return 'ios-install';
    }
    return hasSW && hasPush && hasNotification ? 'ok' : 'unsupported';
  }

  /* Czy po zalogowaniu (albo przy starcie) włączyć powiadomienia samemu, bez pytania:
     to konto włączyło je wcześniej na tym urządzeniu (wanted = id konta), przeglądarka ma już zgodę,
     urządzenie obsługuje powiadomienia, a adresu powiadomień jeszcze nie ma. */
  function autoEnable(s) {
    const { wanted = null, userId = null, permission = 'default', support: sup = 'unsupported', hasSub = false, online = true } = s || {};
    return !!userId && wanted === userId && permission === 'granted' && sup === 'ok' && !hasSub && online !== false;
  }

  // Klucz publiczny VAPID (base64url) → bajty dla pushManager.subscribe.
  function keyBytes(b64url) {
    const s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
    const bin = (typeof atob === 'function' ? atob : x => Buffer.from(x, 'base64').toString('binary'))(s + '='.repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  // ---------------------------------------------------------- przeglądarka
  function env() {
    const T = root.TyperTime;
    const nav = root.navigator || {};
    return {
      os: T ? T.devicePlatform(nav.userAgent, nav.platform, nav.maxTouchPoints || 0) : 'other',
      ua: nav.userAgent || '',
      standalone: !!(nav.standalone || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches)),
      hasSW: 'serviceWorker' in nav,
      hasPush: 'PushManager' in root,
      hasNotification: 'Notification' in root,
    };
  }
  const state = () => support(env());
  const permission = () => ('Notification' in root ? root.Notification.permission : 'denied');

  const timeout = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));

  async function registration() {
    if (!('serviceWorker' in (root.navigator || {}))) return null;
    return (await root.navigator.serviceWorker.getRegistration()) || null;
  }
  // Obecny adres powiadomień tego urządzenia (albo null). Nigdy nie wisi dłużej niż 3 s.
  async function current() {
    try {
      return await Promise.race([(async () => { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null; })(), timeout(3000, null)]);
    } catch { return null; }
  }
  // Prośba o zgodę i zapis u dostawcy powiadomień. Musi być wywołane z kliknięcia.
  async function subscribe(publicKey) {
    const perm = await root.Notification.requestPermission();
    if (perm !== 'granted') return null;
    const reg = await root.navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription();
    if (old) return old;
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  // Zapis u dostawcy bez pytania o zgodę – tylko gdy zgoda już jest (automatyczne włączenie po zalogowaniu).
  // Safari na iPhonie może wymagać stuknięcia – wtedy zwraca null albo rzuca błąd. Nigdy nie wisi dłużej niż 10 s.
  async function subscribeGranted(publicKey) {
    if (permission() !== 'granted') return null;
    return Promise.race([(async () => {
      const reg = await root.navigator.serviceWorker.ready;
      return (await reg.pushManager.getSubscription()) ||
             reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    })(), timeout(10000, null)]);
  }
  // Wypisanie u dostawcy – od tej chwili dostawca odrzuca wysyłki na ten adres (404/410), a funkcja usuwa go z bazy.
  async function unsubscribeLocal() {
    const sub = await current();
    if (sub) { try { await sub.unsubscribe(); } catch { /* ignore */ } }
    return sub;
  }

  const api = { iosVersion, support, autoEnable, keyBytes, env, state, permission, current, subscribe, subscribeGranted, unsubscribeLocal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperPush = api;
})(typeof window !== 'undefined' ? window : globalThis);
