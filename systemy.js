/* Typer49 – systemy skrócone (funkcja Premium).
   Użytkownik wybiera v liczb (7–15) i gwarancję „m z k”: jeśli k z wylosowanych liczb jest wśród
   wybranych, co najmniej jeden zakład ma ≥ m trafień. Program układa możliwie mało zakładów
   (zachłannie, z kilkoma powtórkami i usuwaniem zbędnych zakładów), a potem SPRAWDZA gwarancję
   na wszystkich możliwych układach k liczb – wynik bez potwierdzonej gwarancji nie jest zwracany.
   Wynik jest powtarzalny: te same liczby i gwarancja dają zawsze ten sam zestaw.
   Plik działa w przeglądarce (window.TyperSystemy), jako Web Worker (liczenie bez zawieszania
   ekranu) i w Node (testy: tests/systemy.test.js). */
(function (root) {
  'use strict';

  const MIN_NUMS = 7, MAX_NUMS = 15, MAX_BETS = 300;
  // Dostępne gwarancje [m, k]: m trafień w jednym zakładzie, gdy k wylosowanych liczb jest wśród wybranych.
  const GUARANTEES = [[3, 3], [3, 4], [4, 4], [4, 5], [5, 5]];
  // Liczba powtórek układania (z innym rozstrzyganiem remisów) – stała, żeby wynik był powtarzalny.
  const RESTARTS = 8;

  function popcount(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }

  /** Wszystkie r-elementowe podzbiory {0..n-1} jako maski bitowe (rosnąco leksykograficznie). */
  function subsets(n, r) {
    const out = [], idx = Array.from({ length: r }, (_, i) => i);
    if (r > n || r < 0) return out;
    for (;;) {
      let m = 0; for (const i of idx) m |= 1 << i;
      out.push(m);
      let i = r - 1;
      while (i >= 0 && idx[i] === n - r + i) i--;
      if (i < 0) return out;
      idx[i]++;
      for (let j = i + 1; j < r; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  function binom(n, r) { if (r < 0 || r > n) return 0; let x = 1; for (let i = 1; i <= r; i++) x = x * (n - r + i) / i; return Math.round(x); }

  // Generator liczb pseudolosowych z ziarnem (mulberry32) – zawsze ten sam ciąg dla tego samego ziarna.
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function check(v, m, k) {
    if (!Number.isInteger(v) || v < MIN_NUMS || v > MAX_NUMS) throw new Error(`Wybierz od ${MIN_NUMS} do ${MAX_NUMS} liczb`);
    if (!GUARANTEES.some(([a, b]) => a === m && b === k)) throw new Error('Nieznana gwarancja');
  }

  // Kopiec (max) par [zysk, los, kandydat] – do „leniwego” algorytmu zachłannego.
  function heapPush(h, e) { h.push(e); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (cmp(h[p], h[i]) >= 0) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
  function heapPop(h) {
    const top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let b = i; if (l < h.length && cmp(h[l], h[b]) > 0) b = l; if (r < h.length && cmp(h[r], h[b]) > 0) b = r; if (b === i) break; [h[b], h[i]] = [h[i], h[b]]; i = b; } }
    return top;
  }
  function cmp(a, b) { return a[0] - b[0] || a[1] - b[1]; }

  /**
   * Układa system na indeksach 0..v-1. Zwraca tablicę masek bitowych zakładów.
   * Wynik zależy tylko od (v, m, k).
   */
  function buildMasks(v, m, k) {
    check(v, m, k);
    const cands = subsets(v, 6), targets = subsets(v, k), T = targets.length;
    // dla każdego kandydata: które układy k liczb „łapie” (≥ m wspólnych liczb)
    const cover = cands.map(c => { const a = []; for (let t = 0; t < T; t++) if (popcount(c & targets[t]) >= m) a.push(t); return a; });
    let best = null;
    for (let run = 0; run < RESTARTS; run++) {
      const rand = rng(1000003 * v + 1009 * m + 31 * k + run);
      const covered = new Uint8Array(T);
      let left = T;
      const h = [];
      cands.forEach((_, i) => heapPush(h, [cover[i].length, rand(), i]));
      const chosen = [];
      while (left > 0 && h.length) {
        const e = heapPop(h);
        let g = 0; for (const t of cover[e[2]]) if (!covered[t]) g++;
        if (g === 0) continue;
        if (g < e[0]) { e[0] = g; heapPush(h, e); continue; }   // zysk się zmniejszył – wróć do kopca
        chosen.push(e[2]);
        for (const t of cover[e[2]]) if (!covered[t]) { covered[t] = 1; left--; }
      }
      // usuń zakłady zbędne (wszystko, co łapią, łapią też inne) – od tych, które łapią najmniej
      const mult = new Uint16Array(T);
      for (const c of chosen) for (const t of cover[c]) mult[t]++;
      const order = chosen.slice().sort((a, b) => cover[a].length - cover[b].length || a - b);
      const keep = new Set(chosen);
      for (const c of order) {
        if (cover[c].every(t => mult[t] > 1)) { keep.delete(c); for (const t of cover[c]) mult[t]--; }
      }
      const res = chosen.filter(c => keep.has(c)).map(c => cands[c]);
      if (!best || res.length < best.length) best = res;
    }
    return best.sort((a, b) => a - b);
  }

  /** Sprawdza gwarancję na WSZYSTKICH układach k liczb z v. Zwraca liczbę układów bez gwarancji (0 = OK). */
  function verifyMasks(masks, v, m, k) {
    let bad = 0;
    for (const t of subsets(v, k)) if (!masks.some(x => popcount(x & t) >= m)) bad++;
    return bad;
  }

  const maskToNums = (mask, nums) => nums.filter((_, i) => mask & (1 << i));

  /**
   * Główna funkcja: nums – wybrane liczby (7–15 różnych z 1–49), m/k – gwarancja.
   * Zwraca { bets: [[6 liczb], …], full, verified, ms } albo rzuca błąd z polskim opisem.
   */
  function build(nums, m, k) {
    const t0 = Date.now();
    const pool = [...new Set(nums.map(Number))].sort((a, b) => a - b);
    if (pool.length !== nums.length || pool.some(n => !Number.isInteger(n) || n < 1 || n > 49)) throw new Error('Liczby muszą być różne, od 1 do 49');
    const v = pool.length;
    const masks = buildMasks(v, m, k);
    const bad = verifyMasks(masks, v, m, k);
    if (bad) throw new Error('Nie udało się potwierdzić gwarancji – system nie zostanie pokazany');
    return { bets: masks.map(x => maskToNums(x, pool)), full: binom(v, 6), verified: true, v, m, k, ms: Date.now() - t0 };
  }

  /** Niezależne sprawdzenie gotowego systemu na liczbach (do testów i kontroli). */
  function verify(bets, nums, m, k) {
    const pool = [...nums].sort((a, b) => a - b), ix = new Map(pool.map((n, i) => [n, i]));
    const masks = bets.map(b => b.reduce((x, n) => x | (1 << ix.get(n)), 0));
    return verifyMasks(masks, pool.length, m, k) === 0;
  }

  const api = { MIN_NUMS, MAX_NUMS, MAX_BETS, GUARANTEES, RESTARTS, build, buildMasks, verify, binom, subsets, popcount };

  // Web Worker: postMessage({ id, nums, m, k }) → { id, ok, result | error }
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope;
  if (isWorker) {
    root.onmessage = e => {
      const { id, nums, m, k } = e.data || {};
      try { root.postMessage({ id, ok: true, result: build(nums, m, k) }); }
      catch (err) { root.postMessage({ id, ok: false, error: err.message }); }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperSystemy = api;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
