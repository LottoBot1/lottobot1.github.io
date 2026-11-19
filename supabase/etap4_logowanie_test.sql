-- Typer49 – Etap 4, krok 4: TEST „zakłady przeniesione z urządzenia nie liczą się do rankingu”
-- (nie zostawia żadnych danych – wszystko jest cofane). Uruchom PRZED etap4_logowanie.sql.
-- Środek pliku to dokładna kopia etap4_logowanie.sql. Test zapisuje zakłady jako fikcyjny zalogowany
-- użytkownik – tak jak robi to aplikacja – i sprawdza kolumnę ranked.
-- Na końcu ZAWSZE pojawi się czerwony komunikat „WYNIK_TESTU {...}” – to celowe: błąd cofa wszystkie zmiany testu.
-- Oczekiwany wynik: wszystkie pola "ok_..." = true.
do $test$
declare
  u   uuid := gen_random_uuid();
  res jsonb := '{}'::jsonb;
begin
  execute $ddl$
-- Typer49 – Etap 4, krok 4: zakłady przeniesione z urządzenia na konto nie liczą się do rankingu.
-- Uruchom w Supabase: SQL Editor → New query → wklej całość → Run. Skrypt jest idempotentny.
-- Kolejność: najpierw etap4_logowanie_test.sql (test, nic nie zostawia), potem ten plik.
--
-- Aplikacja przy przenoszeniu zakładów zapisanych bez konta nadaje im identyfikator z prefiksem „dev-”.
-- Dotąd o rankingu decydował tylko czas (zakład dotarł do bazy w ciągu ±15 min od zapisania), więc zakład
-- zapisany bez konta tuż przed założeniem konta mógłby trafić do rankingu. Teraz zakład „dev-…” nigdy nie jest
-- rankingowy. Prefiks może tylko WYŁĄCZYĆ ranking, nigdy go nie włącza – reszta zasad bez zmian.
create or replace function public.bets_ranked() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.ranked := new.id not like 'dev-%'
                  and new.created_at between now() - interval '15 minutes' and now() + interval '15 minutes';
  elsif new.nums is distinct from old.nums or new.created_at is distinct from old.created_at then
    new.ranked := false;
  else
    new.ranked := old.ranked;
  end if;
  return new;
end $$;
drop trigger if exists bets_ranked_trg on public.bets;
create trigger bets_ranked_trg before insert or update on public.bets
  for each row execute function public.bets_ranked();
  $ddl$;

  insert into auth.users (id, email, aud, role)
  values (u, 'test-logowanie-' || u || '@example.invalid', 'authenticated', 'authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.bets (id, created_at, nums, method, plus, played) values
    ('test-zwykly',        now(),                     '{1,2,3,4,5,6}',       'stat',   false, false),  -- zwykły zapis z konta
    ('dev-test-swiezy',    now() - interval '2 minutes', '{7,8,9,10,11,12}', 'stat',   false, true),   -- przeniesiony, świeży
    ('dev-test-stary',     now() - interval '10 days',   '{13,14,15,16,17,18}', 'manual', true, true),  -- przeniesiony, stary
    ('test-stary-import',  now() - interval '10 days',   '{19,20,21,22,23,24}', 'import', false, false); -- stary bez prefiksu

  res := res || jsonb_build_object('ok_zwykly_zaklad_w_rankingu',
    (select ranked from public.bets where user_id = u and id = 'test-zwykly'));
  res := res || jsonb_build_object('ok_przeniesiony_swiezy_poza_rankingiem',
    (select not ranked from public.bets where user_id = u and id = 'dev-test-swiezy'));
  res := res || jsonb_build_object('ok_przeniesiony_stary_poza_rankingiem',
    (select not ranked from public.bets where user_id = u and id = 'dev-test-stary'));
  res := res || jsonb_build_object('ok_stary_bez_prefiksu_poza_rankingiem',
    (select not ranked from public.bets where user_id = u and id = 'test-stary-import'));

  -- zmiana „Zagrany” nie włącza rankingu przeniesionemu zakładowi; zmiana liczb wyłącza go zwykłemu
  update public.bets set played = not played where user_id = u and id in ('dev-test-swiezy', 'test-zwykly');
  res := res || jsonb_build_object('ok_zmiana_zagrany_nie_wlacza_rankingu',
    (select not ranked from public.bets where user_id = u and id = 'dev-test-swiezy')
    and (select ranked from public.bets where user_id = u and id = 'test-zwykly'));
  update public.bets set nums = '{1,2,3,4,5,7}' where user_id = u and id = 'test-zwykly';
  res := res || jsonb_build_object('ok_zmiana_liczb_wylacza_ranking',
    (select not ranked from public.bets where user_id = u and id = 'test-zwykly'));

  -- użytkownik nie może sam ustawić ranked = true
  begin
    update public.bets set ranked = true where user_id = u and id = 'dev-test-stary';
    res := res || jsonb_build_object('ok_nie_da_sie_recznie_wlaczyc_rankingu',
      (select not ranked from public.bets where user_id = u and id = 'dev-test-stary'));
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_nie_da_sie_recznie_wlaczyc_rankingu', true);
  end;

  execute 'reset role';
  raise exception 'WYNIK_TESTU %', res;
end $test$;
