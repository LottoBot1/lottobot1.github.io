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

test('fromSource: odczyt stałej VERSION z treści pliku', () => {
  assert.equal(W.fromSource("const VERSION = 'typer49-v1.2.3';\nconst SHELL = [];"), 'typer49-v1.2.3');
  assert.equal(W.fromSource('brak stałej'), null);
  assert.equal(W.fromSource(null), null);
});
