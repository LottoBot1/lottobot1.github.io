// Testy logiki czasu polskiego (time.js).
// Uruchomienie: node --test tests/
// Automat na GitHubie uruchamia je w kilku strefach czasowych (TZ=...), bo wynik
// NIE może zależeć od strefy urządzenia.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../time.js');

const at = s => new Date(s);                       // chwila w UTC, np. '2026-11-17T21:00:00Z'
const iso = d => d.toISOString();
const draws = (...dates) => dates.map((date, i) => ({ no: i + 1, date, nums: [1, 2, 3, 4, 5, 6] }));

test(`strefa urządzenia w tym przebiegu: ${process.env.TZ || '(domyślna)'}`, () => {
  assert.ok(T.hasIntlTimeZone, 'środowisko musi znać strefę Europe/Warsaw');
});

test('godzina losowania to 22:00 czasu polskiego (zima i lato)', () => {
  assert.equal(iso(T.drawInstant('2026-11-17')), '2026-11-17T21:00:00.000Z'); // CET = UTC+1
  assert.equal(iso(T.drawInstant('2026-07-14')), '2026-07-14T20:00:00.000Z'); // CEST = UTC+2
});

test('zmiana czasu w marcu (29.03.2026) i październiku (25.10.2026)', () => {
  assert.equal(iso(T.drawInstant('2026-03-28')), '2026-03-28T21:00:00.000Z'); // sobota przed zmianą – zima
  assert.equal(iso(T.drawInstant('2026-03-31')), '2026-03-31T20:00:00.000Z'); // wtorek po zmianie – lato
  assert.equal(iso(T.drawInstant('2026-10-24')), '2026-10-24T20:00:00.000Z'); // sobota przed zmianą – lato
  assert.equal(iso(T.drawInstant('2026-10-27')), '2026-10-27T21:00:00.000Z'); // wtorek po zmianie – zima
  // tuż przed i po zmianie
  assert.equal(T.offsetMin(+at('2026-03-29T00:59:00Z')), 60);
  assert.equal(T.offsetMin(+at('2026-03-29T01:00:00Z')), 120);
  assert.equal(T.offsetMin(+at('2026-10-25T00:59:00Z')), 120);
  assert.equal(T.offsetMin(+at('2026-10-25T01:00:00Z')), 60);
});

test('zakład o 21:59, 22:00 i 22:01 we wtorek', () => {
  // wtorek 17.11.2026, 22:00 czasu polskiego = 21:00 UTC
  assert.equal(T.nextScheduledDraw(at('2026-11-17T20:59:00Z')).date, '2026-11-17');   // 21:59 → dzisiaj
  assert.equal(T.nextScheduledDraw(at('2026-11-17T21:00:00Z')).date, '2026-11-19');   // 22:00 → czwartek (jak w bazie: draw_time > created_at)
  assert.equal(T.nextScheduledDraw(at('2026-11-17T21:01:00Z')).date, '2026-11-19');   // 22:01 → czwartek
});

test('dni bez losowania: środa → czwartek, niedziela i poniedziałek → wtorek', () => {
  assert.equal(T.nextScheduledDraw(at('2026-11-18T10:00:00Z')).date, '2026-11-19');
  assert.equal(T.nextScheduledDraw(at('2026-11-22T10:00:00Z')).date, '2026-11-24');
  assert.equal(T.nextScheduledDraw(at('2026-11-23T22:30:00Z')).date, '2026-11-24');   // pon. 23:30
  assert.equal(T.nextScheduledDraw(at('2026-11-21T22:30:00Z')).date, '2026-11-24');   // sob. 23:30 → wtorek
});

test('data w Polsce po północy różni się od daty w UTC', () => {
  assert.equal(T.dateISO(at('2026-11-17T23:30:00Z')), '2026-11-18');   // 00:30 w Polsce
  assert.equal(T.dateISO(at('2026-07-14T22:30:00Z')), '2026-07-15');   // 00:30 latem
});

