/* Lotto Analizator 2.0 – aplikacja webowa (PWA), działa na komputerze i telefonie. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const GAMES = { lotto: 'Lotto', lottoplus: 'Lotto Plus' };
  const DRAW_DAYS = [2, 4, 6];      // wtorek, czwartek, sobota (JS: 0 = niedziela)
  const DRAW_HOUR = 22;
  const DAY_NAMES = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const drawTimeOf = s => { const d = parseISO(s); d.setHours(DRAW_HOUR, 0, 0, 0); return d; };
  const fmtDate = s => { const d = parseISO(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const fmtShort = s => { const d = parseISO(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };
  const dayName = s => DAY_NAMES[parseISO(s).getDay()];
  const fmtDT = iso => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
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
    filters: Object.assign({ hist: true, sum: true, even: true, high: true, decades: true, endings: true, seq: true }, store.get('lotto2.filters', {})),
    picked: new Set(),
    lastGen: [],
    statsCache: {},
  };
  const saveBets = () => { store.set('lotto2.bets', state.bets); renderBadge(); };
  const Cloud = window.Cloud || { enabled: false, user: null, push() {}, remove() {} };

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
  function nextDrawTime(from = new Date()) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(from); d.setDate(d.getDate() + i); d.setHours(DRAW_HOUR, 0, 0, 0);
      if (DRAW_DAYS.includes(d.getDay()) && d > from) return d;
    }
  }
  function lastDrawTime(from = new Date()) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(from); d.setDate(d.getDate() - i); d.setHours(DRAW_HOUR, 0, 0, 0);
      if (DRAW_DAYS.includes(d.getDay()) && d <= from) return d;
    }
  }

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

  function addBet(nums, method) {
    const bet = { id: uid(), t: new Date().toISOString(), nums, method, base: state.game, plus: $('#withPlus').checked, played: false };
    state.bets.unshift(bet); saveBets(); Cloud.push(bet); return bet;
  }

  // ------------------------------------------------------------------ weryfikacja zakładów
  function evalBet(b) {
    const created = new Date(b.t);
    const target = nextDrawTime(new Date(created.getTime() - 1));       // pierwsze losowanie po utworzeniu
    const date = isoDate(target);
    if (new Date() < target) return { status: 'pending', date, target };
    const L = drawByDate('lotto', date), P = b.plus ? drawByDate('lottoplus', date) : null;
    if (!L) return { status: 'waiting', date, target };
    const hit = d => d ? d.nums.filter(n => b.nums.includes(n)) : null;
    const hl = hit(L), hp = hit(P);
    const best = Math.max(hl.length, hp ? hp.length : 0);
    return { status: 'done', date, target, L, P, hl, hp, best, plusMissing: b.plus && !P };
  }

  const METHOD_LABEL = { stat: 'Statystyka', trend: 'Model trendu', random: 'Losowo', manual: 'Własne', ai: 'AI (stary program)', import: 'Import' };

  // ------------------------------------------------------------------ render: START
  function renderHome() {
    const now = new Date(), next = nextDrawTime(now);
    $('#nextDrawDate').textContent = `${DAY_NAMES[next.getDay()]}, ${pad(next.getDate())}.${pad(next.getMonth() + 1)}.${next.getFullYear()} o ${DRAW_HOUR}:00`;

    const resultCard = (key, el) => {
      const d = draws(key).at(-1);
      el.innerHTML = d ? `
        <div class="meta"><span class="title">${GAMES[key]}</span><span>${d.no ? '#' + d.no + ' · ' : ''}${dayName(d.date)}, ${fmtDate(d.date)}${d.manual ? ' · ręcznie' : ''}</span></div>
        ${balls(d.nums)}` : `<div class="meta"><span class="title">${GAMES[key]}</span></div><p class="muted">Brak danych</p>`;
    };
    resultCard('lotto', $('#lastLotto'));
    resultCard('lottoplus', $('#lastPlus'));

    // czy wynik ostatniego losowania już jest?
    const last = lastDrawTime(now), lastIso = isoDate(last), latest = draws('lotto').at(-1);
    const alert = $('#missingAlert');
    if (latest && latest.date < lastIso) {
      const mins = Math.round((now - last) / 60000);
      alert.hidden = false; alert.className = 'alert';
      alert.innerHTML = mins < 180
        ? `⏳ Losowanie z ${fmtDate(lastIso)} odbyło się ${mins} min temu – wyniki pojawią się automatycznie wkrótce (zwykle do godziny). Możesz odświeżyć przyciskiem ↻.`
        : `⚠️ Brakuje wyników z ${fmtDate(lastIso)}. Automat spróbuje ponownie. Możesz też dodać wynik ręcznie w zakładce „Więcej”.`;
    } else alert.hidden = true;


    // podsumowanie zakładów
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

    $('#recentGameLabel').textContent = GAMES[state.game];
    $('#recentDraws').innerHTML = draws().slice(-10).reverse().map(d => `
      <div class="draw-row"><div class="when"><b>${fmtShort(d.date)}</b>${dayName(d.date).slice(0, 3)}.${d.no ? ' #' + d.no : ''}</div>${balls(d.nums, 'xs')}</div>`).join('') || '<p class="muted">Brak danych</p>';
  }

  function tickCountdown() {
    const now = new Date(), next = nextDrawTime(now);
    let s = Math.max(0, Math.floor((next - now) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    $('#countdown').innerHTML = `${d ? `${d}<small>d</small>` : ''}${pad(h)}<small>h</small>${pad(m)}<small>m</small>${pad(s)}<small>s</small>`;
  }

  // ------------------------------------------------------------------ render: GENERATOR
  const METHOD_HINT = {
    stat: 'Klasyka z poprzedniej wersji: 2 liczby „gorące”, 2 „zimne” i 2 losowe, z filtrami.',
    trend: 'Zastępuje starą sieć neuronową: liczby ważone częstością z ostatnich 300 losowań (nowsze ważą więcej) i zaległością. Lżejsze, działa w telefonie.',
    random: 'Czysty przypadek – matematycznie tak samo dobry jak każda inna metoda. Filtry nadal działają.',
    manual: 'Zaznacz własne liczby i zapisz kupon, żeby aplikacja go sprawdziła po losowaniu.',
  };

  function renderGen() {
    $('#genGameLabel').textContent = `baza: ${GAMES[state.game]}`;
    $$('#methodChips .chip').forEach(c => c.classList.toggle('active', c.dataset.method === state.method));
    $('#methodHint').textContent = METHOD_HINT[state.method];
    const manual = state.method === 'manual';
    $('#autoGen').hidden = manual; $('#manualGen').hidden = !manual;
    $('#cntVal').textContent = state.count;
    $('#filterList').innerHTML = FILTERS.map(([k, label]) => `
      <label class="switch-row"><input type="checkbox" data-filter="${k}" ${state.filters[k] ? 'checked' : ''}><span class="switch"></span><span>${label}</span></label>`).join('');
    $('#filtersCount').textContent = `(${FILTERS.filter(([k]) => state.filters[k]).length}/${FILTERS.length} aktywne)`;
    if (state.method === 'trend') {
      const st = stats(state.game, 0);
      $('#methodHint').innerHTML = esc(METHOD_HINT.trend) + `<br>Model faworyzuje teraz: <b>${st.trendTop.slice().sort((a, b) => a - b).join(', ')}</b>`;
    }
    renderPicker();
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
      <p class="hint">Zapisane zakłady zostaną sprawdzone po losowaniu ${DAY_NAMES[next.getDay()]} ${pad(next.getDate())}.${pad(next.getMonth() + 1)}.</p>
    </div>`;
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
    $('#pairs').innerHTML = st.topPairs.map(([a, b, c]) => `<div class="pair">${balls([a, b], 'xs')}<span class="muted">${c}×</span></div>`).join('');
    $('#heatDetail').textContent = 'Dotknij liczby, aby zobaczyć szczegóły.';
  }

  function heatDetail(n) {
    const st = stats(state.game, state.range);
    $$('#heat .cell').forEach(c => c.classList.toggle('sel', Number(c.dataset.n) === n));
    const pct = st.n ? (st.freq[n] / st.n * 100).toFixed(1) : 0;
    const allSt = stats(state.game, 0);
    $('#heatDetail').innerHTML = `<b>${n}</b>: padła ${st.freq[n]}× w ${st.n} losowaniach (${pct}%, średnio ${(600 / 49).toFixed(1)}%) · ` +
      `ostatnio ${st.gap[n] === 0 ? 'w ostatnim losowaniu' : st.gap[n] + ' losowań temu'} · w całej historii ${allSt.freq[n]}× · ocena modelu ${Math.round(st.trend[n] * 100)}/100`;
  }

  // ------------------------------------------------------------------ render: ZAKŁADY
  function renderBets() {
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

    if (!list.length) {
      $('#betList').innerHTML = `<div class="card empty">${state.bets.length ? 'Brak zakładów dla tego filtra.' : 'Brak zakładów. Wygeneruj je w zakładce Generator albo zaimportuj ze starego programu (Więcej → Importuj).'}</div>`;
      return;
    }
    const SHOW = 60;
    $('#betList').innerHTML = list.slice(0, SHOW).map(({ b, e }) => {
      let status, res = '';
      if (e.status === 'pending') status = `<span class="status wait">⏳ ${fmtShort(e.date)} 22:00</span>`;
      else if (e.status === 'waiting') status = `<span class="status wait">⌛ czekam na wyniki</span>`;
      else {
        const cls = e.best >= 5 ? 'big' : e.best >= 3 ? 'win' : '';
        status = `<span class="status ${cls}">${e.best >= 6 ? '🔥 6!' : e.best >= 3 ? '🎉 ' + e.best : e.best} traf.</span>`;
        res = `<div class="bet-res"><span>Lotto: <b>${e.hl.length}</b> ${e.hl.length ? '(' + e.hl.join(', ') + ')' : ''}</span>
          ${b.plus ? `<span>Plus: <b>${e.hp ? e.hp.length : '–'}</b> ${e.hp?.length ? '(' + e.hp.join(', ') + ')' : ''}</span>` : ''}</div>`;
      }
      const hitSet = e.status === 'done' ? new Set([...(e.hl || []), ...(e.hp || [])]) : null;
      return `<div class="card bet" data-id="${b.id}">
        <div class="bet-top">
          <div class="bet-info">${METHOD_LABEL[b.method] || esc(b.method)}${b.plus ? ' · z Plusem' : ''}<br>utworzony ${fmtDT(b.t)} · losowanie ${dayName(e.date).slice(0, 3)}. ${fmtDate(e.date)}</div>
          ${status}
        </div>
        ${balls(b.nums, 'sm', hitSet)}
        ${res}
        <div class="bet-actions">
          <label class="switch-row"><input type="checkbox" data-played="${b.id}" ${b.played ? 'checked' : ''}><span class="switch"></span><span>Zagrany</span></label>
          <button class="btn sm" data-again="${b.id}" title="Zagraj te same liczby w następnym losowaniu">↻ Ponów</button>
          <button class="btn sm" data-del="${b.id}" title="Usuń">🗑</button>
        </div>
      </div>`;
    }).join('') + (list.length > SHOW ? `<p class="hint" style="text-align:center">Pokazano ${SHOW} z ${list.length}. Zawęź filtrem.</p>` : '');
  }

  function renderBadge() {
    const n = state.bets.filter(b => evalBet(b).status !== 'done').length;
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
  function exportBets() {
    const payload = JSON.stringify({ app: 'lotto-analizator', v: 2, exported: new Date().toISOString(), bets: state.bets }, null, 1);
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lotto-zaklady-${isoDate(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('#ioMsg').textContent = `Wyeksportowano ${state.bets.length} zakładów.`;
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
      const t = m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)).toISOString() : new Date().toISOString();
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
          .map(b => ({ id: b.id || uid(), t: b.t, nums: b.nums.map(Number).sort((x, y) => x - y), method: b.method || 'import', base: b.base || 'lotto', plus: !!b.plus, played: !!b.played }));
      } else incoming = importOldCSV(text);
    } catch (e) { $('#ioMsg').textContent = '❌ Nie rozpoznano pliku: ' + e.message; return; }
    const keys = new Set(state.bets.map(b => b.id)), sig = new Set(state.bets.map(b => b.t.slice(0, 16) + b.nums.join(',')));
    let added = 0;
    incoming.forEach(b => {
      const s = b.t.slice(0, 16) + b.nums.join(',');
      if (keys.has(b.id) || sig.has(s)) {
        const ex = state.bets.find(x => x.id === b.id || x.t.slice(0, 16) + x.nums.join(',') === s);
        if (ex && b.played) ex.played = true;
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
    b.hidden = !Cloud.enabled;
    b.classList.toggle('on', !!Cloud.user);
    b.title = Cloud.user ? `Konto: ${Cloud.user.email}` : 'Zaloguj się';
  }

  function syncLabel() {
    const s = acct.syncInfo;
    if (!s) return '';
    if (s.online === false) return `📴 Offline – ${s.pending} zmian czeka na wysłanie`;
    if (s.pending) return `⏳ Wysyłanie zmian (${s.pending})…`;
    return s.lastSync ? `✓ Zsynchronizowano ${pad(s.lastSync.getHours())}:${pad(s.lastSync.getMinutes())}` : '✓ Połączono';
  }

  function renderAccount() {
    const el = $('#accountBody');
    if (!Cloud.enabled) { el.innerHTML = '<p class="hint">Konta nie są jeszcze włączone w tej wersji aplikacji.</p>'; return; }
    const u = Cloud.user;
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
        <p class="hint">Twoje zakłady (${state.bets.length}) są zapisane na koncie i widoczne na każdym urządzeniu, na którym się zalogujesz.</p>
        <button class="btn" id="syncNow">🔄 Synchronizuj teraz</button>

        <h3 style="margin-top:20px">Pseudonim</h3>
        <p class="hint">Będzie widoczny w rankingach (wkrótce). Nie podawaj imienia i nazwiska.</p>
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
    el.innerHTML = `
      <div class="seg" id="acctTabs" style="margin-bottom:14px">
        <button class="seg-btn ${!reg && !reset ? 'active' : ''}" data-mode="login">Logowanie</button>
        <button class="seg-btn ${reg ? 'active' : ''}" data-mode="register">Nowe konto</button>
      </div>
      <p class="hint">${reset ? 'Podaj e-mail – wyślemy link do ustawienia nowego hasła.'
        : reg ? 'Załóż darmowe konto, a Twoje zakłady będą bezpieczne w chmurze i dostępne na telefonie i komputerze.'
        : 'Zaloguj się, aby mieć te same zakłady na wszystkich urządzeniach.'}</p>
      <form id="authForm" class="form">
        <input class="input" type="email" name="email" autocomplete="email" placeholder="Adres e-mail" required>
        ${reset ? '' : `<input class="input" type="password" name="pw" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="Hasło${reg ? ' (min. 8 znaków)' : ''}" required minlength="${reg ? 8 : 1}">`}
        ${reg ? `<label class="check-row"><input type="checkbox" name="terms" required> <span>Mam ukończone 18 lat i akceptuję <a href="privacy.html" target="_blank">zasady prywatności</a>.</span></label>` : ''}
        <button class="btn primary big">${reset ? 'Wyślij link' : reg ? 'Załóż konto' : 'Zaloguj się'}</button>
      </form>
      <p id="acctMsg" class="acct-msg"></p>
      ${reg ? '' : `<button class="link-btn" id="resetLink">${reset ? '← Wróć do logowania' : 'Nie pamiętasz hasła?'}</button>`}
      ${state.bets.length ? `<p class="hint">Masz ${state.bets.length} zakładów na tym urządzeniu – po zalogowaniu możesz je przenieść na konto.</p>` : ''}`;
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
      if (merged) { state.bets = merged; saveBets(); renderAll(); }
      if (!silent) toast('Zsynchronizowano ✓');
    } catch (e) { if (!silent) toast(e.message); }
  }

  async function onAuth(user, event) {
    renderAccountButton();
    if (user) {
      Cloud.getProfile().then(p => { acct.profile = p; if (state.view === 'account') renderAccount(); }).catch(() => {});
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const local = state.bets.filter(b => !b.synced);
        if (event === 'SIGNED_IN' && local.length && !store.get('typer.owner', null)) {
          if (!confirm(`Przenieść ${local.length} zakładów z tego urządzenia na Twoje konto?`)) {
            state.bets = state.bets.filter(b => b.synced);
          }
        }
        store.set('typer.owner', user.id);
        await syncNow(true);
        if (event === 'SIGNED_IN' && state.view === 'account' && !acct.recovery) toast('Zalogowano ✓');
      }
    } else {
      // wylogowanie: usuń dane konta z urządzenia (prywatność na wspólnych urządzeniach)
      if (store.get('typer.owner', null)) { state.bets = []; saveBets(); store.set('typer.owner', null); }
      acct.profile = null; acct.recovery = false;
      renderAll();
    }
    if (state.view === 'account') renderAccount();
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
        await Cloud.signOut(); toast('Wylogowano');
      });
      if (t.id === 'delAccBtn') withBusy(t, async () => {
        if ($('#delConfirm').value.trim().toUpperCase() !== 'USUŃ') { setAcctMsg('Wpisz USUŃ, aby potwierdzić.'); return; }
        await Cloud.deleteAccount(); toast('Konto zostało usunięte');
      });
    });
    body.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('button');
      setAcctMsg('');
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

  // ------------------------------------------------------------------ nawigacja i zdarzenia
  function setView(v) {
    state.view = v;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    renderView(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  }
  function renderView() {
    if (state.view === 'account') { renderAccount(); return; }
    if (!state.data.lotto) return;
    ({ home: renderHome, gen: renderGen, stats: renderStats, bets: renderBets, more: () => {} })[state.view]();
  }
  function renderAll() {
    $$('.topbar .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.game === state.game));
    if (!state.data.lotto) return;
    const latest = draws('lotto').at(-1), upd = state.data.lotto.updated;
    $('#dataStatus').textContent = latest ? `Wyniki do ${fmtDate(latest.date)}${upd ? ' · pobrano ' + fmtDT(upd) : ''}` : 'Brak danych';
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
    });

    // generator
    $('#methodChips').addEventListener('click', e => {
      const c = e.target.closest('.chip'); if (!c) return;
      state.method = c.dataset.method; renderGen();
    });
    $('#cntMinus').addEventListener('click', () => { state.count = Math.max(1, state.count - 1); $('#cntVal').textContent = state.count; });
    $('#cntPlus').addEventListener('click', () => { state.count = Math.min(10, state.count + 1); $('#cntVal').textContent = state.count; });
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
      if (s) { const g = state.lastGen[+s.dataset.save]; addBet(g.nums, g.method); g.saved = true; renderGenResults(); toast('Zapisano zakład ✓'); }
      if (e.target.id === 'saveAll') {
        let n = 0; state.lastGen.forEach(g => { if (!g.saved) { addBet(g.nums, g.method); g.saved = true; n++; } });
        renderGenResults(); toast(n ? `Zapisano ${n} zakładów ✓` : 'Wszystkie już zapisane');
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
      addBet([...state.picked].sort((a, b) => a - b), 'manual'); state.picked.clear(); renderPicker(); toast('Zapisano zakład ✓');
    });

    // statystyki
    $('#rangeChips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.range = +c.dataset.range; renderStats(); });
    $('#heatMode').addEventListener('click', e => { const c = e.target.closest('.seg-btn'); if (!c) return; state.heatMode = c.dataset.mode; renderStats(); });
    $('#heat').addEventListener('click', e => { const c = e.target.closest('.cell'); if (c) heatDetail(+c.dataset.n); });

    // zakłady
    $('#betFilter').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; state.betFilter = c.dataset.f; renderBets(); });
    $('#betList').addEventListener('change', e => {
      const id = e.target.dataset.played; if (!id) return;
      const b = state.bets.find(x => x.id === id); if (b) { b.played = e.target.checked; saveBets(); Cloud.push(b); $('#betsSummary').textContent = `${state.bets.length} zakładów · ${state.bets.filter(x => x.played).length} zagranych`; }
    });
    $('#betList').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'), a = e.target.closest('[data-again]');
      if (d && confirm('Usunąć ten zakład?')) { state.bets = state.bets.filter(b => b.id !== d.dataset.del); saveBets(); Cloud.remove(d.dataset.del); renderBets(); }
      if (a) {
        const b = state.bets.find(x => x.id === a.dataset.again);
        if (b) {
          const nb = { ...b, id: uid(), t: new Date().toISOString(), played: false, synced: false };
          state.bets.unshift(nb); saveBets(); Cloud.push(nb); renderBets(); toast('Dodano na najbliższe losowanie ✓');
        }
      }
    });

    // więcej
    $('#checkBtn').addEventListener('click', checkTicket);
    $('#checkInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTicket(); });
    $('#exportBtn').addEventListener('click', exportBets);
    $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
    $('#shareBtn').addEventListener('click', shareBets);
    $('#manAdd').addEventListener('click', addManualDraw);
    $('#manDate').value = isoDate(lastDrawTime());
    $('#wipeBtn').addEventListener('click', () => {
      const where = Cloud.user ? 'z konta (na wszystkich urządzeniach)' : 'z tego urządzenia';
      if (state.bets.length && confirm(`Usunąć wszystkie ${state.bets.length} zakłady ${where}? Tego nie da się cofnąć (chyba że masz eksport).`)) {
        if (Cloud.user) state.bets.forEach(b => Cloud.remove(b.id));
        state.bets = []; saveBets(); renderAll(); toast('Usunięto zakłady');
      }
    });

    // instalacja PWA
    let deferred;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
    $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; });

    // odśwież po powrocie do aplikacji (np. telefon wybudzony po losowaniu)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(false); syncNow(true); } });
  }

  // ------------------------------------------------------------------ start
  const VIEWS = ['home', 'gen', 'stats', 'bets', 'more', 'account'];
  document.title = (window.APP_CONFIG && window.APP_CONFIG.name) || document.title;
  bind();
  bindAccount();
  const startView = location.hash.slice(1);
  if (VIEWS.includes(startView)) setView(startView);
  window.addEventListener('hashchange', () => {
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
    }).then(renderAccountButton).catch(e => console.warn('Cloud init:', e));
  }
  tickCountdown(); setInterval(() => {
    tickCountdown();
    // tuż po 22:00 w dniu losowania odświeżaj dane co 5 minut
    const now = new Date();
    if (DRAW_DAYS.includes(now.getDay()) && now.getHours() >= 22 && now.getSeconds() === 0 && now.getMinutes() % 5 === 0) refresh(false);
  }, 1000);
  refresh(false);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
