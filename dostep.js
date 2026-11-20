/* Typer49 – kto ma dostęp do czego (Etap 4, krok 4: logowanie wymagane do zapisywania).
   Bez konta: Start, Statystyki, Generator (generowanie i podgląd), sprawdzanie kuponu.
   Z kontem (darmowym): zapisywanie zakładów, Zakłady, Ranking, grupy, Bilans, powiadomienia,
   systemy skrócone, import i eksport.
   Tu są tylko proste reguły bez dostępu do strony – testy: tests/dostep.test.js.
   Plik działa w przeglądarce (window.TyperDostep) i w Node. */
(function (root) {
  'use strict';

  const DAY = 24 * 3600 * 1000;
  const PENDING_MAX_AGE = 7 * DAY;     // zestaw czekający na logowanie i kod grupy wygasają po 7 dniach

  // Ekrany i funkcje, które wymagają konta.
  const ACCOUNT_VIEWS = ['bets', 'rank'];
  const ACCOUNT_FEATURES = ['save', 'bets', 'bilans', 'rank', 'groups', 'push', 'systems', 'import', 'export'];

  const needsAccountView = v => ACCOUNT_VIEWS.includes(v);
  const needsAccount = f => ACCOUNT_FEATURES.includes(f);

  /** Czy zestaw z Generatora / ręcznego wyboru jest poprawny (6 różnych liczb 1–49). */
  function validSet(s) {
    if (!s || !Array.isArray(s.nums) || s.nums.length !== 6) return false;
    if (!s.nums.every(n => Number.isInteger(n) && n >= 1 && n <= 49)) return false;
    if (new Set(s.nums).size !== 6) return false;
    if (s.method != null && (typeof s.method !== 'string' || s.method.length > 20)) return false;
    if (s.base != null && s.base !== 'lotto' && s.base !== 'lottoplus') return false;
    return true;
  }

  function fresh(at, nowMs) {
    const t = Date.parse(at);
    if (!Number.isFinite(t)) return false;
    return t <= nowMs + DAY && nowMs - t <= PENDING_MAX_AGE;   // nie z przyszłości, nie starszy niż 7 dni
  }

  /** Zestawy czekające na zapis po zalogowaniu: lista poprawnych zestawów albo null (brak, wygasłe, błędne). */
  function pendingSets(p, nowMs) {
    if (!p || !Array.isArray(p.sets) || !fresh(p.at, nowMs)) return null;
    const sets = p.sets.filter(validSet).slice(0, 20);
    return sets.length ? sets : null;
  }

  /** Kod zaproszenia do grupy czekający na zalogowanie albo null. */
  function pendingJoin(p, nowMs) {
    if (!p || typeof p.code !== 'string' || !/^[A-Za-z0-9]{4,12}$/.test(p.code) || !fresh(p.at, nowMs)) return null;
    return p.code;
  }

  /** Identyfikator zakładu przeniesionego z urządzenia na konto (prefiks „dev-”, najwyżej 40 znaków). */
  function movedId(id) {
    const s = String(id);
    return s.startsWith('dev-') ? s.slice(0, 40) : ('dev-' + s).slice(0, 40);
  }

  /** Zakład z urządzenia przygotowany do wysłania na konto: nowy identyfikator, bez znacznika „synced”,
      godzina zapisania (t) bez zmian – baza sama uzna go za nierankingowy. */
  function toMoved(b) {
    const { synced, moved, ...rest } = b;   // eslint-disable-line no-unused-vars
    return { ...rest, id: movedId(b.id) };
  }

  /** Przy starcie aplikacji: zakłady na urządzeniu bez konta (brak właściciela) to zakłady gościa. */
  function splitLegacy(bets, owner) {
    if (owner) return { account: bets, guest: [] };
    return { account: [], guest: bets.filter(b => b && Array.isArray(b.nums)) };
  }

  /** Dołącza zakłady do listy zakładów gościa bez duplikatów (po id). */
  function mergeGuest(guest, add) {
    const ids = new Set(guest.map(b => b.id));
    return guest.concat(add.filter(b => !ids.has(b.id)));
  }

  const api = { PENDING_MAX_AGE, ACCOUNT_VIEWS, ACCOUNT_FEATURES, needsAccountView, needsAccount,
    validSet, pendingSets, pendingJoin, movedId, toMoved, splitLegacy, mergeGuest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperDostep = api;
})(typeof window !== 'undefined' ? window : globalThis);
