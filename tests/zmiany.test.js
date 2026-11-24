// Testy „Co nowego” (zmiany.js): lista zmian i okienko pokazywane raz po zmianie wersji.
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../zmiany.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function fakeStorage(data = {}) {
  const m = new Map(Object.entries(data));
  return {
    get length() { return m.size; }, key: i => [...m.keys()][i],
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
  };
}
// Jeden start aplikacji: co zrobić; po 'show' i 'store' wersja jest zapamiętana (jak w app.js).
function start(storage, cur) {
  const s = Z.readState(storage);
  const what = s ? Z.decide({ ...s, current: cur }) : 'none';
  if (what === 'none') return what;
  return Z.markSeen(storage, cur) ? what : 'none';
}

test('compare: wersje jako liczby', () => {
  assert.ok(Z.compare('2.9.10', '2.9.9') > 0);
  assert.ok(Z.compare('2.10.0', '2.9.99') > 0);
  assert.ok(Z.compare('2.9.9', '2.9.10') < 0);
  assert.equal(Z.compare('2.9.10', '2.9.10'), 0);
  assert.equal(Z.compare('abc', '2.9.10'), null);
});

test('dotychczasowy użytkownik: okienko raz po zmianie wersji', () => {
  const s = fakeStorage({ 'typer.seenVersion': '2.9.10', 'lotto2.bets': '[]' });
  assert.equal(start(s, '2.9.10'), 'none');
  assert.equal(start(s, '2.9.11'), 'show');
  assert.equal(start(s, '2.9.11'), 'none', 'drugi raz już nie');
  assert.equal(start(s, '2.9.12'), 'show');
});

test('użytkownik sprzed tej funkcji (brak zapisanej wersji): okienko raz', () => {
  const s = fakeStorage({ 'typer.clock': '{}' });
  assert.equal(start(s, '2.9.11'), 'show');
  assert.equal(start(s, '2.9.11'), 'none');
});

test('nowy użytkownik: bez okienka, dopiero przy następnej wersji', () => {
  const s = fakeStorage({ 'inna.aplikacja': '1' });
  assert.equal(start(s, '2.9.11'), 'store');
  s.setItem('typer.adult', '{}');
  assert.equal(start(s, '2.9.11'), 'none');
  assert.equal(start(s, '2.9.12'), 'show');
});

test('cofnięcie wersji i błędne dane', () => {
  assert.equal(start(fakeStorage({ 'typer.seenVersion': '2.9.11' }), '2.9.10'), 'none');
  assert.equal(start(fakeStorage({ 'typer.seenVersion': 'zepsute', 'typer.adult': '{}' }), '2.9.11'), 'show');
  assert.equal(start(fakeStorage({ 'typer.adult': '{}' }), null), 'none');
});

test('localStorage niedostępne albo pełne: bez błędu i bez okienka', () => {
  const blocked = { get length() { throw new Error('SecurityError'); } };
  assert.equal(start(blocked, '2.9.11'), 'none');
  const full = fakeStorage({ 'typer.adult': '{}' });
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(start(full, '2.9.11'), 'none');
});

test('lista: poprawne numery od najnowszego, daty, 1–4 punkty; nie nowsza niż sw.js', () => {
  assert.ok(Z.LIST.length >= 6);
  Z.LIST.forEach((e, i) => {
    assert.match(e.v, /^\d+\.\d+\.\d+$/);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.items.length >= 1 && e.items.length <= 4, e.v);
    assert.ok(e.items.every(t => t.trim() && t.length <= 120), e.v);
    if (i) assert.ok(Z.compare(Z.LIST[i - 1].v, e.v) > 0 && Z.LIST[i - 1].date >= e.date, e.v);
  });
  const sw = /VERSION = 'typer49-v([\d.]+)'/.exec(read('sw.js'))[1];
  assert.ok(Z.compare(Z.current().v, sw) <= 0, 'wpis dla wersji, której jeszcze nie ma');
});

test('teksty neutralne: bez zakazanych słów', () => {
  const bad = /model|\bAI\b|gorąc|zimn|premium|reklam|wygra|szans|skuteczn|przewid|gwaranc|zagraj|rywaliz|najlepsz|wkrótce/i;
  for (const e of Z.LIST) for (const t of e.items) assert.ok(!bad.test(t), `${e.v}: ${t}`);
});

test('podłączenie: plik przed app.js i offline; adres kontaktowy jak w zasadach prywatności', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('src="zmiany.js"') > 0 && html.indexOf('src="zmiany.js"') < html.indexOf('src="app.js"'));
  assert.ok(/SHELL = \[[^\]]*'zmiany\.js'/.test(read('sw.js')));
  const mail = /contactEmail: '([^']+)'/.exec(read('config.js'))[1];
  assert.ok(read('privacy.html').includes(`href="mailto:${mail}"`));
});
