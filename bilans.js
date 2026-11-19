/* Typer49 – bilans wydatków (funkcja odpowiedzialnej gry, darmowa dla wszystkich).
   Liczą się tylko zakłady oznaczone jako „Zagrany”.
   Ceny i stała wygrana za „trójkę” zależą od DATY LOSOWANIA, do którego należy zakład
   (wyznacza ją TyperTime.targetDraw z godziny zapisania zakładu). Dzięki temu zakład kupiony
   18.08.2026 przed losowaniem kosztuje jeszcze 3 zł, a kupiony tego dnia po 22:10 – już 5 zł.
   Kwoty liczymy w groszach (liczby całkowite), żeby uniknąć błędów zaokrągleń.
   Plik działa w przeglądarce (window.TyperBilans) i w Node (testy: tests/bilans.test.js). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- TABELE (tu dopisuj zmiany)
  // `od` = data pierwszego losowania (RRRR-MM-DD, czas polski), od którego obowiązuje wpis.
  // Nowa cena = nowa linijka na końcu tabeli. Kwoty w złotych.
  const CENY = [
    { od: '1957-01-01', lotto: 2.00, plus: 1.00 },
    { od: '2009-10-09', lotto: 3.00, plus: 1.00 },   // podwyżka z 2 do 3 zł (październik 2009)
    { od: '2026-08-20', lotto: 5.00, plus: 1.00 },   // sprzedaż po 5 zł od 18.08.2026 22:10, pierwsze losowanie 20.08.2026
  ];
  // Stała wygrana za 3 trafienia w Lotto (podpowiedź – użytkownik może ją zmienić).
  const TROJKA = [
    { od: '1957-01-01', zl: 24 },
    { od: '2026-08-20', zl: 35 },
  ];

  const gr = zl => Math.round(Number(zl) * 100);

  /** Wpis tabeli obowiązujący dla losowania z danego dnia (ostatni z `od` <= data). */
  function entryAt(table, drawISO) {
    let hit = null;
    for (const e of table) if (e.od <= drawISO && (!hit || e.od >= hit.od)) hit = e;
    return hit || table[0];
  }

  /** Koszt jednego zakładu w groszach: Lotto + dopłata Plus, jeśli zakład jest „z Plusem”. */
  function betCost(drawISO, plus, table = CENY) {
    const e = entryAt(table, drawISO);
    return gr(e.lotto) + (plus ? gr(e.plus) : 0);
  }

  /** Stała wygrana za trójkę w groszach dla losowania z danego dnia. */
  function prize3(drawISO, table = TROJKA) { return gr(entryAt(table, drawISO).zl); }

  /**
   * Podpowiedź wygranej w groszach albo null, gdy kwotę trzeba wpisać ręcznie.
   * hl – trafienia w Lotto, hp – trafienia w Lotto Plus (null = zakład bez Plusa lub brak wyniku).
   * 0 – brak wygranej; trójka w Lotto (i mniej niż 3 w Plusie) – stała kwota;
   * 4, 5, 6 w Lotto albo 3+ w Plusie – null (kwoty zmienne albo spoza tabeli).
   */
  function suggestedPrize(drawISO, hl, hp) {
    const plusWin = hp != null && hp >= 3;
    if (hl < 3 && !plusWin) return 0;
    if (hl === 3 && !plusWin) return prize3(drawISO);
    return null;
  }

  /** Okres jako zakres dat losowań [od, do] (włącznie). today = dzisiejsza data w Polsce. */
  function periodRange(period, todayISO) {
    if (period === 'month') return [todayISO.slice(0, 8) + '01', todayISO.slice(0, 8) + '31'];
    if (period === 'year') return [todayISO.slice(0, 5) + '01-01', todayISO.slice(0, 5) + '12-31'];
    return ['0000-01-01', '9999-12-31'];
  }

  /**
   * Bilans. entries: [{ played, plus, date, done, hl, hp, prize }]
   *   date  – data losowania zakładu (RRRR-MM-DD), done – czy losowanie już się odbyło,
   *   prize – kwota wpisana przez użytkownika w zł (undefined/null = nie wpisano).
   * Zwraca kwoty w groszach.
   */
  function summarize(entries, period, todayISO) {
    const [from, to] = periodRange(period, todayISO);
    const r = { count: 0, spent: 0, won: 0, balance: 0, missing: 0, pending: 0, suggested: 0 };
    for (const e of entries) {
      if (!e.played || !e.date || e.date < from || e.date > to) continue;
      r.count++;
      r.spent += betCost(e.date, e.plus);
      if (e.prize != null && e.prize !== '' && isFinite(e.prize)) { r.won += gr(e.prize); continue; }
      if (!e.done) { r.pending++; continue; }
      const s = suggestedPrize(e.date, e.hl, e.hp);
      if (s == null) r.missing++;
      else { r.won += s; if (s > 0) r.suggested++; }
    }
    r.balance = r.won - r.spent;
    return r;
  }

  /** Poprawna kwota wpisana przez użytkownika (zł, 2 miejsca po przecinku) albo null. */
  function parsePrize(text) {
    const s = String(text == null ? '' : text).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return null;
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(Number(s) * 100) / 100;
  }

  /** 1234567 gr → „12 345,67 zł”. */
  function fmtZl(grosze, sign = false) {
    const neg = grosze < 0, a = Math.abs(grosze);
    const zl = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const txt = `${zl},${String(a % 100).padStart(2, '0')} zł`;
    return neg ? '−' + txt : (sign && grosze > 0 ? '+' + txt : txt);
  }

  const api = { CENY, TROJKA, entryAt, betCost, prize3, suggestedPrize, periodRange, summarize, parsePrize, fmtZl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperBilans = api;
})(typeof window !== 'undefined' ? window : globalThis);
