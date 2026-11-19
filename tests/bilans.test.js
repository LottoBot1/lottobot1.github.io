// Testy bilansu wydatków (bilans.js).
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../bilans.js');
const T = require('../time.js');

test('cena Lotto zależy od daty losowania: 2 zł, 3 zł od 9.10.2009, 5 zł od 20.08.2026', () => {
  assert.equal(B.betCost('2009-10-08', false), 200);
  assert.equal(B.betCost('2009-10-09', false), 300);
  assert.equal(B.betCost('2026-08-18', false), 300);   // ostatnie losowanie po 3 zł
  assert.equal(B.betCost('2026-08-20', false), 500);   // pierwsze losowanie po 5 zł
  assert.equal(B.betCost('2026-11-19', false), 500);
});

test('dopłata Plus +1 zł przed i po podwyżce', () => {
  assert.equal(B.betCost('2026-08-18', true), 400);
  assert.equal(B.betCost('2026-08-20', true), 600);
});

test('zakład z 18.08.2026: przed losowaniem 3 zł, po 22:10 już 5 zł (data losowania z godziny zakładu)', () => {
  const draws = [{ no: 1, date: '2026-08-18', nums: [1, 2, 3, 4, 5, 6] }];
  const now = new Date('2026-08-19T12:00:00Z');
  const before = T.targetDraw(new Date('2026-08-18T15:00:00Z'), draws, now);   // 17:00 czasu polskiego
  const after = T.targetDraw(new Date('2026-08-18T20:15:00Z'), draws, now);    // 22:15 czasu polskiego
  assert.equal(before.date, '2026-08-18');
  assert.equal(B.betCost(before.date, false), 300);
  assert.equal(after.date, '2026-08-20');
  assert.equal(B.betCost(after.date, false), 500);
});

test('nowa cena dopisana na końcu tabeli działa bez zmian w kodzie', () => {
  const t = [...B.CENY, { od: '2030-01-01', lotto: 6.5, plus: 1.5 }];
  assert.equal(B.betCost('2029-12-31', true, t), 600);
  assert.equal(B.betCost('2030-01-01', true, t), 800);
  // kolejność wpisów w tabeli nie ma znaczenia
  assert.equal(B.betCost('2030-01-01', true, [...t].reverse()), 800);
});

test('podpowiedź wygranej: trójka 24 zł przed zmianą, 35 zł po; 4–6 i Plus ręcznie', () => {
  assert.equal(B.suggestedPrize('2026-08-18', 3, null), 2400);
  assert.equal(B.suggestedPrize('2026-08-20', 3, null), 3500);
  assert.equal(B.suggestedPrize('2026-08-20', 3, 2), 3500);
  assert.equal(B.suggestedPrize('2026-08-20', 2, 1), 0);
  assert.equal(B.suggestedPrize('2026-08-20', 4, null), null);
  assert.equal(B.suggestedPrize('2026-08-20', 6, null), null);
  assert.equal(B.suggestedPrize('2026-08-20', 3, 3), null);   // trójka także w Plusie – kwota łączna ręcznie
  assert.equal(B.suggestedPrize('2026-08-20', 1, 4), null);
});

const e = (o) => ({ played: true, plus: false, date: '2026-11-17', done: true, hl: 0, hp: null, ...o });
const TODAY = '2026-11-19';

test('liczą się tylko zakłady oznaczone jako „Zagrany”', () => {
  const r = B.summarize([e({}), e({ played: false }), e({ played: false, hl: 3 })], 'all', TODAY);
  assert.equal(r.count, 1);
  assert.equal(r.spent, 500);
  assert.equal(r.won, 0);
  assert.equal(r.balance, -500);
});

test('kwota wpisana przez użytkownika zastępuje podpowiedź (także 0)', () => {
  assert.equal(B.summarize([e({ hl: 3 })], 'all', TODAY).won, 3500);
  assert.equal(B.summarize([e({ hl: 3, prize: 40.5 })], 'all', TODAY).won, 4050);
  assert.equal(B.summarize([e({ hl: 3, prize: 0 })], 'all', TODAY).won, 0);
});

test('wygrane bez kwoty i zakłady przed losowaniem', () => {
  const r = B.summarize([e({ hl: 4 }), e({ hl: 5, prize: 5000 }), e({ done: false, date: '2026-11-21' })], 'all', TODAY);
  assert.equal(r.missing, 1);
  assert.equal(r.pending, 1);
  assert.equal(r.spent, 1500);           // zakład przed losowaniem też jest już wydatkiem
  assert.equal(r.won, 500000);
});

test('okresy: ten miesiąc, ten rok, od początku (według daty losowania)', () => {
  const list = [e({ date: '2026-11-03' }), e({ date: '2026-10-31' }), e({ date: '2025-12-30' })];
  assert.equal(B.summarize(list, 'month', TODAY).count, 1);
  assert.equal(B.summarize(list, 'year', TODAY).count, 2);
  assert.equal(B.summarize(list, 'all', TODAY).count, 3);
  assert.equal(B.summarize(list, 'all', TODAY).spent, 500 + 500 + 300);
});

test('suma w groszach bez błędów zaokrągleń', () => {
  const list = Array.from({ length: 10 }, () => e({ hl: 4, prize: 0.1 }));
  assert.equal(B.summarize(list, 'all', TODAY).won, 100);
});

test('odczyt kwoty wpisanej przez użytkownika', () => {
  assert.equal(B.parsePrize('35'), 35);
  assert.equal(B.parsePrize('35,50'), 35.5);
  assert.equal(B.parsePrize(' 1 200,5 '), 1200.5);
  assert.equal(B.parsePrize(''), null);
  assert.ok(Number.isNaN(B.parsePrize('-5')));
  assert.ok(Number.isNaN(B.parsePrize('12,345')));
  assert.ok(Number.isNaN(B.parsePrize('abc')));
});

test('format kwot po polsku', () => {
  assert.equal(B.fmtZl(123456789), '1 234 567,89 zł');
  assert.equal(B.fmtZl(-500), '−5,00 zł');
  assert.equal(B.fmtZl(3500, true), '+35,00 zł');
  assert.equal(B.fmtZl(0, true), '0,00 zł');
});
