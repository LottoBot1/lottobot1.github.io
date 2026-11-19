/* Typer49 – czas polski (Europe/Warsaw) niezależnie od strefy i zegara urządzenia.
   Ta sama zasada co w bazie (funkcja bet_results w supabase/stage2.sql):
   zakład należy do PIERWSZEGO losowania, które faktycznie się odbyło po jego zapisaniu
   (godzina losowania = 22:00 czasu polskiego). Dopóki losowania nie ma w danych,
   o terminie decyduje terminarz wt/czw/sob.
   Plik działa w przeglądarce (window.TyperTime) i w Node (testy: tests/time.test.js). */
(function (root) {
  'use strict';

  const TZ = 'Europe/Warsaw';
  const DRAW_DAYS = [2, 4, 6];          // wtorek, czwartek, sobota (0 = niedziela)
  const DRAW_HOUR = 22;
  const DAY = 86400000;

  let fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmt.formatToParts(new Date(0));
  } catch (e) { fmt = null; }

  // Zapas, gdyby przeglądarka nie znała stref czasowych: reguła UE
  // (czas letni od ostatniej niedzieli marca 01:00 UTC do ostatniej niedzieli października 01:00 UTC).
  function lastSundayUTC(year, month) {           // month: 1–12, zwraca ms (00:00 UTC)
    const last = Date.UTC(year, month, 0);         // ostatni dzień miesiąca
    return last - new Date(last).getUTCDay() * DAY;
  }
  function fallbackOffsetMin(ms) {
    const y = new Date(ms).getUTCFullYear();
    const start = lastSundayUTC(y, 3) + 3600000, end = lastSundayUTC(y, 10) + 3600000;
    return ms >= start && ms < end ? 120 : 60;
  }

  /** Przesunięcie czasu polskiego względem UTC w minutach (60 zimą, 120 latem). */
  function offsetMin(ms) {
    if (!fmt) return fallbackOffsetMin(ms);
    const p = {};
    for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 60000);
  }

  /** Składniki daty/godziny w czasie polskim. */
  function parts(date) {
    const ms = +date, d = new Date(ms + offsetMin(ms) * 60000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
  }

  const pad = n => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const splitISO = iso => iso.split('-').map(Number);

  /** Data kalendarzowa (RRRR-MM-DD) w Polsce w danej chwili. */
  function dateISO(date) { const p = parts(date); return isoOf(p.y, p.m, p.d); }

  function addDays(iso, n) {
    const [y, m, d] = splitISO(iso), t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
    return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function weekday(iso) { const [y, m, d] = splitISO(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

  /** Chwila odpowiadająca godzinie h:mi czasu polskiego danego dnia. */
  function wallToInstant(iso, h, mi) {
    const [y, m, d] = splitISO(iso), wall = Date.UTC(y, m - 1, d, h, mi);
    let ms = wall - offsetMin(wall) * 60000;
    ms = wall - offsetMin(ms) * 60000;               // poprawka w okolicy zmiany czasu
    return new Date(ms);
  }

  /** Godzina losowania (22:00 czasu polskiego) w danym dniu. */
  function drawInstant(iso) { return wallToInstant(iso, DRAW_HOUR, 0); }

  /** Najbliższe losowanie z terminarza ŚCIŚLE po danej chwili. */
  function nextScheduledDraw(from) {
    const start = dateISO(from);
    for (let i = 0; i < 9; i++) {
      const iso = addDays(start, i);
      if (DRAW_DAYS.includes(weekday(iso))) {
        const t = drawInstant(iso);
        if (t > from) return { date: iso, time: t };
      }
    }
    return null;
  }

  /** Ostatnie losowanie z terminarza, które już się odbyło (<= dana chwila). */
  function lastScheduledDraw(from) {
    const start = dateISO(from);
    for (let i = 0; i < 9; i++) {
      const iso = addDays(start, -i);
      if (DRAW_DAYS.includes(weekday(iso))) {
        const t = drawInstant(iso);
        if (t <= from) return { date: iso, time: t };
      }
    }
    return null;
  }

  /**
   * Do którego losowania należy zakład – tak samo jak w bazie (bet_results).
   * @param created  chwila zapisania zakładu (Date)
   * @param draws    losowania posortowane rosnąco po dacie: [{date: 'RRRR-MM-DD', ...}]
   * @param now      bieżąca chwila (Date)
   * @returns {status: 'done'|'pending'|'waiting', date, time, draw?}
   *   done    – losowanie jest w danych (draw = obiekt losowania)
   *   pending – losowanie jeszcze się nie odbyło
   *   waiting – według terminarza już się odbyło, ale wyników jeszcze nie ma
   */
  function targetDraw(created, draws, now) {
    const c = +created;
    let lo = 0, hi = draws.length;                   // pierwszy indeks z godziną losowania > created
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (+drawInstant(draws[mid].date) > c) hi = mid; else lo = mid + 1;
    }
    if (lo < draws.length) {
      const d = draws[lo];
      return { status: 'done', date: d.date, time: drawInstant(d.date), draw: d };
    }
    const s = nextScheduledDraw(new Date(c));
    return { status: +now < +s.time ? 'pending' : 'waiting', date: s.date, time: s.time };
  }

  /** „17.11.2026 12:40” w czasie polskim. */
  function formatDateTime(date) {
    const p = parts(date);
    return `${pad(p.d)}.${pad(p.m)}.${p.y} ${pad(p.h)}:${pad(p.mi)}`;
  }
  /** „12:40” w czasie polskim. */
  function formatTime(date) { const p = parts(date); return `${pad(p.h)}:${pad(p.mi)}`; }

  // ---------------------------------------------------------------- zegar urządzenia
  // Zegar telefonu bywa przestawiony. Prawdziwą godzinę bierzemy z nagłówka „Date” odpowiedzi
  // serwera (zapytanie zawsze do sieci, z pominięciem cache i service workera – app.js syncClock).
  // offset = czas serwera − zegar urządzenia (ms); dodatni = zegar urządzenia się spóźnia.
  const CLOCK_MAX_AGE = DAY;            // zapamiętanej różnicy używamy najwyżej 24 h
  const CLOCK_MAX_RTT = 30000;          // zapytanie dłuższe niż 30 s – pomiar niewiarygodny
  const CLOCK_WARN = 15 * 60000;        // ostrzeżenie (i ryzyko utraty rankingu) od 15 min

  /**
   * Różnica zegara z jednej odpowiedzi serwera albo null, gdy pomiar jest niewiarygodny.
   * @param date      nagłówek Date (sekundy, zaokrąglone w dół)
   * @param age       nagłówek Age (ile sekund odpowiedź leżała w pamięci CDN), może brakować
   * @param sent      zegar urządzenia (ms) przed wysłaniem zapytania
   * @param received  zegar urządzenia (ms) po otrzymaniu odpowiedzi
   */
  function measureOffset({ date, age, sent, received } = {}) {
    const d = Date.parse(date || '');
    if (!Number.isFinite(d) || !Number.isFinite(sent) || !Number.isFinite(received)) return null;
    const rtt = received - sent;
    if (rtt < 0 || rtt > CLOCK_MAX_RTT) return null;
    const a = age == null || String(age).trim() === '' ? 0 : Number(age);
    if (!Number.isFinite(a) || a < 0) return null;
    // serwer wygenerował odpowiedź (Date + pół sekundy zaokrąglenia), CDN trzymał ją Age sekund,
    // potem leciała do nas mniej więcej połowę czasu zapytania
    const serverAtReceive = d + 500 + a * 1000 + rtt / 2;
    return Math.round(serverAtReceive - received);
  }

  /**
   * Różnica, którą stosujemy teraz. saved = {offset, at} (at = zegar urządzenia w chwili pomiaru).
   * Brak/uszkodzone dane, pomiar starszy niż 24 h albo „z przyszłości” → 0 (zegar urządzenia).
   */
  function activeOffset(saved, nowDevice) {
    if (!saved || typeof saved !== 'object') return 0;
    const { offset, at } = saved;
    if (!Number.isFinite(offset) || !Number.isFinite(at) || !Number.isFinite(nowDevice)) return 0;
    const age = nowDevice - at;
    if (age < -60000 || age > CLOCK_MAX_AGE) return 0;
    return offset;
  }

  /** Czy ostrzec użytkownika, że zegar urządzenia jest przestawiony. */
  function clockIsWrong(offset) { return Math.abs(offset || 0) > CLOCK_WARN; }

  /** System urządzenia do wskazówki, gdzie ustawić czas: 'android' | 'ios' | 'other'. */
  function devicePlatform(ua = '', platform = '', touchPoints = 0) {
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (platform === 'MacIntel' && touchPoints > 1) return 'ios';   // iPad udaje komputer Mac
    return 'other';
  }

  const api = {
    TZ, DRAW_DAYS, DRAW_HOUR, offsetMin, fallbackOffsetMin, parts, dateISO, addDays, weekday,
    wallToInstant, drawInstant, nextScheduledDraw, lastScheduledDraw, targetDraw,
    formatDateTime, formatTime, hasIntlTimeZone: !!fmt,
    CLOCK_MAX_AGE, CLOCK_WARN, measureOffset, activeOffset, clockIsWrong, devicePlatform,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TyperTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
