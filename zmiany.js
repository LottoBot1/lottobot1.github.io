/* Typer49 – „Co nowego”: jedyne źródło listy zmian widocznych dla użytkownika + reguła jednorazowego okienka.
   PRZY KAŻDEJ NOWEJ WERSJI widocznej dla użytkownika dopisz wpis NA GÓRZE listy: numer (jak w sw.js), data,
   1–4 krótkie punkty prostym językiem. Bez nazw technicznych, obietnic wygranych, zapowiedzi i zmian niewidocznych
   (automaty, testy). Wersja bez wpisu = bez okienka. Numerów i tekstów pilnuje tests/zmiany.test.js.
   Plik działa w przeglądarce (window.TyperZmiany) i w Node. */
(function (root) {
  'use strict';

  const LIST = [
    { v: '2.9.13', date: '2026-11-27', items: [
      'Poprawka: po aktualizacji aplikacja od razu wczytuje wszystkie nowe pliki.',
    ] },
    { v: '2.9.12', date: '2026-11-25', items: [
      'Nowa sekcja „Co nowego” w zakładce Więcej i link „Napisz do nas”.',
    ] },
    { v: '2.9.11', date: '2026-11-25', items: [
      'Nowa, pełniejsza polityka prywatności (link w zakładce Więcej).',
    ] },
    { v: '2.9.10', date: '2026-11-23', items: [
      'Podgląd hasła: ikona oka przy logowaniu, zakładaniu konta i ustawianiu nowego hasła.',
      'Telefon łatwiej zapisze nowe hasło do właściwego konta.',
    ] },
    { v: '2.9.9', date: '2026-11-22', items: [
      'Poprawka: zasady prywatności można znowu przewinąć do końca.',
    ] },
    { v: '2.9.8', date: '2026-11-22', items: [
      'Ranking: zwykłe numery miejsc i czytelniejszy opis „najwięcej trafień”.',
      'Pod rankingiem i w grupach przypominamy, że wyniki są losowe.',
    ] },
    { v: '2.9.7', date: '2026-11-22', items: [
      'Potwierdzenie ukończenia 18 lat przy pierwszym uruchomieniu.',
      'W zakładce Więcej: link do pomocy w problemach z hazardem i link do źródła wyników.',
    ] },
    { v: '2.9.6', date: '2026-11-22', items: [
      'Czytelniejsze nazwy w Generatorze i Statystykach, np. „najczęstsze”, „najrzadsze” i „przerwa”.',
      'Nowa sekcja „O aplikacji i odpowiedzialna gra” w zakładce Więcej.',
    ] },
    { v: '2.9.5', date: '2026-11-22', items: [
      'Pasek „Dostępna nowa wersja – Odśwież”, gdy aplikacja była długo otwarta.',
      'Po odświeżeniu zostają wybrane liczby, wygenerowane zestawy i wpisany kupon.',
    ] },
  ];

  const SEEN_KEY = 'typer.seenVersion';   // ostatnia wersja, dla której pokazano „Co nowego” na tym urządzeniu

  function parse(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v));
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  /** Porównanie wersji jako liczb (2.9.10 > 2.9.9): >0, 0, <0 albo null przy złym formacie. */
  function compare(a, b) {
    const x = parse(a), y = parse(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }

  /** Najnowszy wpis wczytanej listy = wersja, na której działa ta strona (lista jest częścią jej kodu). */
  const current = () => LIST[0] || null;

  /** Co zrobić przy starcie: 'show' – pokaż okienko, 'store' – tylko zapamiętaj wersję (nowy użytkownik), 'none'.
      Cofnięcie do starszej wersji nie pokazuje okienka. existing = dane aplikacji były tu przed tym startem. */
  function decide({ seen, current: cur, existing }) {
    if (!parse(cur)) return 'none';
    if (parse(seen)) return compare(cur, seen) > 0 ? 'show' : 'none';
    return existing ? 'show' : 'store';
  }

  /** Czy ktoś już korzystał z aplikacji na tym urządzeniu (są jej dane w localStorage). */
  function hasAppData(keys) {
    return keys.some(k => /^(lotto2|typer)\./.test(k) && k !== SEEN_KEY);
  }

  /** Stan urządzenia: {seen, existing} albo null, gdy localStorage jest niedostępne. */
  function readState(storage) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      return { seen: storage.getItem(SEEN_KEY), existing: hasAppData(keys) };
    } catch { return null; }
  }

  /** Zapamiętuje wersję; false, gdy się nie da (wtedy okienka nie pokazujemy – wracałoby przy każdym starcie). */
  function markSeen(storage, v) {
    try { storage.setItem(SEEN_KEY, v); return true; } catch { return false; }
  }

  // Stan sprzed startu app.js, który sam zapisuje dane – inaczej nowy użytkownik wyglądałby na dotychczasowego.
  let initial = null;
  if (typeof window !== 'undefined') { try { initial = readState(window.localStorage); } catch { initial = null; } }

  const api = { LIST, SEEN_KEY, compare, current, decide, hasAppData, readState, markSeen, initial };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperZmiany = api;
})(typeof window !== 'undefined' ? window : globalThis);
