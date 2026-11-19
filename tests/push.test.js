// Testy powiadomień – część działająca w przeglądarce (push.js).
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../push.js');
const T = require('../time.js');

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  ios17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ios164: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  ios163: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
};
const full = { hasSW: true, hasPush: true, hasNotification: true };

test('Android: powiadomienia w przeglądarce i w zainstalowanej aplikacji', () => {
  const os = T.devicePlatform(UA.android, 'Linux armv8l', 5);
  assert.equal(P.support({ os, ua: UA.android, standalone: false, ...full }), 'ok');
  assert.equal(P.support({ os, ua: UA.android, standalone: true, ...full }), 'ok');
});

test('iPhone: w Safari bez instalacji – instrukcja dodania do ekranu początkowego', () => {
  assert.equal(P.support({ os: 'ios', ua: UA.ios17, standalone: false, hasSW: true, hasPush: false, hasNotification: false }), 'ios-install');
  assert.equal(P.support({ os: 'ios', ua: UA.ios17, standalone: false, ...full }), 'ios-install');
});

test('iPhone: aplikacja na ekranie początkowym od iOS 16.4', () => {
  assert.equal(P.support({ os: 'ios', ua: UA.ios17, standalone: true, ...full }), 'ok');
  assert.equal(P.support({ os: 'ios', ua: UA.ios164, standalone: true, ...full }), 'ok');
});

test('iPhone: iOS starszy niż 16.4 – komunikat o aktualizacji', () => {
  assert.equal(P.support({ os: 'ios', ua: UA.ios163, standalone: true, ...full }), 'ios-old');
  assert.equal(P.support({ os: 'ios', ua: UA.ios163, standalone: false, ...full }), 'ios-old');
});

test('iPad udający komputer Mac jest traktowany jak iPhone', () => {
  const os = T.devicePlatform(UA.ipadDesktop, 'MacIntel', 5);
  assert.equal(os, 'ios');
  assert.equal(P.support({ os, ua: UA.ipadDesktop, standalone: false, ...full }), 'ios-install');
  assert.equal(P.support({ os, ua: UA.ipadDesktop, standalone: true, ...full }), 'ok');
});

test('przeglądarka bez powiadomień', () => {
  assert.equal(P.support({ os: 'other', ua: '', standalone: false, hasSW: true, hasPush: false, hasNotification: true }), 'unsupported');
  assert.equal(P.support({ os: 'android', ua: UA.android, hasSW: false, hasPush: true, hasNotification: true }), 'unsupported');
  assert.equal(P.support(undefined), 'unsupported');
});

test('wersja iOS z napisu przeglądarki', () => {
  assert.deepEqual(P.iosVersion(UA.ios17), [17, 4]);
  assert.deepEqual(P.iosVersion(UA.ios163), [16, 3]);
  assert.deepEqual(P.iosVersion(UA.ipadDesktop), [17, 2]);
  assert.equal(P.iosVersion(UA.android), null);
});

test('klucz publiczny VAPID z config.js to 65 bajtów punktu P-256', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'config.js'), 'utf8');
  const key = /vapidPublicKey:\s*'([^']+)'/.exec(src);
  assert.ok(key, 'brak vapidPublicKey w config.js');
  const bytes = P.keyBytes(key[1]);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);   // punkt nieskompresowany
  assert.ok(!/"d"\s*:|privateKey|PRIVATE/i.test(src.replace(/VAPID_PRIVATE_JWK/g, '')), 'w config.js nie może być klucza prywatnego');
});

test('base64url bez dopełnienia', () => {
  assert.deepEqual([...P.keyBytes('AQID')], [1, 2, 3]);
  assert.deepEqual([...P.keyBytes('_-8')], [255, 239]);
});
