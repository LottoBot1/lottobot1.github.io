// Testy systemów skróconych (systemy.js).
// Uruchomienie: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../systemy.js');

const pick = v => Array.from({ length: v }, (_, i) => 49 - i * 3);   // np. 49, 46, 43, …

// Niezależne sprawdzenie „na piechotę”: każdy możliwy układ k trafionych liczb spośród wybranych.
function bruteGuarantee(bets, nums, m, k) {
  const combos = (arr, r) => r === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), r - 1).map(c => [x, ...c]));
  return combos(nums, k).every(K => bets.some(b => b.filter(n => K.includes(n)).length >= m));
}

test('gwarancja działa dla każdej gwarancji przy 7–11 liczbach (sprawdzenie niezależne)', () => {
  for (const [m, k] of S.GUARANTEES) for (let v = 7; v <= 11; v++) {
    const nums = pick(v), r = S.build(nums, m, k);
    assert.ok(bruteGuarantee(r.bets, nums, m, k), `${m} z ${k}, ${v} liczb`);
  }
});

test('gwarancja działa przy 12–15 liczbach (sprawdzenie wbudowane)', () => {
  for (const [m, k] of S.GUARANTEES) for (let v = 12; v <= 15; v++) {
    const nums = pick(v), r = S.build(nums, m, k);
    assert.ok(S.verify(r.bets, nums, m, k), `${m} z ${k}, ${v} liczb`);
  }
});

test('każdy zakład ma 6 różnych liczb wyłącznie spośród wybranych', () => {
  const nums = [3, 7, 12, 19, 25, 31, 38, 44, 49, 1];
  const r = S.build(nums, 3, 4);
  for (const b of r.bets) {
    assert.equal(b.length, 6);
    assert.equal(new Set(b).size, 6);
    assert.ok(b.every(n => nums.includes(n)));
    assert.deepEqual(b, [...b].sort((x, y) => x - y));
  }
});

test('system skrócony ma mniej zakładów niż pełny', () => {
  for (const [m, k] of S.GUARANTEES) for (const v of [9, 12, 15]) {
    const r = S.build(pick(v), m, k);
    assert.ok(r.bets.length < r.full, `${m} z ${k}, ${v} liczb: ${r.bets.length} vs ${r.full}`);
    assert.equal(r.full, S.binom(v, 6));
  }
});

test('wynik jest powtarzalny: te same liczby i gwarancja → ten sam zestaw (kolejność wpisania bez znaczenia)', () => {
  const a = S.build([5, 9, 14, 22, 30, 33, 41, 47, 2, 18], 3, 3);
  const b = S.build([18, 2, 47, 41, 33, 30, 22, 14, 9, 5], 3, 3);
  assert.deepEqual(a.bets, b.bets);
});

test('znane minimum dla małych systemów', () => {
  // 7 liczb, 4 z 4: każdy zakład pomija 1 liczbę; trzeba pominąć co najmniej 5 różnych → 5 zakładów
  assert.equal(S.build(pick(7), 4, 4).bets.length, 5);
  // 7 liczb, 3 z 4: wystarczy 1 zakład (4 trafione z 7 zawsze mają ≥3 wspólne z dowolną szóstką)
  assert.equal(S.build(pick(7), 3, 4).bets.length, 1);
});

test('złe dane są odrzucane z polskim komunikatem', () => {
  assert.throws(() => S.build(pick(6), 3, 3), /od 7 do 15/);
  assert.throws(() => S.build(pick(16), 3, 3), /od 7 do 15/);
  assert.throws(() => S.build([1, 1, 2, 3, 4, 5, 6], 3, 3), /różne/);
  assert.throws(() => S.build([0, 1, 2, 3, 4, 5, 6], 3, 3), /od 1 do 49/);
  assert.throws(() => S.build(pick(8), 2, 3), /gwarancja/);
});

test('verify wykrywa system bez gwarancji', () => {
  const nums = pick(8);
  assert.equal(S.verify([nums.slice(0, 6)], nums, 3, 3), false);
});
