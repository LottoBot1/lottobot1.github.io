// Testy reguł dostępu (dostep.js) – Etap 4, krok 4: logowanie wymagane do zapisywania.
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dostep.js');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const iso = ms => new Date(ms).toISOString();
const set = (nums, extra = {}) => ({ nums, method: 'stat', base: 'lotto', plus: true, ...extra });

test('bez konta: Start, Statystyki, Generator i Więcej; z kontem: Zakłady i Ranking', () => {
  for (const v of ['home', 'stats', 'gen', 'more', 'account', 'premium']) assert.equal(D.needsAccountView(v), false, v);
  for (const v of ['bets', 'rank']) assert.equal(D.needsAccountView(v), true, v);
});

test('funkcje wymagające konta: zapis, bilans, grupy, powiadomienia, systemy, import i eksport', () => {
  for (const f of ['save', 'bilans', 'groups', 'push', 'systems', 'import', 'export']) assert.equal(D.needsAccount(f), true, f);
  for (const f of ['generate', 'check', 'stats', 'manualDraw']) assert.equal(D.needsAccount(f), false, f);
});

test('poprawny zestaw: 6 różnych liczb 1–49', () => {
  assert.equal(D.validSet(set([1, 2, 3, 4, 5, 49])), true);
  assert.equal(D.validSet(set([1, 2, 3, 4, 5])), false);
  assert.equal(D.validSet(set([1, 2, 3, 4, 5, 50])), false);
  assert.equal(D.validSet(set([0, 2, 3, 4, 5, 6])), false);
  assert.equal(D.validSet(set([1, 1, 3, 4, 5, 6])), false);
  assert.equal(D.validSet(set([1, 2, 3, 4, 5, 6.5])), false);
  assert.equal(D.validSet(set([1, 2, 3, 4, 5, 6], { base: 'inne' })), false);
  assert.equal(D.validSet(null), false);
});

test('zestaw czekający na logowanie zapisuje się do 7 dni, potem wygasa', () => {
  const sets = [set([1, 2, 3, 4, 5, 6])];
  assert.deepEqual(D.pendingSets({ sets, at: iso(NOW - 1000) }, NOW), sets);
  assert.deepEqual(D.pendingSets({ sets, at: iso(NOW - 7 * DAY) }, NOW), sets);          // równo 7 dni
  assert.equal(D.pendingSets({ sets, at: iso(NOW - 7 * DAY - 1) }, NOW), null);          // po 7 dniach
  assert.equal(D.pendingSets({ sets, at: iso(NOW + 2 * DAY) }, NOW), null);              // data z przyszłości
  assert.equal(D.pendingSets({ sets, at: 'zła data' }, NOW), null);
  assert.equal(D.pendingSets(null, NOW), null);
});

test('zestaw czekający: błędne zestawy są pomijane, pusta lista = nic do zapisania', () => {
  const ok = set([7, 14, 21, 28, 35, 42]);
  assert.deepEqual(D.pendingSets({ sets: [ok, set([1, 2, 3])], at: iso(NOW) }, NOW), [ok]);
  assert.equal(D.pendingSets({ sets: [set([1, 2, 3])], at: iso(NOW) }, NOW), null);
  assert.equal(D.pendingSets({ sets: [], at: iso(NOW) }, NOW), null);
});

test('kod zaproszenia do grupy czeka na zalogowanie najwyżej 7 dni', () => {
  assert.equal(D.pendingJoin({ code: 'AB12CD34', at: iso(NOW - DAY) }, NOW), 'AB12CD34');
  assert.equal(D.pendingJoin({ code: 'AB12CD34', at: iso(NOW - 8 * DAY) }, NOW), null);
  assert.equal(D.pendingJoin({ code: 'ab<script>', at: iso(NOW) }, NOW), null);
  assert.equal(D.pendingJoin({ code: 'A1', at: iso(NOW) }, NOW), null);
});

test('przeniesiony zakład dostaje prefiks dev- (max 40 znaków), godzina zapisania bez zmian', () => {
  assert.equal(D.movedId('k3x9a'), 'dev-k3x9a');
  assert.equal(D.movedId('dev-k3x9a'), 'dev-k3x9a');                // drugi raz bez podwójnego prefiksu
  assert.equal(D.movedId('x'.repeat(40)).length, 40);
  const b = { id: 'abc123', t: '2026-11-01T10:00:00.000Z', nums: [1, 2, 3, 4, 5, 6], played: true, synced: true, moved: true };
  const m = D.toMoved(b);
  assert.equal(m.id, 'dev-abc123');
  assert.equal(m.t, b.t);
  assert.equal(m.played, true);
  assert.equal('synced' in m, false);
  assert.equal('moved' in m, false);
});

test('przy starcie: zakłady na urządzeniu bez właściciela konta to zakłady gościa', () => {
  const bets = [{ id: 'a', nums: [1, 2, 3, 4, 5, 6] }, { id: 'b', nums: [7, 8, 9, 10, 11, 12] }];
  assert.deepEqual(D.splitLegacy(bets, null), { account: [], guest: bets });
  assert.deepEqual(D.splitLegacy(bets, 'uuid-wlasciciela'), { account: bets, guest: [] });
});

test('łączenie zakładów gościa bez duplikatów', () => {
  const g = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(D.mergeGuest(g, [{ id: 'b' }, { id: 'c' }]).map(b => b.id), ['a', 'b', 'c']);
});
