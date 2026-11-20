-- Typer49 – Etap 4, krok 4: TEST „zakłady przeniesione z urządzenia nie liczą się do rankingu”
-- (nie zostawia żadnych danych – wszystko jest cofane). Uruchom PRZED etap4_logowanie.sql.
-- Środek pliku to dokładna kopia etap4_logowanie.sql. Test zapisuje zakłady jako fikcyjny zalogowany
-- użytkownik – tak jak robi to aplikacja – i sprawdza kolumnę ranked.
-- Na końcu ZAWSZE pojawi się czerwony komunikat „WYNIK_TESTU {...}” – to celowe: błąd cofa wszystkie zmiany testu.
-- Druga część sprawdza reguły dostępu (RLS) na dwóch fikcyjnych kontach A i B oraz jako osoba niezalogowana.
-- Każde sprawdzenie działa jako właściwa rola (anon albo authenticated z id fikcyjnego konta), nie jako postgres;
-- po każdej części test wraca do roli właściciela (reset role). Pola "kontrola_..." dowodzą, że przełączenie
-- roli działa (np. A widzi swój zakład) – bez nich pusty wynik niczego by nie dowodził.
-- Oczekiwany wynik: wszystkie pola "ok_..." i "kontrola_..." = true.
do $test$
declare
  u   uuid := gen_random_uuid();
  a   uuid := gen_random_uuid();
  b   uuid := gen_random_uuid();
  nb  text;
  n   int;
  rk  jsonb;
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
  perform set_config('request.jwt.claims', '', true);

  -- =========================================================== reguły dostępu (RLS)
  -- przygotowanie jako właściciel: konta A i B, B w rankingu publicznym pod pseudonimem,
  -- fikcyjne losowanie za minutę – zakłady B zapisane teraz zostaną z nim rozliczone (wszystko cofane na końcu)
  nb := 'TestB_' || left(replace(b::text, '-', ''), 8);
  insert into auth.users (id, email, aud, role) values
    (a, 'test-rls-a-' || a || '@example.invalid', 'authenticated', 'authenticated'),
    (b, 'test-rls-b-' || b || '@example.invalid', 'authenticated', 'authenticated');
  update public.profiles set nick = nb, public_ranking = true where id = b;
  insert into public.draws (game, no, draw_date, nums, draw_time)
  values ('lotto', 999999, current_date, '{1,2,3,40,41,42}', now() + interval '1 minute');

  -- ---------------------------------------------------------- jako B: trzy własne zakłady
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.bets (id, created_at, nums) values
    ('test-rls-b1', now(), '{1,2,3,4,5,6}'),
    ('test-rls-b2', now(), '{1,2,3,7,8,9}'),
    ('test-rls-b3', now(), '{10,11,12,13,14,15}');
  res := res || jsonb_build_object('kontrola_b_widzi_swoje_3_zaklady',
    (select count(*) = 3 from public.bets where user_id = b));
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------- jako A: swoje widzi, cudzych nie widzi i nie zmienia
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.bets (id, created_at, nums) values ('test-rls-a1', now(), '{20,21,22,23,24,25}');
  res := res || jsonb_build_object('kontrola_rola_a', current_user = 'authenticated' and auth.uid() = a);
  res := res || jsonb_build_object('kontrola_a_widzi_swoj_zaklad',
    exists (select 1 from public.bets where id = 'test-rls-a1'));
  res := res || jsonb_build_object('kontrola_a_widzi_swoj_profil',
    exists (select 1 from public.profiles where id = a));
  res := res || jsonb_build_object('ok_a_nie_widzi_zakladow_b',
    not exists (select 1 from public.bets where user_id = b));
  res := res || jsonb_build_object('ok_a_widzi_tylko_swoje_zaklady',
    not exists (select 1 from public.bets where user_id <> a));
  update public.bets set played = true, nums = '{1,2,3,4,5,7}' where user_id = b;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('ok_a_nie_zmienia_zakladow_b', n = 0);
  delete from public.bets where user_id = b;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('ok_a_nie_usuwa_zakladow_b', n = 0);
  begin
    insert into public.bets (user_id, id, created_at, nums) values (b, 'test-rls-podrzucony', now(), '{1,2,3,4,5,6}');
    res := res || jsonb_build_object('ok_a_nie_dopisze_zakladu_b', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_a_nie_dopisze_zakladu_b', true);
  end;
  res := res || jsonb_build_object('ok_a_nie_widzi_profilu_b',
    not exists (select 1 from public.profiles where id = b));
  update public.profiles set nick = 'Przejete_' || left(replace(a::text, '-', ''), 6) where id = b;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('ok_a_nie_zmienia_profilu_b', n = 0);
  -- ranking oglądany przez A: B jest na liście (kontrola), ale w żadnym wierszu nie ma e-maila
  begin
    select jsonb_agg(to_jsonb(r)) into rk from public.ranking('month', null) r;
    res := res || jsonb_build_object('kontrola_ranking_pokazuje_b',
      coalesce(rk @> jsonb_build_array(jsonb_build_object('nick', nb)), false));
    res := res || jsonb_build_object('ok_ranking_bez_emaili',
      coalesce(rk::text, '') not like '%@%' and coalesce(rk::text, '') not like '%example.invalid%');
  exception when others then
    res := res || jsonb_build_object('blad_rankingu', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------- jako właściciel: dane B nietknięte
  res := res || jsonb_build_object('ok_dane_b_nienaruszone',
    (select count(*) = 3 and bool_and(not played) from public.bets where user_id = b and id like 'test-rls-b%')
    and (select nums from public.bets where user_id = b and id = 'test-rls-b1') = '{1,2,3,4,5,6}'
    and not exists (select 1 from public.bets where id = 'test-rls-podrzucony')
    and (select nick from public.profiles where id = b) = nb);
  res := res || jsonb_build_object('ok_ranking_bez_kolumny_email',
    pg_get_function_result('public.ranking(text,uuid)'::regprocedure) not ilike '%mail%');

  -- ---------------------------------------------------------- jako niezalogowany (anon)
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  res := res || jsonb_build_object('kontrola_rola_anon', current_user = 'anon' and auth.uid() is null);
  res := res || jsonb_build_object('kontrola_anon_czyta_wyniki_losowan',
    exists (select 1 from public.draws where game = 'lotto'));
  begin
    select count(*) into n from public.bets;
    res := res || jsonb_build_object('ok_anon_nie_czyta_zakladow', n = 0);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_anon_nie_czyta_zakladow', true);
  end;
  begin
    insert into public.bets (user_id, id, created_at, nums) values (b, 'test-rls-anon', now(), '{1,2,3,4,5,6}');
    res := res || jsonb_build_object('ok_anon_nie_zapisuje_zakladow', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_anon_nie_zapisuje_zakladow', true);
  end;
  begin
    update public.bets set played = true where user_id = b;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('ok_anon_nie_zmienia_zakladow', n = 0);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_anon_nie_zmienia_zakladow', true);
  end;
  begin
    select count(*) into n from public.profiles;
    res := res || jsonb_build_object('ok_anon_nie_czyta_profili', n = 0);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_anon_nie_czyta_profili', true);
  end;
  begin
    perform 1 from public.ranking('month', null);
    res := res || jsonb_build_object('ok_anon_nie_widzi_rankingu', false);
  exception when insufficient_privilege or raise_exception then
    res := res || jsonb_build_object('ok_anon_nie_widzi_rankingu', true);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------- podsumowanie
  -- oczekiwane: liczba_pol = 29 (7 pól rankingu + 22 pola RLS), wszystkie_ok = true.
  -- wszystkie_ok wymaga też dokładnie 29 pól, więc brak któregoś sprawdzenia również daje false.
  n := (select count(*) from jsonb_object_keys(res) k where k like 'ok\_%' or k like 'kontrola\_%');
  res := res || jsonb_build_object('liczba_pol', n,
    'wszystkie_ok', n = 29
      and not res ? 'blad_rankingu'
      and not exists (select 1 from jsonb_each(res) e
                      where (e.key like 'ok\_%' or e.key like 'kontrola\_%') and e.value <> 'true'::jsonb));

  raise exception 'WYNIK_TESTU %', res;
end $test$;
