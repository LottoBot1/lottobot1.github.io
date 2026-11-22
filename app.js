/* Typer49 – aplikacja webowa (PWA), działa na komputerze i telefonie. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const GAMES = { lotto: 'Lotto', lottoplus: 'Lotto Plus' };
  const TT = window.TyperTime;      // czas polski – time.js
  const TB = window.TyperBilans;    // bilans wydatków – bilans.js
  const DRAW_DAYS = TT.DRAW_DAYS;   // wtorek, czwartek, sobota (0 = niedziela)
  const DRAW_HOUR = TT.DRAW_HOUR;
  const PL = '(czas polski)';
  const DAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = s => { const d = parseISO(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const fmtShort = s => { const d = parseISO(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };
  const dayName = s => DAY_NAMES[parseISO(s).getDay()];
  const fmtDT = iso => TT.formatDateTime(new Date(iso));     // data i godzina w czasie polskim
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sample = (arr, k) => shuffle([...arr]).slice(0, k);
  const RANGE49 = Array.from({ length: 49 }, (_, i) => i + 1);

  const ball = (n, cls = '') => `<span class="ball d${Math.min(4, Math.floor(n / 10))} ${cls}">${n}</span>`;
  const balls = (nums, size = '', hitSet = null, anim = false) =>
    `<div class="balls ${size}">${nums.map((n, i) => {
      const c = [hitSet ? (hitSet.has(n) ? 'hit' : 'dim') : '', anim ? 'pop' : ''].join(' ');
      return anim ? ball(n, c).replace('class="ball', `style="animation-delay:${i * 70}ms" class="ball`) : ball(n, c);
    }).join('')}</div>`;

  function parseNums(str) {
    const nums = (String(str).match(/\d+/g) || []).map(Number);
    const uniq = [...new Set(nums)];
    if (uniq.length !== 6 || nums.length !== 6) return { err: 'Wpisz dokładnie 6 różnych liczb.' };
    if (!uniq.every(n => n >= 1 && n <= 49)) return { err: 'Liczby muszą być z zakresu 1–49.' };
    return { nums: uniq.sort((a, b) => a - b) };
  }

  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ------------------------------------------------------------------ zegar urządzenia
  // Godzina zakładu, odliczanie i rozliczanie liczą się od prawdziwego czasu (serwera), nie od zegara telefonu.
  // Pomiar: HEAD do własnej strony – zawsze sieć (cache: 'no-store', a service worker nie obsługuje HEAD).
  // Bez internetu używamy zapamiętanej różnicy najwyżej 24 h (time.js activeOffset), potem zegara telefonu.
  const clock = { saved: store.get('typer.clock', null), busy: false, last: 0 };
  const clockOffset = () => TT.activeOffset(clock.saved, Date.now());
  const now = () => new Date(Date.now() + clockOffset());

  async function syncClock(force = false) {
    const t0 = Date.now();
    if (clock.busy || (!force && clock.last && t0 - clock.last >= 0 && t0 - clock.last < 60000)) return;
    clock.busy = true;
    try {
      const sent = Date.now();
      const res = await fetch(`manifest.webmanifest?clock=${sent}`, { method: 'HEAD', cache: 'no-store' });
      const received = Date.now();
      const offset = TT.measureOffset({ date: res.headers.get('Date'), age: res.headers.get('Age'), sent, received });
      if (offset !== null) {
        clock.saved = { offset, at: received }; clock.last = received;
        store.set('typer.clock', clock.saved);   // może się nie udać (np. tryb prywatny) – w pamięci i tak jest
      }
    } catch { /* brak internetu – zostaje zapamiętana różnica (max 24 h) albo zegar telefonu */ }
    finally { clock.busy = false; renderClockWarn(); }
  }

  const CLOCK_HELP = {
    android: 'Ustaw czas automatyczny: Ustawienia → System → Data i godzina → Automatycznie.',
    ios: 'Ustaw czas automatyczny: Ustawienia → Ogólne → Data i czas → Ustaw automatycznie.',
    other: 'Włącz automatyczny czas w ustawieniach urządzenia.',
  };
  function renderClockWarn() {
    const el = $('#clockWarn'); if (!el) return;
    const off = clockOffset();
    if (!TT.clockIsWrong(off)) { el.hidden = true; return; }
    const min = Math.round(Math.abs(off) / 60000);
    const amount = min >= 120 ? `${Math.round(min / 60)} godz.` : `${min} min`;
    const dir = off > 0 ? 'spóźnia się' : 'śpieszy się';
    const os = TT.devicePlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0);
    el.textContent = `⏰ Zegar w Twoim urządzeniu ${dir} o ok. ${amount}. Godziny zakładów poprawiamy automatycznie, ale ustaw zegar, żeby wszystko działało dobrze. ${CLOCK_HELP[os]}`;
    el.hidden = false;
  }

  // ------------------------------------------------------------------ state
  const state = {
    game: store.get('lotto2.game', 'lotto'),
    view: 'home',
    data: { lotto: null, lottoplus: null },   // {updated, draws:[{no,date,nums,manual}]}
    manual: store.get('lotto2.manual', { lotto: [], lottoplus: [] }),
    bets: store.get('lotto2.bets', []),
    method: 'stat',
    count: 3,
    range: 100,
    heatMode: 'freq',
    betFilter: 'all',
    bilansPeriod: store.get('lotto2.bilansPeriod', 'month'),
    sysPicked: new Set(),
    sysGuar: store.get('lotto2.sysGuar', '3-4'),
    sysResult: null,
    sysBusy: false,
    filters: Object.assign({ hist: true, sum: true, even: true, high: true, decades: true, endings: true, seq: true }, store.get('lotto2.filters', {})),
    picked: new Set(),
    lastGen: [],
    statsCache: {},
  };
  const saveBets = () => { store.set('lotto2.bets', state.bets); renderBadge(); };
  const Cloud = window.Cloud || { enabled: false, user: null, push() {}, remove() {} };

  // ------------------------------------------------------------------ konto wymagane do zapisywania (Etap 4, krok 4)
  // Zakłady zapisane na urządzeniu bez konta („zakłady gościa”) leżą osobno (lotto2.bets.guest) i nigdy nie są
  // wysyłane ani usuwane bez decyzji użytkownika. Na liście zakładów są tylko zakłady konta.
  // Zestaw kliknięty „Zapisz” przez gościa i kod zaproszenia czekają na zalogowanie najwyżej 7 dni (dostep.js).
  const TD = window.TyperDostep;
  const OWNER_KEY = 'typer.owner', GUEST_KEY = 'lotto2.bets.guest';
  const PENDING_SAVE = 'typer.pendingSave', PENDING_JOIN = 'typer.pendingJoin';
  let guestBets = store.get(GUEST_KEY, []);
  const saveGuest = () => store.set(GUEST_KEY, guestBets);
  (function separateGuestBets() {
    const s = TD.splitLegacy(state.bets, store.get(OWNER_KEY, null));
    if (!s.guest.length) return;
    const merged = TD.mergeGuest(guestBets, s.guest);
    // najpierw zapis w nowym miejscu i sprawdzenie – dopiero potem lista konta jest czyszczona
    if (!store.set(GUEST_KEY, merged) || (store.get(GUEST_KEY, []) || []).length !== merged.length) return;
    guestBets = merged; state.bets = s.account; store.set('lotto2.bets', state.bets);
  })();
  const unmovedGuest = () => guestBets.filter(b => !b.moved);
  // Podgląd właściciela „jako gość” (?jako=gosc) – tylko na tym urządzeniu, nic nie wylogowuje.
  const previewGuest = () => store.get('typer.viewAs', null) === 'guest';
  /** Konto na tym urządzeniu: zalogowany albo zapamiętany właściciel (np. bez internetu sesja nie może się odświeżyć). */
  const hasAccount = () => !previewGuest() && !!(Cloud.user || store.get(OWNER_KEY, null));
  const isIOS = () => TT.devicePlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0) === 'ios';
  const standalone = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);

  const GATE_TEXT = {
    bets: ['📋 Twoje zakłady', 'Zakłady zapisujemy na Twoim koncie. Dzięki temu są bezpieczne, widzisz je na telefonie i komputerze, a aplikacja sama sprawdza je po każdym losowaniu.'],
    rank: ['🏆 Ranking i grupy', 'Ranking porównuje zakłady zapisane na kontach – pod pseudonimem, bez imienia i nazwiska. Możesz też założyć grupę ze znajomymi.'],
    push: ['', 'Powiadomienie mówi, że Twoje zakłady są rozliczone – dlatego potrzebne jest konto, na którym są zapisane.'],
    io: ['', 'Kopia i import dotyczą zakładów zapisanych na koncie.'],
    systems: ['', 'System skrócony to od kilku do kilkuset zakładów naraz – zapisujemy je na Twoim koncie.'],
  };
  /** Spokojna karta: co daje darmowe konto + „Załóż darmowe konto” / „Zaloguj się”. compact = wewnątrz innej karty. */
  function accountGate(kind, compact = false) {
    const [title, why] = GATE_TEXT[kind] || GATE_TEXT.bets;
    const down = !Cloud.enabled
      ? '<p class="hint">Logowanie chwilowo nie działa (brak połączenia z serwerem kont). Spróbuj później – reszta aplikacji działa normalnie.</p>' : '';
    const buttons = `<div class="row-gap gate-btns">
        <button class="btn primary" data-auth="register">Załóż darmowe konto</button>
        <button class="btn" data-auth="login">Zaloguj się</button></div>`;
    if (compact) return `<div class="gate compact"><p class="hint">${why} Konto jest darmowe.</p>${down || buttons}</div>`;
    return `<div class="card gate">
        <h2>${title}</h2>
        <p>${why}</p>
        <ul class="gate-list">
          <li>☁️ zakłady na wszystkich Twoich urządzeniach</li>
          <li>✅ automatyczne sprawdzanie po każdym losowaniu</li>
          <li>🏆 ranking graczy i grupy ze znajomymi</li>
          <li>🔔 powiadomienia po losowaniu</li>
        </ul>
        <p class="hint">Konto jest <b>darmowe</b>. Wystarczy adres e-mail i hasło. Bez konta nadal możesz korzystać ze statystyk, generatora i sprawdzania kuponu.</p>
        ${down || buttons}
      </div>`;
  }
  function openAuth(mode) {
    acct.mode = mode === 'register' ? 'register' : 'login';
    setView('account');
  }

  // ------------------------------------------------------------------ dane
  async function loadGame(key) {
    const res = await fetch(`data/${key}.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return { updated: j.updated, draws: j.draws.map(([no, date, nums]) => ({ no, date, nums })) };
  }

  function withManual(key) {
    const d = state.data[key];
    if (!d) return null;
    const have = new Set(d.draws.map(x => x.date));
    const extra = (state.manual[key] || []).filter(m => !have.has(m.date));
    // usuń ręczne wpisy, które już mają oficjalny odpowiednik
    if (extra.length !== (state.manual[key] || []).length) {
      state.manual[key] = extra; store.set('lotto2.manual', state.manual);
    }
    if (!extra.length) return d;
    const draws = [...d.draws, ...extra.map(m => ({ no: null, date: m.date, nums: m.nums, manual: true }))]
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ...d, draws };
  }

  const draws = key => (withManual(key || state.game) || { draws: [] }).draws;
  const drawByDate = (key, date) => draws(key).find(d => d.date === date) || null;

  async function refresh(manual = false) {
    const btn = $('#refreshBtn'); btn.classList.add('spin');
    try {
      const [a, b] = await Promise.all([loadGame('lotto'), loadGame('lottoplus')]);
      state.data.lotto = a; state.data.lottoplus = b; state.statsCache = {};
      if (manual) toast('Wyniki odświeżone ✓');
    } catch (e) {
      $('#dataStatus').textContent = 'Brak połączenia – dane z pamięci';
      if (manual) toast('Nie udało się pobrać danych (offline?)');
      if (!state.data.lotto) { renderAll(); return; }
    } finally { btn.classList.remove('spin'); }
    renderAll();
  }

  // ------------------------------------------------------------------ terminarz losowań
  // Zawsze według czasu polskiego (time.js) – niezależnie od strefy urządzenia. Zwracają {date: 'RRRR-MM-DD', time: Date}.
  const nextDrawTime = (from = now()) => TT.nextScheduledDraw(from);
  const lastDrawTime = (from = now()) => TT.lastScheduledDraw(from);

  // ------------------------------------------------------------------ statystyki
  function stats(key, range) {
    const ck = `${key}|${range}|${draws(key).length}`;
    if (state.statsCache[ck]) return state.statsCache[ck];
    const all = draws(key);
    const set = range ? all.slice(-range) : all;
    const freq = Array(50).fill(0), lastSeen = Array(50).fill(-1);
    set.forEach((d, i) => d.nums.forEach(n => { freq[n]++; lastSeen[n] = i; }));
    // zaległość liczona na całej historii
    const gap = Array(50).fill(all.length);
    for (let i = all.length - 1, found = 0; i >= 0 && found < 49; i--) {
      all[i].nums.forEach(n => { if (gap[n] === all.length) { gap[n] = all.length - 1 - i; found++; } });
    }
    // model trendu: wykładniczo ważona częstość (ostatnie 300 losowań) + premia za zaległość
    const recent = all.slice(-300), w = Array(50).fill(0), decay = 0.985;
    recent.forEach((d, i) => { const k = Math.pow(decay, recent.length - 1 - i); d.nums.forEach(n => { w[n] += k; }); });
    const maxW = Math.max(...w.slice(1)), maxG = Math.max(...gap.slice(1)) || 1;
    const trend = Array(50).fill(0);
    for (let n = 1; n <= 49; n++) trend[n] = 0.75 * (w[n] / maxW) + 0.25 * Math.min(1, gap[n] / Math.max(12, maxG));

    const byFreq = RANGE49.slice().sort((a, b) => freq[b] - freq[a] || a - b);
    const hot = byFreq.slice(0, 12), cold = byFreq.slice(-12).reverse();
    const overdue = RANGE49.slice().sort((a, b) => gap[b] - gap[a]).slice(0, 12);
    const trendTop = RANGE49.slice().sort((a, b) => trend[b] - trend[a]).slice(0, 12);

    const even = Array(7).fill(0), sums = {};
    const sumBins = [[21, 99], [100, 119], [120, 139], [140, 159], [160, 179], [180, 199], [200, 279]];
    const sumCnt = Array(sumBins.length).fill(0);
    const pairs = new Map();
    set.forEach(d => {
      even[d.nums.filter(n => n % 2 === 0).length]++;
      const s = sum(d.nums); const bi = sumBins.findIndex(([a, b]) => s >= a && s <= b); if (bi >= 0) sumCnt[bi]++;
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
        const k = d.nums[i] * 100 + d.nums[j]; pairs.set(k, (pairs.get(k) || 0) + 1);
      }
    });
    const topPairs = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => [Math.floor(k / 100), k % 100, c]);
    const out = { n: set.length, from: set[0]?.date, to: set.at(-1)?.date, freq, gap, trend, hot, cold, overdue, trendTop, even, sumBins, sumCnt, topPairs };
    state.statsCache[ck] = out; return out;
  }

  let historySetCache = {};
  function historySet(key) {
    const len = draws(key).length;
    if (historySetCache[key]?.len !== len) historySetCache[key] = { len, set: new Set(draws(key).map(d => d.nums.join(','))) };
    return historySetCache[key].set;
  }

  // ------------------------------------------------------------------ filtry i generator
  const FILTERS = [
    ['hist', 'Kombinacja nie padła nigdy wcześniej', n => !historySet(state.game).has(n.join(','))],
    ['sum', 'Suma liczb 115–185', n => { const s = sum(n); return s >= 115 && s <= 185; }],
    ['even', '2–4 liczby parzyste', n => { const e = n.filter(x => x % 2 === 0).length; return e >= 2 && e <= 4; }],
    ['high', 'Min. 2 liczby powyżej 31 (unikanie „dat”)', n => n.filter(x => x > 31).length >= 2],
    ['decades', 'Liczby z min. 3 dziesiątek', n => new Set(n.map(x => Math.floor((x - 1) / 10))).size >= 3],
    ['endings', 'Maks. 2 liczby z tą samą końcówką', n => { const c = {}; return n.every(x => (c[x % 10] = (c[x % 10] || 0) + 1) <= 2); }],
    ['seq', 'Bez 3 kolejnych liczb (np. 7-8-9)', n => !n.some((x, i) => i < 4 && n[i + 1] === x + 1 && n[i + 2] === x + 2)],
  ];
  const passes = nums => FILTERS.every(([k, , fn]) => !state.filters[k] || fn(nums));

  function weightedPick(weights, k) {
    const pool = RANGE49.slice(), out = [];
    while (out.length < k) {
      const tot = sum(pool.map(n => weights[n]));
      let r = Math.random() * tot, idx = 0;
      for (; idx < pool.length - 1; idx++) { r -= weights[pool[idx]]; if (r <= 0) break; }
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  function candidate(method, st) {
    if (method === 'stat') {
      const h = sample(st.hot, 2), c = sample(st.cold.filter(x => !h.includes(x)), 2);
      const r = sample(RANGE49.filter(x => !h.includes(x) && !c.includes(x)), 2);
      return [...h, ...c, ...r];
    }
    if (method === 'trend') {
      const w = st.trend.map(v => Math.pow(Math.max(v, 0.01), 2.2));
      return weightedPick(w, 6);
    }
    return sample(RANGE49, 6);
  }

  function generate(method, count) {
    const st = stats(state.game, state.range || 0);
    const out = [], seen = new Set(state.bets.map(b => b.nums.join(',')));
    for (let k = 0; k < count; k++) {
      let nums, tries = 0;
      do { nums = candidate(method, st).sort((a, b) => a - b); tries++; }
      while ((!passes(nums) || seen.has(nums.join(','))) && tries < 5000);
      seen.add(nums.join(','));
      out.push({ nums, ok: passes(nums) });
    }
    return out;
  }

  function addBet(nums, method, base = state.game, plus = $('#withPlus').checked) {
    const bet = { id: uid(), t: now().toISOString(), nums, method, base, plus: !!plus, played: false };
    state.bets.unshift(bet); saveBets(); Cloud.push(bet); return bet;
  }

  /** Zapis z Generatora / ręcznego wyboru. Gość: zestawy czekają na zalogowanie (7 dni), otwiera się ekran konta.
      Zwraca true, gdy zapisano od razu. */
  function saveSets(sets) {
    if (hasAccount()) { sets.forEach(s => addBet(s.nums, s.method, s.base, s.plus)); return true; }
    if (previewGuest()) { toast('Podgląd jako gość: tu otworzyłoby się zakładanie konta (nic nie zapisano)'); openAuth('register'); return false; }
    const prev = TD.pendingSets(store.get(PENDING_SAVE, null), now().getTime()) || [];
    const keys = new Set(prev.map(s => s.nums.join(',')));
    const all = prev.concat(sets.filter(s => !keys.has(s.nums.join(',')))).slice(0, 20);
    store.set(PENDING_SAVE, { sets: all, at: now().toISOString() });
    openAuth('register');
    return false;
  }

  /** Po zalogowaniu: zapisz zestawy, które czekały. Godzina zakładu = chwila zapisu (nie kliknięcia). */
  function applyPendingSave() {
    const p = store.get(PENDING_SAVE, null); if (!p) return;
    const sets = TD.pendingSets(p, now().getTime());
    if (!sets) { localStorage.removeItem(PENDING_SAVE); if (p.sets?.length) toast('Zestaw czekał ponad 7 dni i nie został zapisany. Wygeneruj go ponownie.'); return; }
    if (!canAddBets(sets.length)) return;   // limit planu darmowego – zestaw dalej czeka
    const clicked = nextDrawTime(new Date(p.at)).date, target = nextDrawTime(now()).date;
    sets.forEach(s => addBet(s.nums, s.method || 'manual', s.base || 'lotto', s.plus));
    localStorage.removeItem(PENDING_SAVE);
    state.lastGen.forEach(g => { if (sets.some(s => s.nums.join(',') === g.nums.join(','))) g.saved = true; });
    const n = sets.length, what = n === 1 ? 'zestaw' : `${n} ${n < 5 ? 'zestawy' : 'zestawów'}`;
    toast(clicked !== target
      ? `Losowanie z ${fmtDate(clicked)} już się odbyło – ${what} zapisano na następne (${fmtDate(target)}).`
      : `Zapisano ${what}, ${n === 1 ? 'który czekał' : 'które czekały'} na logowanie ✓`);
    renderAll();
  }

  // ------------------------------------------------------------------ weryfikacja zakładów
  // Ta sama zasada co bet_results w bazie: pierwsze losowanie, które faktycznie się odbyło po zapisaniu zakładu.
  function evalBet(b) {
    const t = TT.targetDraw(new Date(b.t), draws('lotto'), now());
    const date = t.date, target = t.time;
    if (t.status !== 'done') return { status: t.status, date, target };
    const L = t.draw, P = b.plus ? drawByDate('lottoplus', date) : null;
    const hit = d => d ? d.nums.filter(n => b.nums.includes(n)) : null;
    const hl = hit(L), hp = hit(P);
    const best = Math.max(hl.length, hp ? hp.length : 0);
    return { status: 'done', date, target, L, P, hl, hp, best, plusMissing: b.plus && !P };
  }

  const METHOD_LABEL = { stat: 'Statystyka', trend: 'Ważona częstość', random: 'Losowo', manual: 'Własne', system: 'System skrócony', ai: 'Import (stary program)', import: 'Import' };

  // ------------------------------------------------------------------ render: START
  function renderHome() {
    const at = now(), next = nextDrawTime(at);
    $('#nextDrawDate').textContent = `${dayName(next.date)}, ${fmtDate(next.date)} o ${DRAW_HOUR}:00 ${PL}`;

    const resultCard = (key, el) => {
      const d = draws(key).at(-1);
      el.innerHTML = d ? `
        <div class="meta"><span class="title">${GAMES[key]}</span><span>${d.no ? '#' + d.no + ' · ' : ''}${dayName(d.date)}, ${fmtDate(d.date)}${d.manual ? ' · ręcznie' : ''}</span></div>
        ${balls(d.nums)}` : `<div class="meta"><span class="title">${GAMES[key]}</span></div><p class="muted">Brak danych</p>`;
    };
    resultCard('lotto', $('#lastLotto'));
    resultCard('lottoplus', $('#lastPlus'));

    // czy wynik ostatniego losowania już jest?
    const lastS = lastDrawTime(at), last = lastS.time, lastIso = lastS.date, latest = draws('lotto').at(-1);
    const alert = $('#missingAlert');
    if (latest && latest.date < lastIso) {
      const mins = Math.round((at - last) / 60000);
      alert.hidden = false; alert.className = 'alert';
      alert.innerHTML = mins < 180
        ? `⏳ Losowanie z ${fmtDate(lastIso)} odbyło się ${mins} min temu – wyniki pojawią się automatycznie wkrótce (zwykle do godziny). Możesz odświeżyć przyciskiem ↻.`
        : `⚠️ Brakuje wyników z ${fmtDate(lastIso)}. Automat spróbuje ponownie. Możesz też dodać wynik ręcznie w zakładce „Więcej”.`;
    } else alert.hidden = true;


    // podsumowanie zakładów (bez konta – krótka informacja, bez presji)
    if (!hasAccount()) {
      const g = unmovedGuest().length;
      $('#homeBets').innerHTML = `
        <div class="card-head"><h2>Twoje zakłady</h2></div>
        <p class="hint">Zakłady zapisujesz na darmowym koncie – wtedy aplikacja sama sprawdza je po losowaniu i widzisz je na każdym urządzeniu.${g ? ` Na tym urządzeniu masz ${g} ${plural(g, 'zakład zapisany', 'zakłady zapisane', 'zakładów zapisanych')} wcześniej bez konta – zobaczysz je w zakładce Zakłady.` : ''}</p>
        <div class="row-gap"><button class="btn sm" data-goto="bets">Dowiedz się więcej</button></div>`;
    } else renderHomeBets(latest);
    $('#recentGameLabel').textContent = GAMES[state.game];
    $('#recentDraws').innerHTML = draws().slice(-10).reverse().map(d => `
      <div class="draw-row"><div class="when"><b>${fmtShort(d.date)}</b>${dayName(d.date).slice(0, 3)}.${d.no ? ' #' + d.no : ''}</div>${balls(d.nums, 'xs')}</div>`).join('') || '<p class="muted">Brak danych</p>';
  }

  function renderHomeBets(latest) {
    const ev = state.bets.map(b => [b, evalBet(b)]);
    const pending = ev.filter(([, e]) => e.status !== 'done');
    const lastDone = ev.filter(([, e]) => e.status === 'done' && e.date === latest?.date);
    const best = lastDone.reduce((m, [, e]) => Math.max(m, e.best), 0);
    $('#homeBets').innerHTML = `
      <div class="card-head"><h2>Twoje zakłady</h2><button class="btn sm" data-goto="bets">Zobacz wszystkie</button></div>
      <div class="bet-res">
        <span>Oczekujące: <b>${pending.length}</b></span>
        ${latest ? `<span>Rozliczone z ${fmtShort(latest.date)}: <b>${lastDone.length}</b></span>` : ''}
        ${lastDone.length ? `<span>Najlepszy wynik: <b>${best} traf.</b></span>` : ''}
      </div>
      ${state.bets.length ? '' : '<p class="hint">Nie masz jeszcze zakładów – przejdź do Generatora.</p>'}`;
  }

  function tickCountdown() {
    const at = now(), next = nextDrawTime(at).time;
    let s = Math.max(0, Math.floor((next - at) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    $('#countdown').innerHTML = `${d ? `${d}<small>d</small>` : ''}${pad(h)}<small>h</small>${pad(m)}<small>m</small>${pad(s)}<small>s</small>`;
  }

  // ------------------------------------------------------------------ render: GENERATOR
  const METHOD_HINT = {
    stat: '2 liczby najczęstsze, 2 najrzadsze w wybranym okresie i 2 losowe, z filtrami. To nie zwiększa szansy wygranej.',
    trend: 'Liczby ważone częstością z ostatnich 300 losowań (nowsze ważą więcej) i przerwą od ostatniego wystąpienia. Opisuje przeszłość, nie przewiduje wyników.',
    random: 'Czysty przypadek – matematycznie tak samo dobry jak każda inna metoda. Filtry nadal działają.',
    manual: 'Zaznacz własne liczby i zapisz kupon, żeby aplikacja go sprawdziła po losowaniu.',
    system: 'System skrócony: wybierasz 7–15 liczb, a aplikacja układa z nich mniej zakładów niż system pełny, z gwarancją mniejszej wygranej, gdy część wylosowanych liczb będzie wśród Twoich.',
  };

  function renderGen() {
    $('#genGameLabel').textContent = `baza: ${GAMES[state.game]}`;
    $$('#methodChips .chip').forEach(c => c.classList.toggle('active', c.dataset.method === state.method));
    $('#methodHint').textContent = METHOD_HINT[state.method];
    const manual = state.method === 'manual', system = state.method === 'system';
    $('#autoGen').hidden = manual || system; $('#manualGen').hidden = !manual; $('#systemGen').hidden = !system;
    $('#genResults').hidden = system; $('#sysResults').hidden = !system;
    if (system) renderSystem();
    $('#cntVal').textContent = state.count;
    $('#filterList').innerHTML = FILTERS.map(([k, label]) => `
      <label class="switch-row"><input type="checkbox" data-filter="${k}" ${state.filters[k] ? 'checked' : ''}><span class="switch"></span><span>${label}</span></label>`).join('');
    $('#filtersCount').textContent = `(${FILTERS.filter(([k]) => state.filters[k]).length}/${FILTERS.length} aktywne)`;
    if (state.method === 'trend') {
      const st = stats(state.game, 0);
      $('#methodHint').innerHTML = esc(METHOD_HINT.trend) + `<br>Najwyżej w zestawieniu: <b>${st.trendTop.slice().sort((a, b) => a - b).join(', ')}</b>`;
    }
    renderPicker();
    if (state.lastGen.length && !$('#genResults').innerHTML) renderGenResults();   // zestawy odtworzone po aktualizacji
  }

  function renderPicker() {
    $('#picker').innerHTML = RANGE49.map(n => `<button class="pick ${state.picked.has(n) ? 'on' : ''}" data-n="${n}">${n}</button>`).join('');
    $('#pickCount').textContent = state.picked.size;
    $('#pickSave').disabled = state.picked.size !== 6;
  }

  function renderGenResults(anim = false) {
    if (!state.lastGen.length) { $('#genResults').innerHTML = ''; return; }
    const next = nextDrawTime();
    $('#genResults').innerHTML = `<div class="card">
      <div class="card-head"><h2>Wylosowane zestawy</h2><button class="btn sm primary" id="saveAll">Zapisz wszystkie</button></div>
      ${state.lastGen.map((g, i) => `
        <div class="gen-item">
          <div>${balls(g.nums, 'sm', null, anim)}
            <div class="gen-meta">suma ${sum(g.nums)} · parzyste ${g.nums.filter(n => n % 2 === 0).length}${g.ok ? '' : ' · ⚠️ nie spełnia wszystkich filtrów'}</div></div>
          ${g.saved ? '<span class="status win">Zapisano ✓</span>' : `<button class="btn sm" data-save="${i}">Zapisz</button>`}
        </div>`).join('')}
      <p class="hint">Zapisane zakłady zostaną sprawdzone po losowaniu ${dayName(next.date)} ${fmtShort(next.date)}, ${DRAW_HOUR}:00 ${PL}.</p>
    </div>`;
  }

  // ------------------------------------------------------------------ systemy skrócone (Premium – featureTiers.systems)
  const TS = window.TyperSystemy;
  const SYS_CONFIRM_GR = 100 * 100;   // system droższy niż 100 zł → okno z potwierdzeniem
  const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;
  const HITS_WORD = { 3: '3 trafienia (trójkę)', 4: '4 trafienia (czwórkę)', 5: '5 trafień (piątkę)' };
  const guarText = (m, k) => `Gwarancja ${m} z ${k}: jeśli ${k} ${plural(k, 'wylosowana liczba', 'wylosowane liczby', 'wylosowanych liczb')} ${k >= 5 ? 'będzie' : 'będą'} wśród wybranych, co najmniej jeden zakład ma ${HITS_WORD[m]}. Gdy trafisz mniej z wybranych, gwarancji nie ma.`;
  const fmtSecs = (ms, short = false) => ms < 100 ? (short ? '<0,1 s' : 'poniżej 0,1 s') : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const sysGuar = () => { const [m, k] = state.sysGuar.split('-').map(Number); return { m, k }; };

  let sysWorker = null, sysReq = 0;
  /** Liczy system w tle (Web Worker), żeby ekran się nie zawieszał; bez Workera – w głównym wątku. */
  function computeSystem(nums, m, k) {
    return new Promise((resolve, reject) => {
      const id = ++sysReq;
      const sync = () => setTimeout(() => { try { resolve(TS.build(nums, m, k)); } catch (e) { reject(e); } }, 30);
      if (sysWorker === null) { try { sysWorker = new Worker('systemy.js'); } catch { sysWorker = false; } }
      if (!sysWorker) return sync();
      const onMsg = e => {
        if (!e.data || e.data.id !== id) return;
        sysWorker.removeEventListener('message', onMsg);
        e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error));
      };
      sysWorker.addEventListener('message', onMsg);
      sysWorker.onerror = ev => { ev.preventDefault && ev.preventDefault(); try { sysWorker.terminate(); } catch { } sysWorker = false; sync(); };
      sysWorker.postMessage({ id, nums, m, k });
    });
  }

  function sysCost(count) {
    const next = nextDrawTime(), plus = $('#withPlus').checked, each = TB.betCost(next.date, plus);
    return { each, total: count * each, plus, next };
  }

  function renderSystem() {
    const guest = !hasAccount();
    $('#sysGate').innerHTML = guest ? accountGate('systems', true) : '';
    $('#sysInner').hidden = guest;
    if (guest) { $('#sysResults').hidden = true; return; }
    const n = state.sysPicked.size, { m, k } = sysGuar();
    $('#sysPicker').innerHTML = RANGE49.map(x => `<button class="pick ${state.sysPicked.has(x) ? 'on' : ''}" data-n="${x}">${x}</button>`).join('');
    $('#sysCount').textContent = n;
    $('#sysGuar').innerHTML = TS.GUARANTEES.map(([a, b]) =>
      `<button class="seg-btn${state.sysGuar === a + '-' + b ? ' active' : ''}" data-g="${a}-${b}">${a} z ${b}</button>`).join('');
    $('#sysGuarText').textContent = guarText(m, k);
    const btn = $('#sysBuild');
    btn.disabled = state.sysBusy || n < TS.MIN_NUMS || n > TS.MAX_NUMS;
    btn.textContent = state.sysBusy ? 'Liczę…' : n < TS.MIN_NUMS ? `Ułóż system (wybierz jeszcze ${TS.MIN_NUMS - n})` : 'Ułóż system';
    renderSysResults();
  }

  function renderSysResults() {
    const el = $('#sysResults'), r = state.sysResult;
    if (state.sysBusy) { el.innerHTML = '<div class="card"><p class="hint">⏳ Układam system i sprawdzam gwarancję na wszystkich możliwych losowaniach…</p></div>'; return; }
    if (!r) { el.innerHTML = ''; return; }
    if (r.error) { el.innerHTML = `<div class="card"><p class="hint">❌ ${esc(r.error)}</p></div>`; return; }
    const n = r.bets.length, c = sysCost(n), full = sysCost(r.full), tooBig = n > TS.MAX_BETS;
    el.innerHTML = `<div class="card sys-res">
      <div class="card-head"><h2>System: ${r.v} liczb, ${r.m} z ${r.k}</h2><span class="status win">✓ gwarancja sprawdzona</span></div>
      <div class="sys-cost${c.total > SYS_CONFIRM_GR ? ' high' : ''}">
        <span class="muted">Koszt systemu${c.plus ? ' (z Plusem)' : ''}</span>
        <b>${TB.fmtZl(c.total)}</b>
        <span>${n} ${plural(n, 'zakład', 'zakłady', 'zakładów')} × ${TB.fmtZl(c.each)} · losowanie ${dayName(c.next.date)} ${fmtShort(c.next.date)}</span>
      </div>
      <p class="hint">Dla porównania system pełny z ${r.v} liczb: ${r.full} ${plural(r.full, 'zakład', 'zakłady', 'zakładów')} = ${TB.fmtZl(full.total)}.</p>
      <p class="hint">${guarText(r.m, r.k)}</p>
      ${tooBig
        ? `<div class="alert">Ten system ma ${n} zakładów – więcej niż limit ${TS.MAX_BETS}. Wybierz mniej liczb albo słabszą gwarancję.</div>`
        : `<button class="btn primary big" id="sysSave" ${r.saved ? 'disabled' : ''}>${r.saved ? 'Zapisano ✓' : `Zapisz wszystkie zakłady (${n})`}</button>`}
      <p class="hint resp">⚠️ System skrócony nie zwiększa szansy na wygraną w przeliczeniu na wydaną złotówkę. Daje tylko pewność mniejszej wygranej, gdy wylosowane liczby znajdą się wśród Twoich. 🔞 Gra tylko dla osób pełnoletnich.</p>
      <p class="hint">Policzono w ${fmtSecs(r.wall)}.</p>
      <details class="sys-list"${n <= 20 ? ' open' : ''}><summary>Zakłady do przepisania na kupony (${n})</summary>
        ${r.bets.map((b, i) => `<div class="gen-item"><span class="muted sys-no">${i + 1}.</span>${balls(b, 'sm')}</div>`).join('')}
      </details>
    </div>`;
  }

  async function buildSystem() {
    if (!requireFeature('systems', 'Systemy skrócone')) return;
    const nums = [...state.sysPicked].sort((a, b) => a - b), { m, k } = sysGuar();
    state.sysBusy = true; state.sysResult = null; renderSystem();
    const t0 = performance.now();
    try { state.sysResult = { ...(await computeSystem(nums, m, k)), wall: performance.now() - t0 }; }
    catch (e) { state.sysResult = { error: e.message }; }
    state.sysBusy = false; renderSystem();
    $('#sysResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Okno potwierdzenia. Zwraca Promise<boolean>. html – zaufany tekst aplikacji (bez danych od użytkowników). */
  function askConfirm(title, html, okText = 'Potwierdzam') {
    return new Promise(resolve => {
      const m = $('#confirmModal'), ok = $('#cmOk'), no = $('#cmCancel');
      $('#cmTitle').textContent = title; $('#cmBody').innerHTML = html; ok.textContent = okText;
      m.hidden = false; no.focus();
      const done = v => { m.hidden = true; ok.onclick = no.onclick = m.onclick = m.onkeydown = null; resolve(v); };
      ok.onclick = () => done(true);
      no.onclick = () => done(false);
      m.onclick = e => { if (e.target === m) done(false); };
      m.onkeydown = e => { if (e.key === 'Escape') done(false); };
    });
  }

  async function saveSystem() {
    const r = state.sysResult; if (!r || r.error || r.saved) return;
    if (!hasAccount()) { openAuth('register'); return; }
    if (!requireFeature('systems', 'Systemy skrócone')) return;
    const n = r.bets.length; if (n > TS.MAX_BETS || !canAddBets(n)) return;
    const c = sysCost(n);
    if (c.total > SYS_CONFIRM_GR) {
      const ok = await askConfirm('Potwierdź koszt systemu', `
        <p class="modal-amount">${TB.fmtZl(c.total)}</p>
        <p>${n} ${plural(n, 'zakład', 'zakłady', 'zakładów')} × ${TB.fmtZl(c.each)}${c.plus ? ' (z Plusem)' : ''} na losowanie ${dayName(c.next.date)} ${fmtShort(c.next.date)}.</p>
        <p class="hint">🔞 Graj odpowiedzialnie: ustal z góry kwotę na grę i nie próbuj odgrywać strat. Żaden system nie zwiększa szansy na wygraną w przeliczeniu na wydaną złotówkę.</p>`,
        `Tak, zapisz za ${TB.fmtZl(c.total)}`);
      if (!ok) return;
    }
    const t = now().toISOString(), plus = $('#withPlus').checked;
    const fresh = r.bets.map(nums => ({ id: uid(), t, nums: [...nums], method: 'system', base: state.game, plus, played: false }));
    state.bets.unshift(...fresh); saveBets(); fresh.forEach(b => Cloud.push(b));
    r.saved = true; renderSysResults(); renderBadge();
    toast(`Zapisano ${n} ${plural(n, 'zakład', 'zakłady', 'zakładów')} ✓ – oznacz je jako „Zagrany”, gdy kupisz kupony`);
  }

  // Pomiar szybkości na telefonie: adres z ?pomiar=systemy. Tylko liczy (nic nie zapisuje).
  async function runSystemsBenchmark() {
    const card = document.createElement('div');
    card.className = 'card bench';
    card.innerHTML = `<div class="card-head"><h2>⏱ Pomiar szybkości systemów</h2><button class="btn sm" id="benchClose">Zamknij</button></div>
      <p class="hint">Liczę wszystkie systemy (7–15 liczb × 5 gwarancji). Nie zamykaj aplikacji. To potrwa do ok. minuty.</p>
      <p class="muted" id="benchInfo"></p><div class="bench-table" id="benchTable"></div>
      <button class="btn primary" id="benchCopy" disabled>Kopiuj wyniki</button> <span class="muted" id="benchMsg"></span>`;
    $('#app').prepend(card);
    $('#benchClose').onclick = () => card.remove();
    const ua = navigator.userAgent, os = TT.devicePlatform(ua, navigator.platform, navigator.maxTouchPoints || 0);
    $('#benchInfo').textContent = `Urządzenie: ${os} · rdzenie: ${navigator.hardwareConcurrency || '?'} · ${ua.slice(0, 120)}`;
    const rows = [], vs = []; for (let v = TS.MIN_NUMS; v <= TS.MAX_NUMS; v++) vs.push(v);
    const cell = {};
    const draw = () => {
      $('#benchTable').innerHTML = `<table><tr><th>liczb</th>${TS.GUARANTEES.map(([m, k]) => `<th>${m} z ${k}</th>`).join('')}</tr>
        ${vs.map(v => `<tr><td>${v}</td>${TS.GUARANTEES.map(([m, k]) => `<td>${cell[`${v}-${m}-${k}`] || '…'}</td>`).join('')}</tr>`).join('')}</table>
        <p class="hint">W komórce: liczba zakładów, pod nią czas liczenia.</p>`;
    };
    draw();
    for (const [m, k] of TS.GUARANTEES) for (const v of vs) {
      const nums = Array.from({ length: v }, (_, i) => i * 3 + 1), t0 = performance.now();
      try {
        const r = await computeSystem(nums, m, k), s = (performance.now() - t0) / 1000;
        cell[`${v}-${m}-${k}`] = `${r.bets.length}<small>${fmtSecs(s * 1000, true)}</small>`;
        rows.push(`${v};${m}z${k};${s.toFixed(2)};${r.bets.length}`);
      } catch (e) { cell[`${v}-${m}-${k}`] = 'błąd'; rows.push(`${v};${m}z${k};błąd;${e.message}`); }
      draw();
    }
    const text = `Pomiar systemów Typer49 (${os})\n${ua}\nliczb;gwarancja;sekundy;zakładów\n${rows.join('\n')}`;
    $('#benchMsg').textContent = 'Gotowe.';
    const copy = $('#benchCopy'); copy.disabled = false;
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(text); $('#benchMsg').textContent = 'Skopiowano – wklej wyniki w rozmowie z Claude.'; }
      catch { $('#benchMsg').textContent = 'Nie udało się skopiować – zrób zrzut ekranu tabeli.'; }
    };
  }

  // ------------------------------------------------------------------ render: STATYSTYKI
  function renderStats() {
    const st = stats(state.game, state.range);
    $('#statsGameLabel').textContent = GAMES[state.game];
    $$('#rangeChips .chip').forEach(c => c.classList.toggle('active', Number(c.dataset.range) === state.range));
    $$('#heatMode .seg-btn').forEach(c => c.classList.toggle('active', c.dataset.mode === state.heatMode));
    $('#rangeInfo').textContent = st.n ? `Analiza ${st.n} losowań: ${fmtDate(st.from)} – ${fmtDate(st.to)}` : 'Brak danych';

    const vals = state.heatMode === 'freq' ? st.freq : state.heatMode === 'gap' ? st.gap : st.trend;
    const vs = vals.slice(1), mn = Math.min(...vs), mx = Math.max(...vs) || 1;
    $('#heat').innerHTML = RANGE49.map(n => {
      const t = (vals[n] - mn) / ((mx - mn) || 1);
      const hue = state.heatMode === 'gap' ? 200 - t * 30 : 250 - t * 230;   // fiolet→pomarańcz / niebieski
      const bg = `hsla(${hue}, 85%, ${52 - t * 6}%, ${0.18 + t * 0.72})`;
      const lbl = state.heatMode === 'freq' ? vals[n] : state.heatMode === 'gap' ? vals[n] : Math.round(vals[n] * 100);
      return `<button class="cell" data-n="${n}" style="background:${bg}">${n}<small>${lbl}</small></button>`;
    }).join('');

    $('#hotBalls').innerHTML = balls(st.hot.slice(0, 10), 'sm').replace(/^<div class="balls sm">|<\/div>$/g, '');
    $('#coldBalls').innerHTML = balls(st.cold.slice(0, 10), 'sm').replace(/^<div class="balls sm">|<\/div>$/g, '');
    $('#gapBalls').innerHTML = balls(st.overdue.slice(0, 10), 'sm').replace(/^<div class="balls sm">|<\/div>$/g, '');

    const bar = (label, v, tot) => `<div class="bar"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${tot ? (v / Math.max(...(tot.arr))) * 100 : 0}%"></div></div><span>${tot.n ? Math.round(v / tot.n * 100) : 0}%</span></div>`;
    const evT = { arr: st.even, n: st.n };
    $('#evenBars').innerHTML = st.even.map((v, i) => bar(`${i} parz.`, v, evT)).join('');
    const suT = { arr: st.sumCnt, n: st.n };
    $('#sumBars').innerHTML = st.sumBins.map(([a, b], i) => bar(i === 0 ? `< 100` : i === st.sumBins.length - 1 ? `≥ 200` : `${a}–${b}`, st.sumCnt[i], suT)).join('');
    $('#pairs').innerHTML = !hasFeature('pairs')
      ? '<button class="btn" data-goto="premium">👑 Odblokuj w Premium</button>'
      : st.topPairs.map(([a, b, c]) => `<div class="pair">${balls([a, b], 'xs')}<span class="muted">${c}×</span></div>`).join('');
    $('#heatDetail').textContent = 'Dotknij liczby, aby zobaczyć szczegóły.';
  }

  function heatDetail(n) {
    const st = stats(state.game, state.range);
    $$('#heat .cell').forEach(c => c.classList.toggle('sel', Number(c.dataset.n) === n));
    const pct = st.n ? (st.freq[n] / st.n * 100).toFixed(1) : 0;
    const allSt = stats(state.game, 0);
    $('#heatDetail').innerHTML = `<b>${n}</b>: padła ${st.freq[n]}× w ${st.n} losowaniach (${pct}%, średnio ${(600 / 49).toFixed(1)}%) · ` +
      `ostatnio ${st.gap[n] === 0 ? 'w ostatnim losowaniu' : st.gap[n] + ' losowań temu'} · w całej historii ${allSt.freq[n]}× · wskaźnik częstości ${Math.round(st.trend[n] * 100)}/100`;
  }

  // ------------------------------------------------------------------ render: ZAKŁADY
  // Zakłady gościa (zapisane na urządzeniu bez konta) – karta nad listą.
  function guestBetsCard() {
    const g = unmovedGuest(); if (!g.length) return '';
    const n = g.length, nzz = `${n} ${plural(n, 'zakład zapisany', 'zakłady zapisane', 'zakładów zapisanych')}`;
    const risk = 'Zakłady zapisane tylko w przeglądarce mogą zniknąć, np. gdy przeglądarka wyczyści dane strony (zdarza się to zwłaszcza w Safari na iPhonie).';
    if (hasAccount()) {
      if (rk.guestLater) return '';
      return `<div class="card guest-bets">
          <h2>📱 Zakłady z tego urządzenia</h2>
          <p>Na tym urządzeniu masz <b>${nzz}</b> bez konta. Przenieś je na swoje konto, żeby były bezpieczne i widoczne na innych urządzeniach.</p>
          <p class="hint">${risk} Przeniesione zakłady nie liczą się do rankingu (ranking obejmuje tylko zakłady zapisane na koncie przed losowaniem).</p>
          <div class="row-gap">
            <button class="btn primary" id="guestMove">Przenieś na moje konto</button>
            <button class="btn" id="guestExport">⬇️ Pobierz kopię</button>
            <button class="btn" id="guestLater">Nie teraz</button>
          </div>
          <button class="link-btn" id="guestDelete">Usuń je z tego urządzenia</button>
        </div>`;
    }
    const SHOW = 60;
    return `<div class="card guest-bets">
        <h2>📱 Zakłady z tego urządzenia</h2>
        <p>Masz tu <b>${nzz}</b> wcześniej bez konta. Możesz je przeglądać poniżej. Po założeniu darmowego konta lub zalogowaniu zaproponujemy przeniesienie ich na konto. Możesz też pobrać kopię w pliku.</p>
        <p class="hint">${risk}</p>
        <div class="row-gap"><button class="btn" id="guestExport">⬇️ Pobierz kopię</button></div>
      </div>
      ${g.slice().sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, SHOW).map(b => betCard(b, true)).join('')}
      ${n > SHOW ? `<p class="hint" style="text-align:center">Pokazano ${SHOW} z ${n}. Wszystkie są w kopii.</p>` : ''}`;
  }

  function renderBets() {
    const guest = !hasAccount();
    $('#betsGate').innerHTML = guest ? accountGate('bets') + guestBetsCard() : guestBetsCard();
    $('#betsBody').hidden = guest;
    if (guest) return;
    $$('#betFilter .chip').forEach(c => c.classList.toggle('active', c.dataset.f === state.betFilter));
    const list = state.bets.map(b => ({ b, e: evalBet(b) })).filter(({ b, e }) => {
      switch (state.betFilter) {
        case 'pending': return e.status !== 'done';
        case 'done': return e.status === 'done';
        case 'played': return b.played;
        case 'wins': return e.status === 'done' && e.best >= 3;
        default: return true;
      }
    });
    const played = state.bets.filter(b => b.played).length;
    $('#betsSummary').textContent = `${state.bets.length} zakładów · ${played} zagranych`;
    renderBilans();

    if (!list.length) {
      $('#betList').innerHTML = `<div class="card empty">${state.bets.length ? 'Brak zakładów dla tego filtra.' : 'Brak zakładów. Wygeneruj je w zakładce Generator albo zaimportuj ze starego programu (Więcej → Importuj).'}</div>`;
      return;
    }
    const SHOW = 60;
    $('#betList').innerHTML = list.slice(0, SHOW).map(({ b, e }) => betCard(b, false, e)).join('') +
      (list.length > SHOW ? `<p class="hint" style="text-align:center">Pokazano ${SHOW} z ${list.length}. Zawęź filtrem.</p>` : '');
  }

  /** Karta zakładu. readonly = zakład gościa (bez przycisków i pola wygranej). */
  function betCard(b, readonly, e = evalBet(b)) {
      const id = esc(b.id);
      let status, res = '';
      if (e.status === 'pending') status = `<span class="status wait">⏳ oczekuje</span>`;
      else if (e.status === 'waiting') status = `<span class="status wait">⌛ czekam na wyniki</span>`;
      else {
        const cls = e.best >= 5 ? 'big' : e.best >= 3 ? 'win' : '';
        status = `<span class="status ${cls}">${e.best >= 6 ? '🔥 6!' : e.best >= 3 ? '🎉 ' + e.best : e.best} traf.</span>`;
        res = `<div class="bet-res"><span>Lotto: <b>${e.hl.length}</b> ${e.hl.length ? '(' + e.hl.join(', ') + ')' : ''}</span>
          ${b.plus ? `<span>Plus: <b>${e.hp ? e.hp.length : '–'}</b> ${e.hp?.length ? '(' + e.hp.join(', ') + ')' : ''}</span>` : ''}</div>`;
      }
      const hitSet = e.status === 'done' ? new Set([...(e.hl || []), ...(e.hp || [])]) : null;
      return `<div class="card bet${readonly ? ' readonly' : ''}" data-id="${id}">
        <div class="bet-top">
          <div class="bet-info">${METHOD_LABEL[b.method] || esc(b.method)}${b.plus ? ' · z Plusem' : ''}${readonly && b.played ? ' · zagrany' : ''}<br>utworzony ${fmtDT(b.t)} ${PL}<br>losowanie ${dayName(e.date).slice(0, 3)}. ${fmtDate(e.date)}, ${DRAW_HOUR}:00 ${PL}</div>
          ${status}
        </div>
        ${balls(b.nums, 'sm', hitSet)}
        ${res}
        ${readonly ? '' : `${prizeField(b, e)}
        <div class="bet-actions">
          <label class="switch-row"><input type="checkbox" data-played="${id}" ${b.played ? 'checked' : ''}><span class="switch"></span><span>Zagrany</span></label>
          <button class="btn sm" data-again="${id}" title="Zapisz te same liczby na następne losowanie">↻ Ponów</button>
          <button class="btn sm" data-del="${id}" title="Usuń">🗑</button>
        </div>`}
      </div>`;
  }

  // ------------------------------------------------------------------ bilans wydatków (darmowy dla wszystkich)
  const zlInput = v => v.toFixed(2).replace('.', ',').replace(/,00$/, '');

  function prizeField(b, e) {
    if (!b.played || e.status !== 'done' || e.best < 3) return '';
    const sug = TB.suggestedPrize(e.date, e.hl.length, e.hp ? e.hp.length : null);
    const own = b.prize != null;
    const value = own ? zlInput(b.prize) : sug ? zlInput(sug / 100) : '';
    const note = own ? 'kwota wpisana przez Ciebie – wyczyść pole, aby wrócić do podpowiedzi'
      : sug ? `podpowiedź: stała wygrana za trójkę (${TB.fmtZl(sug)}) – możesz ją zmienić`
      : 'wpisz kwotę wygranej – wygrane za 4, 5 i 6 trafień (i w Plusie) są różne w każdym losowaniu';
    return `<div class="prize-row${own || sug ? '' : ' need'}">
        <label>Wygrana <input type="text" inputmode="decimal" autocomplete="off" maxlength="14" data-prize="${b.id}" value="${value}" placeholder="kwota"> zł</label>
        <span class="muted">${note}</span>
      </div>`;
  }

  function bilansEntries() {
    return state.bets.filter(b => b.played).map(b => {
      const e = evalBet(b), done = e.status === 'done';
      return { played: true, plus: !!b.plus, date: e.date, done, prize: b.prize,
        hl: done ? e.hl.length : 0, hp: done && e.hp ? e.hp.length : null };
    });
  }

  function renderBilans() {
    const el = $('#bilans'); if (!el) return;
    const p = state.bilansPeriod;
    const r = TB.summarize(bilansEntries(), p, TT.dateISO(now()));
    const label = { month: 'w tym miesiącu', year: 'w tym roku', all: 'od początku' }[p];
    const notes = [];
    if (r.missing) notes.push(`⚠️ ${r.missing} ${r.missing === 1 ? 'wygrana' : 'wygranych'} bez wpisanej kwoty – uzupełnij przy zakładzie (filtr „Trafione 3+”).`);
    if (r.pending) notes.push(`⏳ ${r.pending} ${r.pending === 1 ? 'zakład czeka' : 'zakładów czeka'} na losowanie – koszt już jest wliczony.`);
    if (r.suggested) notes.push(`ℹ️ ${r.suggested} × stała wygrana za trójkę z podpowiedzi – sprawdź na kuponie.`);
    el.innerHTML = `
      <div class="card-head"><h2>💰 Bilans</h2><span class="muted">${r.count} zagranych ${label}</span></div>
      <div class="seg small" id="bilansPeriod">
        ${[['month', 'Ten miesiąc'], ['year', 'Ten rok'], ['all', 'Od początku']].map(([k, t]) =>
          `<button class="seg-btn${k === p ? ' active' : ''}" data-period="${k}">${t}</button>`).join('')}
      </div>
      <div class="bilans-grid">
        <div><span class="muted">Wydane</span><b>${TB.fmtZl(r.spent)}</b></div>
        <div><span class="muted">Wygrane</span><b>${TB.fmtZl(r.won)}</b></div>
        <div class="${r.balance < 0 ? 'neg' : r.balance > 0 ? 'pos' : ''}"><span class="muted">Bilans</span><b>${TB.fmtZl(r.balance, true)}</b></div>
      </div>
      ${r.count ? '' : '<p class="hint">Liczą się tylko zakłady oznaczone jako „Zagrany”. Zaznacz je przy zakładzie.</p>'}
      ${notes.map(n => `<p class="hint">${n}</p>`).join('')}
      <p class="hint resp">🔞 Gra tylko dla osób pełnoletnich. Graj za kwoty, których stratę możesz zaakceptować – w grach liczbowych na dłuższą metę więcej się wydaje, niż wygrywa. Ceny: Lotto ${TB.fmtZl(TB.betCost(TT.dateISO(now()), false))}, Plus +${TB.fmtZl(TB.betCost(TT.dateISO(now()), true) - TB.betCost(TT.dateISO(now()), false))} (dla starszych zakładów – cena z dnia losowania).</p>`;
  }

  function renderBadge() {
    const n = hasAccount() ? state.bets.filter(b => evalBet(b).status !== 'done').length : 0;
    const el = $('#betsBadge'); el.hidden = !n; el.textContent = n;
  }

  // ------------------------------------------------------------------ sprawdzanie kuponu
  function checkTicket() {
    const p = parseNums($('#checkInput').value);
    if (p.err) { $('#checkResult').innerHTML = `<p class="hint">❌ ${p.err}</p>`; return; }
    const nums = p.nums, set = new Set(nums);
    const block = key => {
      const all = draws(key), last = all.at(-1);
      const cnt = Array(7).fill(0); let best = { h: -1 };
      all.forEach(d => { const h = d.nums.filter(n => set.has(n)).length; cnt[h]++; if (h > best.h || (h === best.h && d.date > best.d.date)) best = { h, d }; });
      const lastHits = last ? last.nums.filter(n => set.has(n)) : [];
      const tot = { arr: cnt.slice(3), n: all.length };
      return `<div class="check-block"><b>${GAMES[key]}</b> – ostatnie losowanie ${last ? fmtDate(last.date) : '–'}: <b>${lastHits.length} trafień</b>
        ${last ? balls(last.nums, 'xs', set) : ''}
        <div class="hint">W całej historii (${all.length} losowań): 3 traf. – ${cnt[3]}×, 4 – ${cnt[4]}×, 5 – ${cnt[5]}×, 6 – ${cnt[6]}×.
        ${best.d ? `Najlepiej: ${best.h} trafień (${fmtDate(best.d.date)}).` : ''}</div></div>`;
    };
    $('#checkResult').innerHTML = `<div style="margin-top:10px">${balls(nums, 'sm')}</div>${block('lotto')}${block('lottoplus')}`;
  }

  // ------------------------------------------------------------------ import / eksport
  function exportBets(bets = state.bets, name = 'lotto-zaklady') {
    const clean = bets.map(({ moved, ...b }) => b);   // eslint-disable-line no-unused-vars
    const payload = JSON.stringify({ app: 'lotto-analizator', v: 2, exported: new Date().toISOString(), bets: clean }, null, 1);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}-${isoDate(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    const msg = `Wyeksportowano ${bets.length} zakładów.`;
    if (bets === state.bets) $('#ioMsg').textContent = msg; else toast(msg);
  }

  // ---- zakłady gościa: przeniesienie na konto (tylko na wyraźne polecenie użytkownika)
  function moveGuestBets() {
    const todo = unmovedGuest(); if (!todo.length) return;
    const have = new Set(state.bets.map(b => b.id));
    const moved = todo.map(TD.toMoved).filter(b => !have.has(b.id));
    state.bets = state.bets.concat(moved).sort((a, b) => b.t.localeCompare(a.t));
    saveBets();
    moved.forEach(b => Cloud.push(b));
    // kopia zostaje na urządzeniu, dopóki konto nie potwierdzi zapisu (confirmGuestMoved)
    const ids = new Set(todo.map(b => b.id));
    guestBets = guestBets.map(b => ids.has(b.id) ? { ...b, moved: true } : b); saveGuest();
    toast(`Przeniesiono ${todo.length} ${plural(todo.length, 'zakład', 'zakłady', 'zakładów')} na konto ✓`);
    renderAll();
    syncNow(true);
  }
  /** Usuwa z urządzenia kopie zakładów gościa, które konto już potwierdziło (są w chmurze). */
  function confirmGuestMoved() {
    if (!guestBets.some(b => b.moved)) return;
    const synced = new Set(state.bets.filter(b => b.synced).map(b => b.id));
    const left = guestBets.filter(b => !(b.moved && synced.has(TD.movedId(b.id))));
    if (left.length !== guestBets.length) { guestBets = left; saveGuest(); }
  }

  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }

  function importOldCSV(text) {
    const rows = parseCSV(text.replace(/^﻿/, ''));
    const head = rows.shift().map(h => h.trim());
    const ix = name => head.indexOf(name);
    const out = [];
    rows.forEach(r => {
      const p = parseNums(r[ix('Liczby')] || '');
      if (p.err) return;
      const ds = (r[ix('Data')] || '').trim();
      const m = ds.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
      const t = m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)).toISOString() : now().toISOString();
      const typ = (r[ix('Typ Gry')] || '').trim();
      const met = (r[ix('Metoda')] || '').toLowerCase().includes('ai') ? 'ai' : 'stat';
      const played = ['tak', 'true'].includes((r[ix('Zagrany')] || '').trim().toLowerCase());
      out.push({ id: uid(), t, nums: p.nums, method: met, base: typ === 'Lotto Plus' ? 'lottoplus' : 'lotto', plus: typ === 'Lotto Plus', played });
    });
    return out;
  }

  async function importFile(file) {
    const text = await file.text();
    let incoming = [];
    try {
      if (/^\s*[{[]/.test(text)) {
        const j = JSON.parse(text);
        incoming = (Array.isArray(j) ? j : j.bets || []).filter(b => Array.isArray(b.nums) && b.nums.length === 6 && b.t)
          .map(b => ({ id: b.id || uid(), t: b.t, nums: b.nums.map(Number).sort((x, y) => x - y), method: b.method || 'import', base: b.base || 'lotto', plus: !!b.plus, played: !!b.played,
            ...(b.prize != null && !Number.isNaN(TB.parsePrize(b.prize)) ? { prize: TB.parsePrize(b.prize) } : {}) }));
      } else incoming = importOldCSV(text);
    } catch (e) { $('#ioMsg').textContent = '❌ Nie rozpoznano pliku: ' + e.message; return; }
    const keys = new Set(state.bets.map(b => b.id)), sig = new Set(state.bets.map(b => b.t.slice(0, 16) + b.nums.join(',')));
    let added = 0;
    incoming.forEach(b => {
      const s = b.t.slice(0, 16) + b.nums.join(',');
      if (keys.has(b.id) || sig.has(s)) {
        const ex = state.bets.find(x => x.id === b.id || x.t.slice(0, 16) + x.nums.join(',') === s);
        if (ex && b.played) ex.played = true;
        if (ex && b.prize != null && ex.prize == null) { ex.prize = b.prize; Cloud.push(ex); }
        return;
      }
      state.bets.push(b); keys.add(b.id); sig.add(s); added++;
      Cloud.push(b);
    });
    state.bets.sort((a, b) => b.t.localeCompare(a.t));
    saveBets(); renderAll();
    $('#ioMsg').textContent = `✓ Zaimportowano ${added} nowych zakładów (pominięto ${incoming.length - added} duplikatów).`;
  }

  async function shareBets() {
    const pend = state.bets.filter(b => evalBet(b).status !== 'done');
    const text = (pend.length ? pend : state.bets.slice(0, 10)).map(b => b.nums.join(' ')).join('\n');
    if (!text) { toast('Brak zakładów do udostępnienia'); return; }
    try {
      if (navigator.share) await navigator.share({ title: 'Moje zakłady Lotto', text });
      else { await navigator.clipboard.writeText(text); toast('Skopiowano do schowka'); }
    } catch { /* anulowano */ }
  }

  // ------------------------------------------------------------------ ręczne wyniki
  function addManualDraw() {
    const key = $('#manGame').value, date = $('#manDate').value, p = parseNums($('#manNums').value), msg = $('#manMsg');
    if (!date) { msg.textContent = '❌ Wybierz datę losowania.'; return; }
    if (p.err) { msg.textContent = '❌ ' + p.err; return; }
    if (drawByDate(key, date)) { msg.textContent = 'To losowanie jest już w bazie.'; return; }
    (state.manual[key] = state.manual[key] || []).push({ date, nums: p.nums });
    store.set('lotto2.manual', state.manual); state.statsCache = {};
    msg.textContent = `✓ Dodano ${GAMES[key]} ${fmtDate(date)}: ${p.nums.join(', ')}`;
    $('#manNums').value = ''; renderAll();
  }

  // ------------------------------------------------------------------ konto i synchronizacja
  const acct = { mode: 'login', recovery: false, profile: null, syncInfo: null, busy: false };

  function setAcctMsg(text, ok = false) {
    const el = $('#acctMsg'); if (!el) return;
    el.textContent = text || ''; el.className = 'acct-msg' + (text ? (ok ? ' ok' : ' err') : '');
  }

  function renderAccountButton() {
    const b = $('#accountBtn'); if (!b) return;
    const u = previewGuest() ? null : Cloud.user;
    b.hidden = !Cloud.enabled && !hasAccount();
    b.classList.toggle('on', hasAccount());
    b.title = u ? `Konto: ${u.email}` : hasAccount() ? 'Konto (bez połączenia)' : 'Zaloguj się';
  }

  function syncLabel() {
    const s = acct.syncInfo;
    if (!s) return '';
    if (!s.user) return s.pending ? `📴 ${s.pending} zmian czeka na wysłanie` : '';
    if (s.online === false) return `📴 Offline – ${s.pending} zmian czeka na wysłanie`;
    if (s.pending) return `⏳ Wysyłanie zmian (${s.pending})…`;
    return s.lastSync ? `✓ Zsynchronizowano ${TT.formatTime(s.lastSync)} ${PL}` : '✓ Połączono';
  }

  function renderAccount() {
    const el = $('#accountBody');
    const u = previewGuest() ? null : Cloud.user;
    if (!u && hasAccount()) {
      // zalogowany na tym urządzeniu, ale bez połączenia z serwerem kont (np. offline) – zakłady działają dalej
      el.innerHTML = `
        <h2>Konto</h2>
        <p class="hint">Jesteś zalogowany na tym urządzeniu, ale teraz nie możemy połączyć się z serwerem kont (np. brak internetu). Twoje zakłady są dostępne, a zmiany wyślemy, gdy połączenie wróci.</p>
        <p class="sync-line" id="syncLine">${syncLabel()}</p>
        <div class="row-gap" style="margin-top:12px"><button class="btn" id="logoutBtn">Wyloguj</button></div>
        <p id="acctMsg" class="acct-msg"></p>`;
      return;
    }
    if (!Cloud.enabled) {
      el.innerHTML = '<h2>Konto</h2><p class="hint">Logowanie chwilowo nie działa (brak połączenia z serwerem kont). Spróbuj później – statystyki, generator i sprawdzanie kuponu działają normalnie.</p>';
      return;
    }
    if (acct.recovery && u) {
      el.innerHTML = `
        <h2>Ustaw nowe hasło</h2>
        <form id="pwForm" class="form">
          <input class="input" type="password" name="pw" autocomplete="new-password" placeholder="Nowe hasło (min. 8 znaków)" required minlength="8">
          <button class="btn primary big">Zapisz hasło</button>
        </form><p id="acctMsg" class="acct-msg"></p>`;
      return;
    }
    if (u) {
      const nick = acct.profile?.nick || '';
      el.innerHTML = `
        <div class="acct-head">
          <div class="avatar">${esc((nick || u.email || '?')[0].toUpperCase())}</div>
          <div><b>${esc(nick || 'Bez pseudonimu')}</b><div class="muted">${esc(u.email)}</div></div>
        </div>
        <p class="sync-line" id="syncLine">${syncLabel()}</p>
        <p class="sync-line">Plan: <b>${isPremium() ? '👑 Premium' : 'Darmowy'}</b>${beta() ? ' (darmowy w okresie testów)' : ''}${previewFree() ? ' (podgląd jako użytkownik darmowy)' : ''} · <a href="#premium">szczegóły</a></p>
        <p class="hint">Twoje zakłady (${state.bets.length}) są zapisane na koncie i widoczne na każdym urządzeniu, na którym się zalogujesz.</p>
        <button class="btn" id="syncNow">🔄 Synchronizuj teraz</button>

        <h3 style="margin-top:20px">Pseudonim</h3>
        <p class="hint">Widoczny w rankingu graczy i w Twoich grupach. Nie podawaj imienia i nazwiska.</p>
        <form id="nickForm" class="row-gap">
          <input class="input" name="nick" maxlength="20" placeholder="np. SzczęśliwaSiódemka" value="${esc(nick)}">
          <button class="btn primary">Zapisz</button>
        </form>
        <p id="acctMsg" class="acct-msg"></p>

        <div class="row-gap" style="margin-top:18px">
          <button class="btn" id="logoutBtn">Wyloguj</button>
          <button class="btn" id="changePwBtn">Zmień hasło</button>
        </div>
        <details class="danger-zone"><summary>Usuń konto</summary>
          <p class="hint">Trwale usuwa konto i wszystkie zakłady z chmury. Tego nie da się cofnąć. Wpisz <b>USUŃ</b>, aby potwierdzić.</p>
          <div class="row-gap"><input class="input" id="delConfirm" placeholder="USUŃ"><button class="btn danger" id="delAccBtn">Usuń konto</button></div>
        </details>`;
      return;
    }
    const reg = acct.mode === 'register', reset = acct.mode === 'reset';
    const pend = TD.pendingSets(store.get(PENDING_SAVE, null), now().getTime());
    const join = TD.pendingJoin(store.get(PENDING_JOIN, null), now().getTime());
    const waiting = [
      pend ? `💾 ${pend.length === 1 ? 'Twój zestaw czeka' : `Twoje zestawy (${pend.length}) czekają`} – ${pend.length === 1 ? 'zapisze się sam' : 'zapiszą się same'} po zalogowaniu (najwyżej 7 dni).` : '',
      join ? '👥 Po zalogowaniu automatycznie dołączysz do grupy z zaproszenia.' : '',
      previewGuest() ? '👁 Podgląd jako gość – logowanie jest tu wyłączone.' : '',
    ].filter(Boolean);
    const iosNote = reg && isIOS() && standalone()
      ? '<p class="hint">📱 Na iPhonie link z e-maila otworzy się w Safari. Po potwierdzeniu wróć do tej aplikacji i zaloguj się tutaj' + (pend || join ? ' – wtedy zapisze się czekający zestaw i dołączysz do grupy.' : '.') + '</p>' : '';
    el.innerHTML = `
      ${waiting.map(t => `<div class="alert ok">${t}</div>`).join('')}
      <div class="seg" id="acctTabs" style="margin-bottom:14px">
        <button class="seg-btn ${!reg && !reset ? 'active' : ''}" data-mode="login">Logowanie</button>
        <button class="seg-btn ${reg ? 'active' : ''}" data-mode="register">Nowe konto</button>
      </div>
      <p class="hint">${reset ? 'Podaj e-mail – wyślemy link do ustawienia nowego hasła.'
        : reg ? 'Konto jest darmowe. Potrzebne jest do zapisywania zakładów: są wtedy bezpieczne, widoczne na telefonie i komputerze, a aplikacja sama sprawdza je po losowaniu.'
        : 'Zaloguj się, aby zapisywać zakłady i mieć je na wszystkich urządzeniach.'}</p>
      <form id="authForm" class="form">
        <input class="input" type="email" name="email" autocomplete="email" placeholder="Adres e-mail" required>
        ${reset ? '' : `<input class="input" type="password" name="pw" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="Hasło${reg ? ' (min. 8 znaków)' : ''}" required minlength="${reg ? 8 : 1}">`}
        ${reg ? `<label class="check-row"><input type="checkbox" name="terms" required> <span>Mam ukończone 18 lat i akceptuję <a href="privacy.html" target="_blank">zasady prywatności</a>.</span></label>` : ''}
        <button class="btn primary big">${reset ? 'Wyślij link' : reg ? 'Załóż konto' : 'Zaloguj się'}</button>
      </form>
      <p id="acctMsg" class="acct-msg"></p>
      ${reg ? '' : `<button class="link-btn" id="resetLink">${reset ? '← Wróć do logowania' : 'Nie pamiętasz hasła?'}</button>`}
      ${iosNote}
      ${unmovedGuest().length ? `<p class="hint">Masz ${unmovedGuest().length} ${plural(unmovedGuest().length, 'zakład zapisany', 'zakłady zapisane', 'zakładów zapisanych')} na tym urządzeniu bez konta – po zalogowaniu zaproponujemy przeniesienie ich na konto.</p>` : ''}`;
  }

  async function withBusy(btn, fn) {
    if (acct.busy) return; acct.busy = true;
    const label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Chwileczkę…'; }
    try { await fn(); }
    catch (e) { setAcctMsg(e.message || String(e)); }
    finally { acct.busy = false; if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  }

  async function syncNow(silent = true) {
    if (!Cloud.user) return;
    try {
      const merged = await Cloud.fullSync(state.bets);
      if (merged) { state.bets = merged; saveBets(); confirmGuestMoved(); renderAll(); }
      if (!silent) toast('Zsynchronizowano ✓');
    } catch (e) { if (!silent) toast(e.message); }
  }

  async function onAuth(user, event) {
    renderAccountButton();
    if (user) {
      Cloud.getProfile().then(p => {
        acct.profile = p; decoratePremium();
        if (state.view === 'account') renderAccount();
        if (state.view === 'rank') renderPublicCard();
      }).catch(() => {});
      loadGroups().then(() => { if (state.view === 'rank') renderRank(); });
      const join = TD.pendingJoin(store.get(PENDING_JOIN, null), now().getTime());
      localStorage.removeItem(PENDING_JOIN);
      if (join) tryJoin(join);
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        // Zakłady gościa nie trafiają na konto automatycznie – leżą osobno (guestBets), przeniesienie tylko przyciskiem.
        const owner = store.get(OWNER_KEY, null);
        if (owner && owner !== user.id) { state.bets = []; saveBets(); }   // zakłady innej osoby z tego urządzenia
        store.set(OWNER_KEY, user.id);
        await syncNow(true);
        const hadPending = !!store.get(PENDING_SAVE, null);
        applyPendingSave();
        if (event === 'SIGNED_IN' && state.view === 'account' && !acct.recovery) {
          toast('Zalogowano ✓');
          if ((hadPending && !store.get(PENDING_SAVE, null)) || unmovedGuest().length) setView('bets');
        }
      }
    } else {
      // wylogowanie: usuń dane konta z urządzenia (prywatność na wspólnych urządzeniach).
      // Zakłady gościa zostają; te, których przeniesienia konto jeszcze nie potwierdziło, wracają na listę gościa.
      if (store.get(OWNER_KEY, null)) { state.bets = []; saveBets(); store.set(OWNER_KEY, null); }
      if (guestBets.some(b => b.moved)) { guestBets = guestBets.map(({ moved, ...b }) => b); saveGuest(); }   // eslint-disable-line no-unused-vars
      acct.profile = null; acct.recovery = false; rk.groups = []; rk.group = null; rk.guestLater = false;
      renderAll();
    }
    if (state.view === 'account') renderAccount();
    syncPush(event).then(() => { if (state.view === 'more') renderPush(); });
  }

  function bindAccount() {
    $('#accountBtn').addEventListener('click', () => setView('account'));
    const body = $('#accountBody');
    body.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('#acctTabs .seg-btn')) { acct.mode = t.closest('.seg-btn').dataset.mode; renderAccount(); }
      if (t.id === 'resetLink') { acct.mode = acct.mode === 'reset' ? 'login' : 'reset'; renderAccount(); }
      if (t.id === 'syncNow') withBusy(t, () => syncNow(false));
      if (t.id === 'changePwBtn') { acct.recovery = true; renderAccount(); }
      if (t.id === 'logoutBtn') withBusy(t, async () => {
        if (Cloud.pending() && !confirm('Część zmian nie została jeszcze wysłana (brak internetu). Wylogować mimo to?')) return;
        await Cloud.signOut();
        if (store.get(OWNER_KEY, null)) onAuth(null, 'SIGNED_OUT');   // gdy biblioteka nie miała sesji (offline)
        toast('Wylogowano');
      });
      if (t.id === 'delAccBtn') withBusy(t, async () => {
        if ($('#delConfirm').value.trim().toUpperCase() !== 'USUŃ') { setAcctMsg('Wpisz USUŃ, aby potwierdzić.'); return; }
        await Cloud.deleteAccount(); store.set('typer.pushWanted', null); toast('Konto zostało usunięte');
      });
    });
    body.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('button');
      setAcctMsg('');
      if (f.id === 'authForm' && previewGuest()) { setAcctMsg('Podgląd jako gość – logowanie jest wyłączone. Wyłącz podgląd na niebieskim pasku.'); return; }
      if (f.id === 'authForm') withBusy(btn, async () => {
        const email = f.email.value.trim();
        if (acct.mode === 'reset') { await Cloud.resetPassword(email); setAcctMsg('Wysłaliśmy link na ' + email + '. Sprawdź pocztę (także spam).', true); return; }
        if (acct.mode === 'register') {
          const r = await Cloud.signUp(email, f.pw.value);
          if (r.needsConfirm) setAcctMsg('Prawie gotowe! Kliknij link aktywacyjny wysłany na ' + email + ', a potem zaloguj się tutaj.', true);
          return;
        }
        await Cloud.signIn(email, f.pw.value);
      });
      if (f.id === 'pwForm') withBusy(btn, async () => {
        await Cloud.updatePassword(f.pw.value); acct.recovery = false; renderAccount(); setAcctMsg('Hasło zostało zmienione ✓', true);
      });
      if (f.id === 'nickForm') withBusy(btn, async () => {
        const nick = f.nick.value.trim();
        await Cloud.setNick(nick); acct.profile = { ...(acct.profile || {}), nick }; renderAccount(); setAcctMsg('Zapisano pseudonim ✓', true);
      });
    });
  }

  // ------------------------------------------------------------------ Premium
  const CFG = window.APP_CONFIG || {};
  const LIMITS = CFG.freeLimits || { pendingBets: 10, setsPerClick: 3 };
  // ---- poziomy planu i dostęp do funkcji (config.js: tiers, featureTiers)
  // Podgląd właściciela: adres z ?jako=darmowy → TYLKO na tym urządzeniu aplikacja działa jak dla
  // użytkownika darmowego po okresie testów (betaAllPremium wyłączone). ?jako=normalnie wyłącza podgląd.
  // Nic nie trafia do bazy i nie zmienia się u innych użytkowników.
  // Pomiar szybkości systemów: ?pomiar=systemy (tylko liczy, nic nie zapisuje).
  const VIEW_KEY = 'typer.viewAs';
  let BENCH = false;
  try {
    const qs = new URLSearchParams(location.search), q = qs.get('jako');
    BENCH = qs.get('pomiar') === 'systemy';
    if (q === 'darmowy') store.set(VIEW_KEY, 'free');
    else if (q === 'gosc' || q === 'gość') store.set(VIEW_KEY, 'guest');   // podgląd jako osoba bez konta
    else if (q === 'normalnie') localStorage.removeItem(VIEW_KEY);
    if (q || BENCH) history.replaceState(null, '', location.pathname + location.hash);
  } catch { /* brak dostępu do localStorage – podgląd po prostu nie działa */ }
  const previewFree = () => store.get(VIEW_KEY, null) === 'free';
  const beta = () => !!CFG.betaAllPremium && !previewFree();
  const TIERS = Array.isArray(CFG.tiers) && CFG.tiers.length ? CFG.tiers : ['free', 'premium'];
  const FEATURE_TIER = CFG.featureTiers || {};
  const TIER_NAME = { premium: 'Premium', premium_plus: 'Premium Plus' };
  const tierName = t => TIER_NAME[t] || t;
  const tierLevel = t => Math.max(0, TIERS.indexOf(t));
  function userTier() {
    if (previewFree()) return TIERS[0];
    if (CFG.betaAllPremium) return TIERS[TIERS.length - 1];
    const p = acct.profile;
    if (!p || !TIERS.includes(p.plan)) return TIERS[0];
    if (p.premium_until && new Date(p.premium_until) <= new Date()) return TIERS[0];
    return p.plan;
  }
  /** Czy użytkownik ma funkcję (jej poziom z featureTiers ≤ poziom użytkownika). */
  function hasFeature(f) { return tierLevel(userTier()) >= tierLevel(FEATURE_TIER[f] || TIERS[0]); }
  function isPremium() { return tierLevel(userTier()) > 0; }
  function requireFeature(f, what) {
    if (hasFeature(f)) return true;
    toast(`👑 ${what} – funkcja ${tierName(FEATURE_TIER[f])}`);
    setView('premium');
    return false;
  }
  function renderPreviewBar() {
    const el = $('#previewBar'); if (!el) return;
    el.hidden = !previewFree() && !previewGuest();
    const who = $('#previewWho'); if (who) who.textContent = previewGuest() ? 'gość (bez konta)' : 'użytkownik darmowy';
  }
  function decoratePremium() {
    $$('[data-premium]').forEach(el => {
      if (!el.querySelector('.crown')) el.insertAdjacentHTML('beforeend', '<span class="crown" title="Premium">👑</span>');
    });
    const t = $('#premiumTeaser');
    if (t) t.textContent = beta() ? 'W okresie testów wszystko za darmo 🎉' : isPremium() ? 'Masz aktywne Premium ✓' : 'Sprawdź, co zyskujesz';
  }
  const PREMIUM_FEATURES = [
    ['Wyniki, odliczanie, sprawdzanie kuponów', '✓', '✓'],
    ['Ranking globalny i grupy znajomych', '✓', '✓'],
    ['Synchronizacja między urządzeniami', '✓', '✓'],
    ['Zestawy z generatora na raz', 'do 3', 'do 10'],
    ['Aktywne (oczekujące) zakłady', 'do 10', 'bez limitu'],
    ['Ważona częstość', '–', '✓'],
    ['Statystyki z 250 / 500 / wszystkich losowań', '–', '✓'],
    ['Mapa ważonej częstości, najczęstsze pary', '–', '✓'],
    ['Powiadomienia po losowaniu', '✓', '✓'],
    ['Bilans wydatków (odpowiedzialna gra)', '✓', '✓'],
    ['Systemy skrócone (7–15 liczb; określona liczba trafień tylko wtedy, gdy wylosowane liczby są wśród wybranych)', '–', '✓'],
    ['Bez reklam (gdy pojawią się reklamy)', '–', '✓'],
  ];
  function renderPremium() {
    const prem = isPremium();
    $('#premiumBody').innerHTML = `
      <h2>👑 Typer49 Premium</h2>
      ${beta()
        ? '<div class="alert ok">🎉 Trwają testy aplikacji – <b>wszystkie funkcje Premium są teraz darmowe</b> dla każdego. Płatna subskrypcja pojawi się po zakończeniu testów.</div>'
        : prem ? '<div class="alert ok">✓ Masz aktywne Premium. Dziękujemy!</div>' : ''}
      <table class="plan-table">
        <tr><th></th><th>Darmowy</th><th>Premium</th></tr>
        ${PREMIUM_FEATURES.map(([f, a, b]) => `<tr><td>${f}</td><td>${a}</td><td><b>${b}</b></td></tr>`).join('')}
      </table>
      ${prem ? '' : '<button class="btn primary big" disabled>Kup Premium – wkrótce</button>'}
      <p class="hint">Premium nie zwiększa szans wygranej – daje wygodniejsze narzędzia i wspiera rozwój aplikacji.</p>`;
  }
  function pendingCount() { return state.bets.filter(b => evalBet(b).status !== 'done').length; }
  function canAddBets(n = 1) {
    if (hasFeature('unlimitedBets') || pendingCount() + n <= LIMITS.pendingBets) return true;
    requireFeature('unlimitedBets', `Limit ${LIMITS.pendingBets} oczekujących zakładów`);
    return false;
  }

  // ------------------------------------------------------------------ ranking i grupy
  const rk = { scope: 'global', period: 'month', group: null, groups: [], loading: false, guestLater: false };
  const fmtAvg = v => Number(v || 0).toFixed(2).replace('.', ',');

  function setGroupMsg(t, ok = false) { const el = $('#groupMsg'); el.textContent = t || ''; el.className = 'acct-msg' + (t ? (ok ? ' ok' : ' err') : ''); }

  async function loadGroups() {
    try { rk.groups = await Cloud.myGroups() || []; } catch (e) { rk.groups = []; setGroupMsg(e.message); }
    if (rk.group && !rk.groups.some(g => g.id === rk.group)) rk.group = null;
    if (!rk.group && rk.groups.length) rk.group = rk.groups[0].id;
  }

  function renderGroups() {
    const sel = $('#rankGroup');
    sel.innerHTML = rk.groups.map(g => `<option value="${g.id}" ${g.id === rk.group ? 'selected' : ''}>${esc(g.name)} (${g.members})</option>`).join('');
    sel.hidden = rk.scope !== 'group' || !rk.groups.length;
    $('#groupList').innerHTML = rk.groups.length ? rk.groups.map(g => `
      <div class="group-item">
        <div><b>${esc(g.name)}</b> ${g.is_owner ? '<span class="pill">Twoja</span>' : ''}
          <div class="muted">${g.members} ${g.members === 1 ? 'osoba' : g.members < 5 ? 'osoby' : 'osób'} · kod <span class="code">${esc(g.invite_code)}</span></div></div>
        <div class="row-gap" style="margin:0">
          <button class="btn sm" data-ginvite="${g.id}">📤 Zaproś</button>
          ${g.is_owner ? `<button class="btn sm" data-gdel="${g.id}">🗑</button>` : `<button class="btn sm" data-gleave="${g.id}">Opuść</button>`}
        </div>
      </div>`).join('') : '<p class="muted">Nie należysz jeszcze do żadnej grupy.</p>';
  }

  function renderPublicCard() {
    const p = acct.profile || {};
    const el = $('#publicCard');
    el.innerHTML = `
      <h3>Widoczność w rankingu globalnym</h3>
      ${p.nick ? '' : '<p class="hint">Aby pojawić się w rankingu, ustaw najpierw <a href="#account">pseudonim w ustawieniach konta</a>.</p>'}
      <label class="switch-row ${p.nick ? '' : 'locked'}">
        <input type="checkbox" id="publicToggle" ${p.public_ranking ? 'checked' : ''} ${p.nick ? '' : 'disabled'}>
        <span class="switch"></span>
        <span>Pokazuj mnie w rankingu jako <b>${esc(p.nick || '—')}</b></span>
      </label>
      <p class="hint">W rankingu widać tylko pseudonim i statystyki – nigdy Twoje liczby ani e-mail. W grupach znajomi widzą Cię zawsze.</p>`;
  }

  async function renderRank() {
    const gate = $('#rankGate'), body = $('#rankBody');
    if (!hasAccount()) { body.hidden = true; gate.innerHTML = accountGate('rank'); return; }
    if (!Cloud.user) {
      body.hidden = true;
      gate.innerHTML = `<div class="card empty"><h2>🏆 Ranking graczy</h2><p class="hint">Ranking potrzebuje połączenia z internetem. Spróbuj ponownie, gdy połączenie wróci.</p></div>`;
      return;
    }
    gate.innerHTML = ''; body.hidden = false;
    $$('#rankScope .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.scope === rk.scope));
    $$('#rankPeriod .chip').forEach(c => c.classList.toggle('active', c.dataset.p === rk.period));
    renderPublicCard();
    renderGroups();
    await loadGroups();     // odśwież listę grup przy każdym wejściu (ktoś mógł usunąć grupę)
    renderGroups();
    await loadRanking();
  }

  async function loadRanking() {
    const list = $('#rankList'), my = $('#myStats');
    if (rk.scope === 'group' && !rk.group) {
      list.innerHTML = '<p class="muted">Załóż grupę albo dołącz do niej kodem (niżej), aby zobaczyć ranking grupy.</p>';
      my.innerHTML = ''; return;
    }
    list.innerHTML = '<p class="muted">Ładowanie…</p>';
    try {
      const [rows, s] = await Promise.all([Cloud.ranking(rk.period, rk.scope === 'group' ? rk.group : null), Cloud.myStats(rk.period)]);
      my.innerHTML = [
        [s.bets || 0, 'rozliczone'], [fmtAvg(s.avg_hits), 'śr. trafień'], [s.best || 0, 'najlepszy'], [s.hits3 || 0, 'trafione 3+'],
      ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
      list.innerHTML = rows && rows.length ? rows.map(r => `
        <div class="rank-row ${r.is_me ? 'me' : ''}">
          <div class="rank-pos">${r.pos <= 3 ? ['🥇', '🥈', '🥉'][r.pos - 1] : r.pos}</div>
          <div class="rank-nick">${esc(r.nick)}${r.is_me ? ' (Ty)' : ''}<small>${r.bets} zakł. · najlepszy ${r.best} · 3+: ${r.hits3}×</small></div>
          <div class="rank-score">${fmtAvg(r.avg_hits)}<small>śr. traf.</small></div>
        </div>`).join('')
        : `<p class="muted">${rk.scope === 'group' ? 'W tej grupie nie ma jeszcze rozliczonych zakładów.' : 'Ranking jest jeszcze pusty – bądź pierwszy! Potrzeba min. 3 rozliczonych zakładów i włączonej widoczności.'}</p>`;
    } catch (e) { list.innerHTML = `<p class="acct-msg err">${esc(e.message)}</p>`; }
  }

  async function tryJoin(code) {
    try {
      const gid = await Cloud.joinGroup(code);
      await loadGroups(); rk.group = gid; rk.scope = 'group';
      toast('Dołączono do grupy ✓');
      if (state.view === 'rank') renderRank(); else setView('rank');
    } catch (e) { toast(e.message); setGroupMsg(e.message); }
  }

  async function shareInvite(g) {
    const url = `${location.origin}${location.pathname}#join=${g.invite_code}`;
    const text = `Dołącz do mojej grupy „${g.name}” w Typer49 i porównajmy wyniki! Kod: ${g.invite_code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Typer49 – zaproszenie', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Skopiowano zaproszenie do schowka'); }
    } catch { /* anulowano */ }
  }

  function bindRank() {
    $('#rankScope').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b) return; rk.scope = b.dataset.scope; renderRank(); });
    $('#rankPeriod').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; rk.period = c.dataset.p; $$('#rankPeriod .chip').forEach(x => x.classList.toggle('active', x === c)); loadRanking(); });
    $('#rankGroup').addEventListener('change', e => { rk.group = e.target.value; loadRanking(); });
    $('#publicCard').addEventListener('change', async e => {
      if (e.target.id !== 'publicToggle') return;
      const on = e.target.checked;
      try { await Cloud.setPublicRanking(on); acct.profile = { ...(acct.profile || {}), public_ranking: on }; toast(on ? 'Jesteś widoczny w rankingu ✓' : 'Ukryto Cię w rankingu'); loadRanking(); }
      catch (err) { e.target.checked = !on; toast(err.message); }
    });
    $('#groupCreate').addEventListener('submit', async e => {
      e.preventDefault(); const name = e.target.name.value.trim(); setGroupMsg('');
      if (name.length < 3) { setGroupMsg('Nazwa grupy: min. 3 znaki.'); return; }
      try { const gid = await Cloud.createGroup(name); e.target.reset(); await loadGroups(); rk.group = gid; rk.scope = 'group'; renderRank(); setGroupMsg('Grupa założona ✓ Kliknij „Zaproś”, aby wysłać link znajomym.', true); }
      catch (err) { setGroupMsg(err.message); }
    });
    $('#groupJoin').addEventListener('submit', async e => {
      e.preventDefault(); const code = e.target.code.value.trim(); setGroupMsg('');
      if (!code) return; await tryJoin(code); e.target.reset();
    });
    $('#groupList').addEventListener('click', async e => {
      const inv = e.target.closest('[data-ginvite]'), del = e.target.closest('[data-gdel]'), lv = e.target.closest('[data-gleave]');
      const g = rk.groups.find(x => x.id === (inv || del || lv)?.dataset[inv ? 'ginvite' : del ? 'gdel' : 'gleave']);
      if (!g) return;
      try {
        if (inv) await shareInvite(g);
        if (del && confirm(`Usunąć grupę „${g.name}” dla wszystkich ${g.members} członków?`)) { await Cloud.deleteGroup(g.id); await loadGroups(); renderRank(); toast('Grupa usunięta'); }
        if (lv && confirm(`Opuścić grupę „${g.name}”?`)) { await Cloud.leaveGroup(g.id); await loadGroups(); renderRank(); toast('Opuszczono grupę'); }
      } catch (err) { setGroupMsg(err.message); }
    });
  }

  // link zaproszenia: #join=KOD
  function checkJoinLink() {
    const m = location.hash.match(/^#join=([A-Za-z0-9]{4,12})$/);
    if (!m) return false;
    history.replaceState(null, '', '#rank');
    if (Cloud.user && !previewGuest()) { tryJoin(m[1]); return true; }
    if (previewGuest()) { toast('Podgląd jako gość: tu gość przeszedłby do logowania, a potem do grupy'); openAuth('login'); return true; }
    // kod czeka na urządzeniu (także po przeładowaniu strony, np. po potwierdzeniu e-maila) najwyżej 7 dni
    store.set(PENDING_JOIN, { code: m[1], at: now().toISOString() });
    if (hasAccount()) { toast('Dołączysz do grupy, gdy połączenie z internetem wróci'); setView('rank'); return true; }
    toast('Zaloguj się lub załóż darmowe konto – potem dołączysz do grupy');
    openAuth('login');
    return true;
  }

  // ------------------------------------------------------------------ powiadomienia (Etap 4, krok 3)
  // Tylko dla zalogowanych, darmowe. Adres urządzenia zapisuje push_subscribe() w bazie; treść układa funkcja Supabase.
  const TP = window.TyperPush;
  const PUSH_HIDE = 'typer.pushHide';     // „Ukryj szczegóły na zablokowanym ekranie” (kopia ustawienia z bazy)
  const PUSH_SAVED = 'typer.pushSaved';   // {user, day, ep} – adres odświeżany w bazie najwyżej raz dziennie
  const PUSH_WANTED = 'typer.pushWanted'; // id konta, które włączyło powiadomienia na tym urządzeniu (wylogowanie go nie kasuje)
  const pn = { sub: null, busy: false, msg: '', ok: false, retry: false };

  const pushMark = sub => store.set(PUSH_SAVED, { user: Cloud.user?.id, day: isoDate(now()), ep: sub.endpoint.slice(-24) });

  // Przy starcie i logowaniu: adres tego urządzenia należy do zalogowanej osoby i jest świeży.
  async function syncPush(event) {
    if (!TP || !Cloud.enabled) return;
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { pn.msg = ''; pn.retry = false; }   // komunikat dotyczył poprzedniej sesji
    pn.sub = await TP.current();
    if (!pn.sub && Cloud.user && TP.autoEnable({ wanted: store.get(PUSH_WANTED, null), userId: Cloud.user.id,
        permission: TP.permission(), support: TP.state(), hasSub: false, online: navigator.onLine })) {
      // to konto włączyło powiadomienia na tym urządzeniu, a wylogowanie je wyłączyło – włącz z powrotem bez pytania
      let sub = null;
      try {
        sub = await TP.subscribeGranted(CFG.vapidPublicKey);
        if (!sub) throw new Error('brak adresu');
        await Cloud.pushSave(sub, store.get(PUSH_HIDE, false));
        pn.sub = sub; pushMark(sub);
      } catch {
        if (sub) await TP.unsubscribeLocal().catch(() => {});
        pn.sub = null; pn.retry = true;   // np. Safari wymaga stuknięcia – przełącznik zostaje wyłączony z podpowiedzią
      }
      return;
    }
    if (!pn.sub) return;
    if (!Cloud.user) {
      // nikt nie jest zalogowany (np. wylogowanie albo wygasła sesja) – urządzenie nie może dostawać cudzych wyników;
      // bez internetu nie ruszamy (sesja mogła się po prostu nie odświeżyć)
      if (event === 'SIGNED_OUT' || navigator.onLine) { await TP.unsubscribeLocal(); pn.sub = null; }
      return;
    }
    store.set(PUSH_WANTED, Cloud.user.id);   // powiadomienia działają na tym koncie – zapamiętaj (także dla włączonych przed tą wersją)
    const s = store.get(PUSH_SAVED, null);
    if (s && s.user === Cloud.user.id && s.day === isoDate(now()) && s.ep === pn.sub.endpoint.slice(-24)) return;
    try { await Cloud.pushSave(pn.sub, store.get(PUSH_HIDE, false)); pushMark(pn.sub); } catch { /* spróbujemy przy następnym otwarciu */ }
  }

  const PUSH_BLOCKED = {
    android: 'Chrome: stuknij ikonę obok adresu strony → Uprawnienia → Powiadomienia → Zezwalaj. Zainstalowana aplikacja: przytrzymaj ikonę Typer49 → Informacje o aplikacji → Powiadomienia.',
    ios: 'Ustawienia → Powiadomienia → Typer49 → Zezwalaj na powiadomienia.',
    other: 'Kliknij ikonę kłódki obok adresu strony i zezwól na powiadomienia.',
  };

  function renderPush() {
    const el = $('#pushBody'); if (!el) return;
    const st = TP ? TP.state() : 'unsupported';
    const msg = pn.msg ? `<p class="acct-msg ${pn.ok ? 'ok' : 'err'}">${esc(pn.msg)}</p>` : '';
    const intro = `<p class="hint">Gdy masz zakład na losowanie we wtorek, czwartek lub sobotę o 22:00 ${PL}, po pojawieniu się wyników – zwykle w ciągu godziny – dostaniesz powiadomienie, że Twoje zakłady są rozliczone. Przy 3 lub więcej trafieniach podamy ich liczbę. Stuknięcie otwiera Zakłady.</p>`;
    const foot = `<p class="hint">Powiadomienia włącza się osobno na każdym telefonie i komputerze. <a href="privacy.html">Zasady prywatności</a>.</p>`;
    if (st === 'ios-install') {
      el.innerHTML = intro + `<p class="hint">📱 Na iPhonie i iPadzie powiadomienia działają tylko w aplikacji dodanej do ekranu początkowego (iOS 16.4 lub nowszy):<br>
        1. W Safari stuknij przycisk Udostępnij (kwadrat ze strzałką).<br>2. Wybierz „Do ekranu początkowego”.<br>
        3. Otwórz Typer49 ikoną z ekranu początkowego i włącz powiadomienia tutaj.</p>`;
      return;
    }
    if (st === 'ios-old') { el.innerHTML = intro + '<p class="hint">Powiadomienia na iPhonie wymagają iOS 16.4 lub nowszego. Zaktualizuj system: Ustawienia → Ogólne → Uaktualnienia.</p>'; return; }
    if (st !== 'ok' || !Cloud.enabled) { el.innerHTML = intro + '<p class="hint">Ta przeglądarka nie obsługuje powiadomień. Na Androidzie użyj Chrome.</p>'; return; }
    if (!hasAccount()) {
      el.innerHTML = intro + `
        <label class="switch-row"><input type="checkbox" id="pushToggle" disabled><span class="switch"></span><span>Powiadomienia po losowaniu</span></label>
        <p class="hint"><a href="#account">Zaloguj się</a>, aby włączyć powiadomienia.</p>`;
      return;
    }
    if (!Cloud.user) { el.innerHTML = intro + '<p class="hint">Ustawienia powiadomień zmienisz, gdy połączenie z internetem wróci.</p>'; return; }
    if (TP.permission() === 'denied') {
      const os = TT.devicePlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints || 0);
      el.innerHTML = intro + `<p class="hint">🔕 Powiadomienia są zablokowane na tym urządzeniu. Aby je odblokować: ${PUSH_BLOCKED[os]} Potem wróć tutaj.</p>` + msg;
      return;
    }
    const on = !!pn.sub, hide = store.get(PUSH_HIDE, false), dis = pn.busy ? 'disabled' : '';
    el.innerHTML = intro + `
      <label class="switch-row"><input type="checkbox" id="pushToggle" ${on ? 'checked' : ''} ${dis}><span class="switch"></span><span>Powiadomienia po losowaniu</span></label>
      ${on ? `
      <label class="switch-row"><input type="checkbox" id="pushHide" ${hide ? 'checked' : ''} ${dis}><span class="switch"></span><span>Ukryj szczegóły na zablokowanym ekranie</span></label>
      <p class="hint">Po włączeniu powiadomienie pokazuje tylko „Nowe wyniki w Typer49”.</p>
      <button class="btn" id="pushTestBtn" ${dis}>🔔 Wyślij próbne powiadomienie</button>
      <p class="hint">Próbne powiadomienie sprawdza, czy powiadomienia docierają na to urządzenie.</p>` : ''}
      ${!on && pn.retry ? '<p class="hint">Nie udało się włączyć powiadomień automatycznie. Stuknij przełącznik, aby włączyć je ponownie.</p>' : ''}
      ${msg}${foot}`;
  }

  async function pushBusy(fn) {
    if (pn.busy) return;
    pn.busy = true; pn.msg = '';
    const job = fn();   // fn startuje od razu – prośba o zgodę musi być wywołana w chwili stuknięcia
    renderPush();
    try { await job; } catch (e) { pn.msg = e.message || String(e); pn.ok = false; }
    finally { pn.busy = false; renderPush(); }
  }
  const pushMsg = (m, ok) => { pn.msg = m; pn.ok = ok; };

  async function pushOn() {
    if (navigator.onLine === false) throw new Error('Brak internetu. Włącz powiadomienia, gdy będziesz online.');
    const sub = await TP.subscribe(CFG.vapidPublicKey);
    if (!sub) { pushMsg('Nie udzielono zgody na powiadomienia.', false); return; }
    try { await Cloud.pushSave(sub, store.get(PUSH_HIDE, false)); }
    catch (e) { await TP.unsubscribeLocal(); throw e; }
    pn.sub = sub; pushMark(sub); pn.retry = false;
    store.set(PUSH_WANTED, Cloud.user.id);
    pushMsg('Powiadomienia włączone ✓', true);
  }
  async function pushOff() {
    await Cloud.pushOffDevice();
    pn.sub = null; pn.retry = false; store.set(PUSH_SAVED, null); store.set(PUSH_WANTED, null);   // świadome wyłączenie – nie włączaj samo
    pushMsg('Powiadomienia na tym urządzeniu wyłączone.', true);
  }
  async function pushHide(hide) {
    await Cloud.pushSave(pn.sub, hide);
    store.set(PUSH_HIDE, hide); pushMark(pn.sub);
    pushMsg(hide ? 'Szczegóły będą ukryte ✓' : 'Szczegóły będą widoczne ✓', true);
  }
  async function pushTestSend() {
    if (!pn.sub) return;
    await Cloud.pushSave(pn.sub, store.get(PUSH_HIDE, false));   // gdyby adres zniknął z bazy
    pushMark(pn.sub);
    const r = await Cloud.pushTest();
    if (r === 'za_czesto') { pushMsg('Próbne powiadomienie można wysłać raz na minutę. Spróbuj za chwilę.', false); return; }
    if (r !== 'ok') { pushMsg('Nie udało się wysłać. Wyłącz i włącz powiadomienia, potem spróbuj ponownie.', false); return; }
    pushMsg('Wysłano ✓ Powiadomienie powinno pojawić się w ciągu kilku sekund. Jeśli go nie widzisz, sprawdź tryb „Nie przeszkadzać”.', true);
  }

  function bindPush() {
    const el = $('#pushBody'); if (!el) return;
    el.addEventListener('change', e => {
      if (e.target.id === 'pushToggle') { const on = e.target.checked; pushBusy(() => (on ? pushOn() : pushOff())); }
      if (e.target.id === 'pushHide') { const h = e.target.checked; pushBusy(() => pushHide(h)); }
    });
    el.addEventListener('click', e => { if (e.target.id === 'pushTestBtn') pushBusy(pushTestSend); });
  }

  // ------------------------------------------------------------------ nawigacja i zdarzenia
  function setView(v) {
    state.view = v;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    renderView(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  }
  // Numer wersji na dole Więcej – z działającego service workera (jedno źródło: VERSION w sw.js), patrz wersja.js.
  async function renderVersion() {
    const el = $('#appVersion'); if (!el || !window.TyperWersja) return;
    const v = await window.TyperWersja.loaded().catch(() => null);
    el.textContent = v ? v.text : '';
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => { if (state.view === 'more') renderVersion(); });

  function renderView() {
    if (state.view === 'account') { renderAccount(); return; }
    if (state.view === 'rank') { renderRank(); return; }
    if (state.view === 'premium') { renderPremium(); return; }
    if (state.view === 'more') { renderPush(); renderMoreAccess(); renderVersion(); }   // nie zależą od danych losowań
    if (!state.data.lotto) return;
    ({ home: renderHome, gen: renderGen, stats: renderStats, bets: renderBets, more: () => {} })[state.view]();
  }
  // Więcej: kopia i import oraz usuwanie zakładów tylko z kontem
  function renderMoreAccess() {
    const guest = !hasAccount();
    $('#ioGate').innerHTML = guest ? accountGate('io', true) : '';
    $('#ioBody').hidden = guest;
    const wipe = $('#wipeBtn'), empty = !state.bets.length;
    wipe.hidden = guest;
    wipe.textContent = Cloud.user ? 'Usuń wszystkie moje zakłady (z konta, na wszystkich urządzeniach)' : 'Usuń wszystkie zakłady z tego urządzenia';
    wipe.disabled = empty;
    $('#wipeHint').hidden = guest || !empty;
  }
  function renderAll() {
    $$('.topbar .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.game === state.game));
    renderPreviewBar();
    if (!state.data.lotto) return;
    const latest = draws('lotto').at(-1), upd = state.data.lotto.updated;
    $('#dataStatus').textContent = latest ? `Wyniki do ${fmtDate(latest.date)}${upd ? ' · pobrano ' + fmtDT(upd) + ' ' + PL : ''}` : 'Brak danych';
    renderBadge(); renderView();
  }

  function bind() {
    $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
    $$('.topbar .seg-btn').forEach(b => b.addEventListener('click', () => {
      state.game = b.dataset.game; store.set('lotto2.game', state.game);
      $('#withPlus').checked = true; state.lastGen = []; renderGenResults(); renderAll();
    }));
    $('#refreshBtn').addEventListener('click', () => refresh(true));
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]'); if (g) setView(g.dataset.goto);
      const a = e.target.closest('[data-auth]'); if (a) openAuth(a.dataset.auth);
      // karta „Zakłady z tego urządzenia”
      if (e.target.id === 'guestMove') moveGuestBets();
      if (e.target.id === 'guestExport') exportBets(unmovedGuest(), 'typer49-zaklady-z-urzadzenia');
      if (e.target.id === 'guestLater') { rk.guestLater = true; renderBets(); }
      if (e.target.id === 'guestDelete') {
        const n = unmovedGuest().length;
        if (n && confirm(`Usunąć ${n} ${plural(n, 'zakład zapisany', 'zakłady zapisane', 'zakładów zapisanych')} na tym urządzeniu bez konta? Tego nie da się cofnąć. Jeśli chcesz je zachować, najpierw pobierz kopię albo przenieś je na konto.`)) {
          guestBets = guestBets.filter(b => b.moved); saveGuest(); renderBets(); toast('Usunięto zakłady z tego urządzenia');
        }
      }
    });

    // generator
    $('#methodChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.dataset.method === 'trend' && !requireFeature('trend', 'Ważona częstość')) return;
      if (c.dataset.method === 'system' && !requireFeature('systems', 'Systemy skrócone')) return;
      state.method = c.dataset.method; renderGen();
    });
    $('#sysPicker').addEventListener('click', e => {
      const b = e.target.closest('.pick'); if (!b || state.sysBusy) return;
      const n = +b.dataset.n;
      if (state.sysPicked.has(n)) state.sysPicked.delete(n);
      else if (state.sysPicked.size < TS.MAX_NUMS) state.sysPicked.add(n);
      else { toast(`Najwyżej ${TS.MAX_NUMS} liczb`); return; }
      state.sysResult = null; renderSystem();
    });
    $('#sysGuar').addEventListener('click', e => {
      const b = e.target.closest('[data-g]'); if (!b || state.sysBusy) return;
      state.sysGuar = b.dataset.g; store.set('lotto2.sysGuar', state.sysGuar); state.sysResult = null; renderSystem();
    });
    $('#sysClear').addEventListener('click', () => { if (state.sysBusy) return; state.sysPicked.clear(); state.sysResult = null; renderSystem(); });
    $('#sysBuild').addEventListener('click', buildSystem);
    $('#sysResults').addEventListener('click', e => { if (e.target.id === 'sysSave') saveSystem(); });
    $('#withPlus').addEventListener('change', () => { if (state.method === 'system') renderSysResults(); });
    $('#cntMinus').addEventListener('click', () => { state.count = Math.max(1, state.count - 1); $('#cntVal').textContent = state.count; });
    $('#cntPlus').addEventListener('click', () => {
      if (state.count >= LIMITS.setsPerClick && !hasFeature('manySets')) { requireFeature('manySets', `Więcej niż ${LIMITS.setsPerClick} zestawy na raz`); return; }
      state.count = Math.min(10, state.count + 1); $('#cntVal').textContent = state.count;
    });
    $('#filterList').addEventListener('change', e => {
      const k = e.target.dataset.filter; if (!k) return;
      state.filters[k] = e.target.checked; store.set('lotto2.filters', state.filters);
      $('#filtersCount').textContent = `(${FILTERS.filter(([f]) => state.filters[f]).length}/${FILTERS.length} aktywne)`;
    });
    $('#genBtn').addEventListener('click', () => {
      state.lastGen = generate(state.method, state.count).map(g => ({ ...g, method: state.method }));
      renderGenResults(true);
      $('#genResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#genResults').addEventListener('click', e => {
      const s = e.target.closest('[data-save]');
      const plus = $('#withPlus').checked, asSet = g => ({ nums: g.nums, method: g.method, base: state.game, plus });
      if (s) {
        if (!canAddBets(1)) return;
        const g = state.lastGen[+s.dataset.save];
        if (saveSets([asSet(g)])) { g.saved = true; renderGenResults(); toast('Zapisano zakład ✓'); }
      }
      if (e.target.id === 'saveAll') {
        const todo = state.lastGen.filter(g => !g.saved);
        if (!todo.length) { toast('Wszystkie już zapisane'); return; }
        if (!canAddBets(todo.length)) return;
        if (saveSets(todo.map(asSet))) { todo.forEach(g => { g.saved = true; }); renderGenResults(); toast(`Zapisano ${todo.length} zakładów ✓`); }
      }
    });
    $('#picker').addEventListener('click', e => {
      const b = e.target.closest('.pick'); if (!b) return;
      const n = +b.dataset.n;
      if (state.picked.has(n)) state.picked.delete(n);
      else if (state.picked.size < 6) state.picked.add(n);
      else toast('Wybrano już 6 liczb');
      renderPicker();
    });
    $('#pickClear').addEventListener('click', () => { state.picked.clear(); renderPicker(); });
    $('#pickRandomFill').addEventListener('click', () => {
      const rest = sample(RANGE49.filter(n => !state.picked.has(n)), 6 - state.picked.size);
      rest.forEach(n => state.picked.add(n)); renderPicker();
    });
    $('#pickSave').addEventListener('click', () => {
      if (!canAddBets(1)) return;
      const set = { nums: [...state.picked].sort((a, b) => a - b), method: 'manual', base: state.game, plus: $('#withPlus').checked };
      if (saveSets([set])) { state.picked.clear(); renderPicker(); toast('Zapisano zakład ✓'); }
    });

    // statystyki
    $('#rangeChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      if (c.hasAttribute('data-premium') && !requireFeature('longStats', 'Statystyki z dłuższego okresu')) return;
      state.range = +c.dataset.range; renderStats();
    });
    $('#heatMode').addEventListener('click', e => {
      const c = e.target.closest('.seg-btn'); if (!c) return;
      if (c.hasAttribute('data-premium') && !requireFeature('heatModel', 'Mapa ważonej częstości')) return;
      state.heatMode = c.dataset.mode; renderStats();
    });
    $('#heat').addEventListener('click', e => { const c = e.target.closest('.cell'); if (c) heatDetail(+c.dataset.n); });

    // zakłady
    $('#betFilter').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.betFilter = c.dataset.f; renderBets(); });
    $('#bilans').addEventListener('click', e => {
      const c = e.target.closest('[data-period]'); if (!c) return;
      state.bilansPeriod = c.dataset.period; store.set('lotto2.bilansPeriod', state.bilansPeriod); renderBilans();
    });
    $('#betList').addEventListener('change', e => {
      const pid = e.target.dataset.prize;
      if (pid) {
        const b = state.bets.find(x => x.id === pid); if (!b) return;
        const v = TB.parsePrize(e.target.value);
        if (Number.isNaN(v)) { toast('Wpisz kwotę w złotych, np. 35 albo 120,50'); renderBets(); return; }
        if (v == null) delete b.prize; else b.prize = v;
        saveBets(); Cloud.push(b); renderBets();
        return;
      }
      const id = e.target.dataset.played; if (!id) return;
      const b = state.bets.find(x => x.id === id); if (b) { b.played = e.target.checked; saveBets(); Cloud.push(b); renderBets(); }
    });
    $('#betList').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'), a = e.target.closest('[data-again]');
      if (d && confirm('Usunąć ten zakład?')) { state.bets = state.bets.filter(b => b.id !== d.dataset.del); saveBets(); Cloud.remove(d.dataset.del); renderBets(); }
      if (a) {
        const b = state.bets.find(x => x.id === a.dataset.again);
        if (b && canAddBets(1)) {
          const nb = { ...b, id: uid(), t: now().toISOString(), played: false, synced: false };
          delete nb.prize;
          state.bets.unshift(nb); saveBets(); Cloud.push(nb); renderBets(); toast('Dodano na najbliższe losowanie ✓');
        }
      }
    });

    // więcej
    $('#checkBtn').addEventListener('click', checkTicket);
    $('#checkInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTicket(); });
    $('#exportBtn').addEventListener('click', () => exportBets());
    $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('#shareBtn').addEventListener('click', shareBets);
    $('#manAdd').addEventListener('click', addManualDraw);
    $('#manDate').value = lastDrawTime().date;
    $('#wipeBtn').addEventListener('click', () => {
      const where = Cloud.user ? 'z konta (na wszystkich urządzeniach)' : 'z tego urządzenia';
      if (!state.bets.length) { toast('Nie masz zapisanych zakładów'); return; }
      if (confirm(`Usunąć wszystkie ${state.bets.length} zakłady ${where}? Tego nie da się cofnąć (chyba że masz eksport).`)) {
        if (Cloud.user) state.bets.forEach(b => Cloud.remove(b.id));
        state.bets = []; saveBets(); renderAll(); toast('Usunięto zakłady');
      }
    });

    // instalacja PWA
    let deferred;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
    $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; });

    // odśwież po powrocie do aplikacji (np. telefon wybudzony po losowaniu)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncClock(); refresh(false); syncNow(true); } });
    window.addEventListener('online', () => syncClock(true));
  }

  // ------------------------------------------------------------------ nowa wersja aplikacji (backlog d)
  // Strona zapamiętuje wersję, na której działa (VERSION z sw.js w chwili otwarcia). Po powrocie do aplikacji,
  // po odzyskaniu internetu i po zmianie service workera porównuje ją z wersją na serwerze; gdy jest inna,
  // pokazuje pasek „Dostępna nowa wersja – Odśwież”. Przeładowanie tylko po kliknięciu, z zachowaniem
  // niezapisanej pracy (sessionStorage, najwyżej 10 min). Logika i testy: wersja.js, tests/wersja.test.js.
  const TW = window.TyperWersja, RELOAD_KEY = 'typer.reloadState';
  let pageVersion = null, updateOffered = false, updateChecking = false;
  async function checkUpdate() {
    if (!TW || updateOffered || updateChecking || location.protocol === 'file:') return;
    updateChecking = true;
    try {
      if (!pageVersion) {
        // wersja tej strony: z serwera (pliki aplikacji też przyszły z sieci), bez internetu – z service workera,
        // który podał pliki z pamięci podręcznej
        pageVersion = navigator.onLine ? await TW.fromServer() : await TW.fromWorker().catch(() => null);
        return;
      }
      if (!navigator.onLine) return;
      const server = await TW.fromServer();
      if (TW.shouldOffer(pageVersion, server)) {
        updateOffered = true;
        $('#updateBar').hidden = false; document.body.classList.add('has-update');
        navigator.serviceWorker?.getRegistration().then(r => r && r.update()).catch(() => {});
      }
    } finally { updateChecking = false; }
  }
  function reloadToUpdate() {
    if (state.sysBusy) { toast('Chwileczkę – trwa układanie systemu'); return; }
    const snap = TW.packSnapshot({
      picked: [...state.picked], lastGen: state.lastGen, method: state.method, count: state.count,
      sysPicked: [...state.sysPicked], sysResult: state.sysResult, check: $('#checkInput').value,
    }, Date.now());
    try { if (snap) sessionStorage.setItem(RELOAD_KEY, snap); } catch { /* bez sessionStorage – przeładuj i tak */ }
    $('#updateBtn').disabled = true; $('#updateBtn').textContent = 'Odświeżam…';
    location.reload();
  }
  function restoreAfterUpdate() {
    let text = null;
    try { text = sessionStorage.getItem(RELOAD_KEY); sessionStorage.removeItem(RELOAD_KEY); } catch { return; }
    const s = TW && text ? TW.unpackSnapshot(text, Date.now()) : null;
    if (!s) return;
    const nums = a => Array.isArray(a) ? a.filter(n => Number.isInteger(n) && n >= 1 && n <= 49) : [];
    state.picked = new Set(nums(s.picked));
    state.sysPicked = new Set(nums(s.sysPicked));
    if (Array.isArray(s.lastGen)) state.lastGen = s.lastGen;
    if (s.sysResult && typeof s.sysResult === 'object') state.sysResult = s.sysResult;
    if (typeof s.method === 'string') state.method = s.method;
    if (Number.isInteger(s.count)) state.count = s.count;
    if (typeof s.check === 'string') $('#checkInput').value = s.check.slice(0, 200);
    toast('Zaktualizowano aplikację');
  }
  // Systemy skrócone liczą się w Web Workerze ładowanym z osobnego pliku. Tworzymy go od razu przy otwarciu,
  // razem z resztą plików tej wersji – inaczej po publikacji stara strona mogłaby uruchomić nowy systemy.js.
  function prepareSystemWorker() {
    if (sysWorker !== null || typeof Worker === 'undefined' || location.protocol === 'file:') return;
    try { sysWorker = new Worker('systemy.js'); } catch { sysWorker = false; }
  }

  // Link „Więcej” przy komunikacie o losowości → zakładka Więcej z rozwiniętą sekcją „O aplikacji i odpowiedzialna gra”
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-about]'); if (!a) return;
    e.preventDefault(); setView('more');
    const d = $('#aboutApp'); d.open = true;
    setTimeout(() => d.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  });

  // ------------------------------------------------------------------ ekran 18+ (zgodność prawna, runda 3)
  // Zasłania aplikację do czasu potwierdzenia pełnoletności (zapamiętane na urządzeniu: TyperDostep.ADULT_KEY).
  // Nie wstrzymuje reszty startu: service worker, powiadomienia i zapis zestawu czekającego na logowanie
  // działają pod spodem. Bez localStorage (tryb prywatny) potwierdzenie obowiązuje do zamknięcia strony.
  let adultThisSession = false;
  function applyAgeGate() {
    const ok = adultThisSession || TD.adultConfirmed(store.get(TD.ADULT_KEY, null), Date.now());
    document.documentElement.classList.toggle('adult-ok', ok);
    $$('.topbar, .tabs, main, #updateBar').forEach(el => { el.inert = !ok; });
    if (!ok) setTimeout(() => { try { $('#ageYes').focus(); } catch { /* bez fokusu */ } }, 0);
  }
  $('#ageYes').addEventListener('click', () => {
    adultThisSession = true;
    store.set(TD.ADULT_KEY, TD.adultRecord(Date.now()));
    applyAgeGate();
  });
  $('#ageNo').addEventListener('click', () => {
    try { window.close(); } catch { /* przeglądarka nie pozwala zamknąć okna */ }
    setTimeout(() => { $('#ageMsg').hidden = false; }, 300);   // gdy okno się nie zamknęło
  });

  // Źródło wyników (jedna stała: APP_CONFIG.dataSource)
  function renderDataSource() {
    const src = window.APP_CONFIG && window.APP_CONFIG.dataSource, el = $('#dataSource');
    if (!src || !el) return;
    let host = '';
    try { host = new URL(src.url).hostname.replace(/^www\./, ''); } catch { return; }
    el.innerHTML = `Źródło wyników: <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)} (${esc(host)})</a>`;
  }

  // ------------------------------------------------------------------ start
  applyAgeGate();
  renderDataSource();
  const VIEWS = ['home', 'gen', 'stats', 'bets', 'rank', 'more', 'account', 'premium'];
  document.title = (window.APP_CONFIG && window.APP_CONFIG.name) || document.title;
  bind();
  bindAccount();
  bindRank();
  bindPush();
  decoratePremium();
  restoreAfterUpdate();
  prepareSystemWorker();
  const startView = location.hash.slice(1);
  if (VIEWS.includes(startView)) setView(startView);
  if (BENCH) runSystemsBenchmark();
  window.addEventListener('hashchange', () => {
    if (checkJoinLink()) return;
    const v = location.hash.slice(1);
    if (v !== state.view && VIEWS.includes(v)) setView(v);
  });
  if (Cloud.init) {
    Cloud.init({
      auth: onAuth,
      recovery: () => { acct.recovery = true; setView('account'); },
      status: s => {
        acct.syncInfo = s;
        const line = $('#syncLine'); if (line) line.textContent = syncLabel();
        const b = $('#accountBtn'); if (b) b.classList.toggle('warn', !!(s.user && s.pending));
      },
    }).then(() => {
      renderAccountButton(); checkJoinLink();
      syncPush('INIT').then(() => { if (state.view === 'more') renderPush(); });
    }).catch(e => console.warn('Cloud init:', e));
  }
  tickCountdown(); setInterval(() => {
    tickCountdown();
    // tuż po 22:00 w dniu losowania odświeżaj dane co 5 minut
    const p = TT.parts(now());   // czas polski
    if (DRAW_DAYS.includes(p.wd) && p.h >= DRAW_HOUR && p.s === 0 && p.mi % 5 === 0) refresh(false);
  }, 1000);
  renderClockWarn();     // ostrzeżenie od razu z zapamiętanej różnicy (także bez internetu)
  syncClock(true);
  refresh(false);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => checkUpdate());
  }
  $('#updateBtn').addEventListener('click', reloadToUpdate);
  checkUpdate();                                        // zapamiętaj wersję tej strony
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  window.addEventListener('online', () => checkUpdate());
  setInterval(() => { if (!document.hidden) checkUpdate(); }, 30 * 60 * 1000);
})();
