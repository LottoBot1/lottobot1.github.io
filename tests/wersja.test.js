// Testy numeru wersji (wersja.js). Jedno źródło: stała VERSION w sw.js.
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../wersja.js');

const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

test('wersja z sw.js ma format, który aplikacja umie pokazać', () => {
  const v = W.fromSource(sw);
  assert.match(v, /^typer49-v\d+\.\d+\.\d+$/, 'stała VERSION w sw.js');
  assert.match(W.label(v), /^v\d+\.\d+\.\d+$/);
});

test('sw.js odpowiada aplikacji numerem wersji i ma wersja.js w pamięci offline', () => {
  assert.ok(sw.includes("e.data.type === 'wersja'") && sw.includes('postMessage(VERSION)'), 'odpowiedź na pytanie o wersję');
  assert.ok(/SHELL = \[[^\]]*'wersja\.js'/.test(sw), 'wersja.js w SHELL');
});

test('label: tylko poprawny format', () => {
  assert.equal(W.label('typer49-v2.9.3'), 'v2.9.3');
  assert.equal(W.label(' typer49-v10.0.12 '), 'v10.0.12');
  assert.equal(W.label('typer49-v2.9'), null);
  assert.equal(W.label('inna-v2.9.3'), null);
  assert.equal(W.label(''), null);
  assert.equal(W.label(null), null);
  assert.equal(W.label(undefined), null);
});

test('shouldOffer: pasek tylko przy innej, poprawnej wersji na serwerze', () => {
  assert.equal(W.shouldOffer('typer49-v2.9.5', 'typer49-v2.9.6'), true);
  assert.equal(W.shouldOffer('typer49-v2.9.6', 'typer49-v2.9.5'), true, 'cofnięcie do last-good też wymaga odświeżenia');
  assert.equal(W.shouldOffer('typer49-v2.9.5', 'typer49-v2.9.5'), false);
  assert.equal(W.shouldOffer('typer49-v2.9.5', null), false, 'bez internetu – brak paska');
  assert.equal(W.shouldOffer(null, 'typer49-v2.9.6'), false, 'nieznana wersja strony – brak paska');
  assert.equal(W.shouldOffer('typer49-v2.9.5', '<html>błąd</html>'), false);
});

test('sw.js przepuszcza sprawdzanie wersji do sieci (bez zapisu w pamięci podręcznej)', () => {
  assert.ok(sw.includes("url.searchParams.has('wersja')"), 'reguła ?wersja w sw.js');
});

test('snapshot: niezapisana praca przetrwa przeładowanie strony', () => {
  const data = { view: 'gen', picked: [3, 11, 19], lastGen: [{ nums: [1, 2, 3, 4, 5, 6], method: 'stat' }], check: '3 11 19' };
  const t = 1_800_000_000_000;
  assert.deepEqual(W.unpackSnapshot(W.packSnapshot(data, t), t + 5000), data);
});

test('snapshot: stary, przyszły albo uszkodzony – ignorowany', () => {
  const t = 1_800_000_000_000, s = W.packSnapshot({ picked: [1] }, t);
  assert.equal(W.unpackSnapshot(s, t + W.SNAPSHOT_MAX_MS + 1), null, 'po 10 min');
  assert.equal(W.unpackSnapshot(s, t - 2 * 60 * 1000), null, 'z przyszłości');
  assert.equal(W.unpackSnapshot('{zepsute', t), null);
  assert.equal(W.unpackSnapshot(null, t), null);
  assert.equal(W.unpackSnapshot(JSON.stringify({ v: 2, t, data: {} }), t), null, 'inny format');
});

test('fromSource: odczyt stałej VERSION z treści pliku', () => {
  assert.equal(W.fromSource("const VERSION = 'typer49-v1.2.3';\nconst SHELL = [];"), 'typer49-v1.2.3');
  assert.equal(W.fromSource('brak stałej'), null);
  assert.equal(W.fromSource(null), null);
});