test('ostatnie losowanie z terminarza (do ostrzeżenia o brakujących wynikach)', () => {
  assert.equal(T.lastScheduledDraw(at('2026-11-17T21:00:00Z')).date, '2026-11-17');   // dokładnie 22:00
  assert.equal(T.lastScheduledDraw(at('2026-11-17T20:59:00Z')).date, '2026-11-14');   // 21:59 → sobota
  assert.equal(T.lastScheduledDraw(at('2026-11-18T08:00:00Z')).date, '2026-11-17');
});

test('rozliczenie: zakład trafia do pierwszego losowania po zapisaniu', () => {
  const d = draws('2026-11-12', '2026-11-14', '2026-11-17');
  const r = T.targetDraw(at('2026-11-17T12:00:00Z'), d, at('2026-11-18T08:00:00Z'));
  assert.equal(r.status, 'done'); assert.equal(r.date, '2026-11-17');
  // zapisany po wtorkowym losowaniu → czwartek, jeszcze się nie odbył
  const r2 = T.targetDraw(at('2026-11-17T21:30:00Z'), d, at('2026-11-18T08:00:00Z'));
  assert.equal(r2.status, 'pending'); assert.equal(r2.date, '2026-11-19');
});

test('wyniki się spóźniają: losowanie minęło, danych jeszcze nie ma', () => {
  const d = draws('2026-11-12', '2026-11-14');
  const r = T.targetDraw(at('2026-11-17T12:00:00Z'), d, at('2026-11-17T21:20:00Z'));
  assert.equal(r.status, 'waiting'); assert.equal(r.date, '2026-11-17');
  const r2 = T.targetDraw(at('2026-11-17T12:00:00Z'), d, at('2026-11-17T20:00:00Z'));
  assert.equal(r2.status, 'pending');
});

test('odwołane losowanie (brak czwartku w danych) → zakład przechodzi na sobotę, jak w bazie', () => {
  const d = draws('2026-11-17', '2026-11-21');      // brak 19.11
  const r = T.targetDraw(at('2026-11-18T10:00:00Z'), d, at('2026-11-22T10:00:00Z'));
  assert.equal(r.status, 'done'); assert.equal(r.date, '2026-11-21');
});

test('kilka losowań jednego dnia (dawne lata) nie psuje wyszukiwania', () => {
  const d = draws('1960-01-03', '1960-01-03', '1960-01-10');
  const r = T.targetDraw(at('1960-01-04T10:00:00Z'), d, at('2026-01-01T00:00:00Z'));
  assert.equal(r.date, '1960-01-10');
  const r2 = T.targetDraw(at('1960-01-02T10:00:00Z'), d, at('2026-01-01T00:00:00Z'));
  assert.equal(r2.draw.no, 1);
});

test('wyświetlanie godzin w czasie polskim', () => {
  assert.equal(T.formatDateTime(at('2026-11-17T11:40:00Z')), '17.11.2026 12:40');
  assert.equal(T.formatDateTime(at('2026-07-14T10:05:00Z')), '14.07.2026 12:05');
  assert.equal(T.formatTime(at('2026-11-17T23:59:00Z')), '00:59');
});

test('zapasowa reguła zmiany czasu zgadza się z bazą stref dla lat 2000–2040', () => {
  for (let ms = Date.UTC(2000, 0, 1); ms < Date.UTC(2041, 0, 1); ms += 3 * 3600000) {
    assert.equal(T.fallbackOffsetMin(ms), T.offsetMin(ms), new Date(ms).toISOString());
  }
});

test('każde losowanie z terminarza w latach 2024–2030 wypada o 22:00 czasu polskiego we wt/czw/sob', () => {
  let from = at('2024-01-01T00:00:00Z'), n = 0;
  while (from < at('2031-01-01T00:00:00Z')) {
    const s = T.nextScheduledDraw(from);
    const p = T.parts(s.time);
    assert.equal(p.h, 22); assert.equal(p.mi, 0);
    assert.ok(T.DRAW_DAYS.includes(p.wd), s.date);
    assert.equal(T.dateISO(s.time), s.date);
    from = s.time; n++;
  }
  assert.ok(n > 1000);
});
