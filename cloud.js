/* Typer49 – konta użytkowników i synchronizacja zakładów (Supabase).
   Zasada: aplikacja działa zawsze lokalnie (offline-first). Gdy użytkownik jest zalogowany,
   każda zmiana trafia do kolejki i jest wysyłana do chmury; przy braku sieci – później. */
window.Cloud = (() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const QKEY = 'typer.queue';
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);

  let sb = null, user = null, flushing = null, lastSync = null;
  const handlers = { auth: () => {}, recovery: () => {}, status: () => {} };

  const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch { return []; } };
  const saveQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* brak miejsca */ } };

  const toRow = b => ({ id: b.id, created_at: b.t, nums: b.nums, method: String(b.method || 'manual').slice(0, 20),
    base: b.base === 'lottoplus' ? 'lottoplus' : 'lotto', plus: !!b.plus, played: !!b.played,
    prize: b.prize != null ? b.prize : null, updated_at: new Date().toISOString() });   // kwota wygranej (bilans), kolumna z etap4_bilans.sql
  const fromRow = r => ({ id: r.id, t: new Date(r.created_at).toISOString(), nums: r.nums.map(Number).sort((a, b) => a - b),
    method: r.method, base: r.base, plus: r.plus, played: r.played,
    ...(r.prize != null ? { prize: Number(r.prize) } : {}), synced: true });

  const isNetErr = e => !e || /fetch|network|Failed|timeout|ECONN|offline/i.test(String(e.message || e)) || e.status === 0;

  function status() {
    handlers.status({ enabled, user, pending: loadQ().length, lastSync, online: navigator.onLine });
  }

  // Polskie komunikaty dla typowych błędów logowania
  function plError(e) {
    const m = String(e?.message || e || '');
    if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy e-mail lub hasło.';
    if (/Email not confirmed/i.test(m)) return 'Potwierdź najpierw adres e-mail – kliknij link z wiadomości.';
    if (/already registered|already exists/i.test(m)) return 'Konto z tym adresem już istnieje. Zaloguj się.';
    if (/Password should be|weak/i.test(m)) return 'Hasło jest za słabe – użyj min. 8 znaków, w tym cyfry.';
    if (/rate limit|too many/i.test(m)) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.';
    if (/invalid.*email|Unable to validate email/i.test(m)) return 'Nieprawidłowy adres e-mail.';
    if (/duplicate key.*nick|profiles_nick_key/i.test(m)) return 'Ten pseudonim jest już zajęty.';
    if (/profiles_nick_check/i.test(m)) return 'Pseudonim: 3–20 znaków, litery, cyfry, _ . -';
    if (/groups_name_check/i.test(m)) return 'Nazwa grupy: 3–40 znaków.';
    if (isNetErr(e)) return 'Brak połączenia z serwerem. Sprawdź internet.';
    return m || 'Nieznany błąd.';
  }

  const redirectTo = () => location.origin + location.pathname;

  async function init(h) {
    Object.assign(handlers, h);
    if (!enabled) { status(); return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'typer.auth' },
    });
    sb.auth.onAuthStateChange((event, session) => {
      const prev = user?.id;
      user = session?.user || null;
      if (event === 'PASSWORD_RECOVERY') handlers.recovery();
      if (prev !== user?.id || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        // nie wołamy Supabase bezpośrednio w callbacku (zalecenie biblioteki)
        setTimeout(() => handlers.auth(user, event), 0);
      }
      status();
    });
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    status();
    window.addEventListener('online', () => { status(); flush(); });
    window.addEventListener('offline', status);
  }

  // ---------------------------------------------------------- konto
  async function signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
    if (error) throw new Error(plError(error));
    // Supabase przy istniejącym adresie zwraca użytkownika bez tożsamości (ochrona przed enumeracją)
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      throw new Error('Konto z tym adresem już istnieje. Zaloguj się.');
    return { needsConfirm: !data.session };
  }
  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(plError(error));
  }
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    if (error) throw new Error(plError(error));
  }
  async function updatePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(plError(error));
  }
  // Wylogowanie musi działać ZAWSZE – także bez internetu i przy zawieszonym zapytaniu.
  async function signOut() {
    // daj maks. 3 s na wysłanie zaległych zmian, potem wyloguj niezależnie od wyniku
    await Promise.race([flush().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    // powiadomienia: usuń adres tego urządzenia (maks. 3 s) – bez internetu wystarczy wypisanie u dostawcy
    await Promise.race([pushOffDevice().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    try {
      // scope 'local' usuwa sesję z tego urządzenia bez czekania na serwer
      await Promise.race([sb.auth.signOut({ scope: 'local' }), new Promise(r => setTimeout(r, 2000))]);
    } catch (e) { console.warn('signOut:', e); }
    // twarde czyszczenie, gdyby biblioteka nie usunęła sesji (np. błąd sieci)
    try { Object.keys(localStorage).filter(k => k.startsWith('typer.auth')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
    saveQ([]); lastSync = null;
    if (user) { user = null; handlers.auth(null, 'SIGNED_OUT'); }   // gdy biblioteka nie wysłała zdarzenia
    status();
  }
  async function deleteAccount() {
    const { error } = await sb.rpc('delete_my_account');   // usuwa też wszystkie adresy powiadomień konta
    if (error) throw new Error(plError(error));
    saveQ([]);
    if (window.TyperPush) await window.TyperPush.unsubscribeLocal().catch(() => {});
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    status();
  }
  async function getProfile() {
    const { data, error } = await sb.from('profiles').select('nick, created_at, public_ranking, plan, premium_until').eq('id', user.id).maybeSingle();
    if (error) throw new Error(plError(error));
    return data || {};
  }
  async function setNick(nick) {
    const { error } = await sb.from('profiles').update({ nick: nick || null }).eq('id', user.id);
    if (error) throw new Error(plError(error));
  }
  async function setPublicRanking(on) {
    const { error } = await sb.from('profiles').update({ public_ranking: !!on }).eq('id', user.id);
    if (error) throw new Error(plError(error));
  }

  // ---------------------------------------------------------- ranking i grupy (Etap 2)
  async function rpc(name, args) {
    if (!user) throw new Error('Zaloguj się.');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(plError(error));
    return data;
  }
  const ranking = (period, groupId) => rpc('ranking', { p_period: period, p_group: groupId || null });
  const myStats = period => rpc('my_stats', { p_period: period }).then(r => (Array.isArray(r) ? r[0] : r) || {});
  const myGroups = () => rpc('my_groups', {});
  const createGroup = name => rpc('create_group', { p_name: name });
  const joinGroup = code => rpc('join_group', { p_code: code });
  async function leaveGroup(groupId) {
    const { error } = await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
    if (error) throw new Error(plError(error));
  }
  async function deleteGroup(groupId) {
    const { error } = await sb.from('groups').delete().eq('id', groupId);
    if (error) throw new Error(plError(error));
  }

  // ---------------------------------------------------------- powiadomienia (Etap 4, krok 3)
  async function pushSave(sub, hide) {
    if (!user) throw new Error('Zaloguj się.');
    const j = sub.toJSON ? sub.toJSON() : sub;
    const { error } = await sb.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_hide: !!hide });
    if (error) throw new Error(plError(error));
  }
  async function pushDelete(endpoint) {
    if (!user || !endpoint) return;
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw new Error(plError(error));
  }
  const pushTest = () => rpc('push_test', {});
  // Wyłącza powiadomienia na tym urządzeniu: usuwa adres z bazy (gdy się da) i wypisuje u dostawcy.
  async function pushOffDevice() {
    const TP = window.TyperPush; if (!TP) return;
    const sub = await TP.current(); if (!sub) return;
    try { await pushDelete(sub.endpoint); } catch (e) { console.warn('push delete:', e); }
    await TP.unsubscribeLocal();
  }

  // ---------------------------------------------------------- zakłady
  // Kolejka działa też bez aktywnej sesji, jeśli na urządzeniu jest zalogowany właściciel (typer.owner) –
  // np. bez internetu sesja nie może się odświeżyć. Wyśle się po powrocie połączenia (flush wymaga sesji).
  const ownerKnown = () => { try { const v = JSON.parse(localStorage.getItem('typer.owner')); return !!v; } catch { return false; } };
  const canQueue = () => !!user || ownerKnown();
  function push(bet) { if (!canQueue()) return; const q = loadQ().filter(o => !(o.op === 'upsert' && o.bet.id === bet.id)); q.push({ op: 'upsert', bet }); saveQ(q); flush(); }
  function remove(id) { if (!canQueue()) return; const q = loadQ().filter(o => o.bet?.id !== id && o.id !== id); q.push({ op: 'delete', id }); saveQ(q); flush(); }

  function flush() {
    if (!user || !sb) return Promise.resolve();
    if (flushing) return flushing;
    flushing = (async () => {
      let q = loadQ();
      while (q.length && navigator.onLine !== false) {
        // zbiorczo: kolejne upserty w jednym zapytaniu
        const op = q[0];
        let n = 1, error;
        if (op.op === 'upsert') {
          while (n < q.length && n < 200 && q[n].op === 'upsert') n++;
          ({ error } = await sb.from('bets').upsert(q.slice(0, n).map(o => ({ ...toRow(o.bet), user_id: user.id })), { onConflict: 'user_id,id' }));
        } else {
          ({ error } = await sb.from('bets').delete().eq('user_id', user.id).eq('id', op.id));
        }
        if (error) {
          if (isNetErr(error) || error.status >= 500 || error.code === 'PGRST301') break;   // spróbujemy później
          console.warn('Pominięto zmianę odrzuconą przez serwer:', error.message);           // np. błędne dane
        }
        q = loadQ().slice(n); saveQ(q);
        if (!error) lastSync = new Date();
      }
      status();
    })().finally(() => { flushing = null; });
    return flushing;
  }

  /* Pełna synchronizacja: wysyła kolejkę, pobiera wszystko z chmury i łączy z lokalnymi.
     - lokalny zakład bez znacznika "synced" = nowy → wysyłamy,
     - lokalny ze znacznikiem, a nie ma go w chmurze = usunięty na innym urządzeniu → znika. */
  async function fullSync(localBets) {
    if (!user) return null;
    await flush();
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('bets').select('*').order('created_at', { ascending: false }).range(from, from + 999);
      if (error) throw new Error(plError(error));
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const remote = new Map(rows.map(r => [r.id, fromRow(r)]));
    const q0 = loadQ();
    q0.filter(o => o.op === 'delete').forEach(o => remote.delete(o.id));   // usunięte offline, jeszcze nie wysłane
    const pendingIds = new Set(q0.filter(o => o.op === 'upsert').map(o => o.bet.id));
    const fresh = [];
    for (const b of localBets) {
      if (remote.has(b.id)) continue;
      if (pendingIds.has(b.id)) { remote.set(b.id, b); continue; }
      if (!b.synced) fresh.push(b);
    }
    if (fresh.length) {
      fresh.forEach(b => { const q = loadQ(); q.push({ op: 'upsert', bet: b }); saveQ(q); remote.set(b.id, { ...b, synced: true }); });
      await flush();
    }
    lastSync = new Date(); status();
    return [...remote.values()].sort((a, b) => b.t.localeCompare(a.t));
  }

  return {
    get enabled() { return enabled; },
    get user() { return user; },
    init, signUp, signIn, signOut, resetPassword, updatePassword, deleteAccount, getProfile, setNick, setPublicRanking,
    ranking, myStats, myGroups, createGroup, joinGroup, leaveGroup, deleteGroup,
    pushSave, pushDelete, pushTest, pushOffDevice,
    push, remove, flush, fullSync, pending: () => loadQ().length,
  };
})();
