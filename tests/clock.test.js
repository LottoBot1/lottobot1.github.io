// Testy wykrywania przestawionego zegara urządzenia (time.js: measureOffset, activeOffset, ...).
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../time.js');

const MIN = 60000, H = 60 * MIN;
const SERVER = Date.parse('2026-11-19T12:00:00Z');   // prawdziwy czas w chwili odpowiedzi serwera
const httpDate = ms => new Date(ms).toUTCString();    // format nagłówka Date

// Symulacja zapytania: zegar urządzenia przesunięty o `skew` względem serwera, zapytanie trwa `rtt` ms.
function ask({ skew = 0, rtt = 200, age, dateMs = SERVER } = {}) {
  const sent = SERVER - rtt / 2 + skew, received = SERVER + rtt / 2 + skew;
  return T.measureOffset({ date: httpDate(dateMs), age, sent, received });
}
const near = (actual, expected, tol = 1500) =>
  assert.ok(Math.abs(actual - expected) <= tol, `oczekiwano ok. ${expected} ms, jest ${actual} ms`);

test('dobrze ustawiony zegar: różnica bliska zeru', () => {
  near(ask({ skew: 0 }), 0);
});

test('zegar urządzenia spóźnia się o 20 min: różnica dodatnia', () => {
  near(ask({ skew: -20 * MIN }), 20 * MIN);
  assert.equal(T.clockIsWrong(ask({ skew: -20 * MIN })), true);
});

test('zegar urządzenia śpieszy się o 2 godz.: różnica ujemna', () => {
  near(ask({ skew: 2 * H }), -2 * H);
});

test('próg ostrzeżenia: 15 min', () => {
  assert.equal(T.clockIsWrong(14 * MIN), false);
  assert.equal(T.clockIsWrong(-14 * MIN), false);
  assert.equal(T.clockIsWrong(16 * MIN), true);
  assert.equal(T.clockIsWrong(-16 * MIN), true);
  assert.equal(T.clockIsWrong(undefined), false);
});

test('odpowiedź z pamięci podręcznej (nagłówek Age) nie udaje przestawionego zegara', () => {
  // CDN zapamiętał odpowiedź 10 min temu: Date jest stary, Age = 600 s
  const off = ask({ skew: 0, dateMs: SERVER - 10 * MIN, age: '600' });
  near(off, 0);
  assert.equal(T.clockIsWrong(off), false);
  // bez uwzględnienia Age wyszłoby -10 min – sprawdzamy, że Age naprawdę jest liczony
  near(ask({ skew: 0, dateMs: SERVER - 10 * MIN }), -10 * MIN);
});

test('czas trwania zapytania jest uwzględniony (długie zapytanie, 8 s)', () => {
  near(ask({ skew: 0, rtt: 8000 }), 0);
});

test('pomiar niewiarygodny → null (zostaje poprzednia różnica albo zegar telefonu)', () => {
  assert.equal(T.measureOffset({ date: null, sent: 1, received: 2 }), null);           // brak nagłówka Date
  assert.equal(T.measureOffset({ date: 'bzdura', sent: 1, received: 2 }), null);
  assert.equal(ask({ rtt: 45000 }), null);                                             // zapytanie > 30 s
  assert.equal(T.measureOffset({ date: httpDate(SERVER), sent: 2000, received: 1000 }), null); // zegar cofnięty w trakcie
  assert.equal(ask({ age: 'x' }), null);
  assert.equal(ask({ age: '-5' }), null);
  assert.equal(T.measureOffset(), null);
});

test('zapamiętana różnica działa bez internetu do 24 godzin', () => {
  const saved = { offset: 20 * MIN, at: SERVER };
  assert.equal(T.activeOffset(saved, SERVER + 5 * MIN), 20 * MIN);
  assert.equal(T.activeOffset(saved, SERVER + 23 * H), 20 * MIN);
  assert.equal(T.activeOffset(saved, SERVER + 24 * H), 20 * MIN);
});

test('przestarzała zapamiętana różnica (ponad 24 h) → zegar telefonu', () => {
  const saved = { offset: 20 * MIN, at: SERVER };
  assert.equal(T.activeOffset(saved, SERVER + 24 * H + 1), 0);
  assert.equal(T.activeOffset(saved, SERVER + 3 * 24 * H), 0);
  // pomiar „z przyszłości” (zegar cofnięty po pomiarze) też nie jest używany
  assert.equal(T.activeOffset(saved, SERVER - 2 * H), 0);
});

test('brak internetu i brak zapamiętanych danych (np. iPhone wyczyścił pamięć) → zegar telefonu, bez błędów', () => {
  for (const saved of [null, undefined, {}, 'tekst', 42, { offset: 'x', at: SERVER }, { offset: 5 * MIN }, { at: SERVER }, { offset: NaN, at: SERVER }]) {
    assert.equal(T.activeOffset(saved, SERVER), 0, JSON.stringify(saved));
  }
  assert.equal(T.activeOffset({ offset: 5 * MIN, at: SERVER }, NaN), 0);
});

test('poprawiona godzina zakładu trafia do właściwego losowania', () => {
  // prawdziwy czas: czwartek 19.11.2026 21:50 (czas polski), zegar telefonu spóźnia się o 30 min (21:20)
  const real = Date.parse('2026-11-19T20:50:00Z');
  const device = real - 30 * MIN;
  const off = T.measureOffset({ date: httpDate(real), sent: device - 100, received: device + 100 });
  const betTime = new Date(device + T.activeOffset({ offset: off, at: device }, device));
  near(+betTime, real);
  // zakład tuż przed 22:00 → czwartkowe losowanie (tak samo jak w bazie)
  assert.equal(T.nextScheduledDraw(betTime).date, '2026-11-19');
});

test('system urządzenia do wskazówki o ustawieniu czasu', () => {
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  assert.equal(T.devicePlatform(android, 'Linux armv8l', 5), 'android');
  assert.equal(T.devicePlatform(iphone, 'iPhone', 5), 'ios');
  assert.equal(T.devicePlatform(mac, 'MacIntel', 5), 'ios');       // iPad w trybie „komputerowym”
  assert.equal(T.devicePlatform(mac, 'MacIntel', 0), 'other');     // prawdziwy Mac
  assert.equal(T.devicePlatform(win, 'Win32', 0), 'other');
  assert.equal(T.devicePlatform(), 'other');
});
