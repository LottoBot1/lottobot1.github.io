-- Typer49 – TEST zapasowego pobierania wyników z repozytorium (nie zostawia żadnych danych – wszystko jest cofane).
-- Uruchom PRZED wyniki_z_repozytorium.sql. Środek pliku to dokładna kopia wyniki_z_repozytorium.sql.
-- Test dopisuje fikcyjne odpowiedzi serwera i fikcyjne losowania (rok 2099), sprawdza wynik i wszystko cofa.
-- Żadne zapytanie do GitHuba nie zostanie wysłane (kolejka pg_net też jest cofana).
-- Na końcu ZAWSZE pojawi się czerwony komunikat „WYNIK_TESTU {...}” – to celowe: błąd cofa wszystkie zmiany testu.
-- Oczekiwany wynik: wszystkie pola "ok_..." = true.
do $test$
declare
  res   jsonb := '{}'::jsonb;
  l     record;         -- ostatnie prawdziwe losowanie Lotto w bazie
  s     timestamptz;    -- następne losowanie według terminarza
  cand  timestamptz;
  n0    int;
  n     int;
begin
  execute $ddl$
-- Typer49 – zapasowe pobieranie wyników przez bazę prosto z repozytorium na GitHubie (20.11.2026).
-- Uruchom w Supabase: SQL Editor → New query → wklej całość → Run. Skrypt jest idempotentny.
-- Kolejność: najpierw wyniki_z_repozytorium_test.sql (test, nic nie zostawia), potem ten plik.
--
-- Powód: 19.11.2026 automat GitHuba pobrał wyniki do repozytorium o 22:47, ale publikacja strony się nie udała,
-- więc baza (która czyta stronę) nie miała wyników do ręcznego uruchomienia automatu.
-- Teraz: gdy według terminarza (wt/czw/sob 22:00 czasu polskiego) losowanie już się odbyło, a w bazie go nie ma,
-- baza pobiera te same pliki także z repozytorium (raw.githubusercontent.com, gałąź main).
-- Łączenie bez zmian (process_draws): tylko po numerze losowania – dopisywane są wyłącznie numery większe od
-- ostatniego w bazie, istniejące nigdy nie są nadpisywane. Nigdy po dacie.

-- Godzina losowania danego dnia: 22:00 czasu polskiego (strefa Europe/Warsaw – zimą UTC+1, latem UTC+2),
-- tak samo jak w process_draws().
create or replace function public.draw_time_pl(p_day date) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_day + time '22:00') at time zone 'Europe/Warsaw';
$$;
revoke all on function public.draw_time_pl(date) from public, anon, authenticated;

-- Czy według terminarza powinno już być losowanie Lotto, którego nie ma w bazie.
-- Patrzy na terminarz z ostatnich 3 dni (zawsze jest w nim co najmniej jedno losowanie: najdłuższa przerwa sob→wt
-- to 3 dni), więc przy dłuższej awarii nadal wykrywa brak, a import uzupełnia wszystkie brakujące numery.
create or replace function public.draw_missing(p_at timestamptz default now()) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(max(s.t), '-infinity'::timestamptz)
       > coalesce((select max(d.draw_time) from public.draws d where d.game = 'lotto'), '-infinity'::timestamptz)
  from (
    select public.draw_time_pl(g::date) as t
    from generate_series((p_at at time zone 'Europe/Warsaw')::date - 3,
                         (p_at at time zone 'Europe/Warsaw')::date, interval '1 day') g
    where extract(isodow from g) in (2, 4, 6)
  ) s
  where s.t <= p_at;
$$;
revoke all on function public.draw_missing(timestamptz) from public, anon, authenticated;

-- Pobranie wyników: zawsze ze strony, a przy brakującym losowaniu także z repozytorium.
-- p_at tylko do testów; zadania cron wołają request_draws() bez argumentu.
drop function if exists public.request_draws();
create or replace function public.request_draws(p_at timestamptz default now()) returns void
language plpgsql security definer set search_path = '' as $$
declare t text := extract(epoch from now())::bigint::text;
begin
  insert into public.draw_import_requests (id, game) values
    (net.http_get(url => 'https://lottobot1.github.io/data/lotto.json',     params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lotto'),
    (net.http_get(url => 'https://lottobot1.github.io/data/lottoplus.json', params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lottoplus');
  if public.draw_missing(p_at) then
    insert into public.draw_import_requests (id, game) values
      (net.http_get(url => 'https://raw.githubusercontent.com/LottoBot1/lottobot1.github.io/main/data/lotto.json',     params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lotto'),
      (net.http_get(url => 'https://raw.githubusercontent.com/LottoBot1/lottobot1.github.io/main/data/lottoplus.json', params => jsonb_build_object('t', t), timeout_milliseconds => 30000), 'lottoplus');
  end if;
end $$;
revoke all on function public.request_draws(timestamptz) from public, anon, authenticated;
  $ddl$;

  select d.no, d.draw_date, d.draw_time, d.nums into l
  from public.draws d where d.game = 'lotto' order by d.draw_time desc limit 1;
  for i in 1..7 loop
    cand := (((l.draw_time at time zone 'Europe/Warsaw')::date + i) + time '22:00') at time zone 'Europe/Warsaw';
    if extract(isodow from cand at time zone 'Europe/Warsaw') in (2, 4, 6) then s := cand; exit; end if;
  end loop;

  -- ---------------------------------------------------------- kiedy losowania „brakuje”
  res := res || jsonb_build_object('ok_po_ostatnim_losowaniu_nic_nie_brakuje', not public.draw_missing(l.draw_time + interval '1 hour'));
  res := res || jsonb_build_object('ok_przed_nastepnym_losowaniem_nic_nie_brakuje', not public.draw_missing(s - interval '30 minutes'));
  res := res || jsonb_build_object('ok_po_nastepnym_losowaniu_brakuje', public.draw_missing(s + interval '30 minutes'));
  res := res || jsonb_build_object('ok_dluga_awaria_nadal_brakuje', public.draw_missing(s + interval '5 days')
                                                                   and public.draw_missing(s + interval '9 days'));

  -- ---------------------------------------------------------- 22:00 czasu polskiego: strefa Europe/Warsaw, nie stałe +01:00
  res := res || jsonb_build_object('ok_zima_22_pl_to_21_utc', public.draw_time_pl(date '2026-11-17') = timestamptz '2026-11-17 21:00:00+00');
  res := res || jsonb_build_object('ok_lato_22_pl_to_20_utc', public.draw_time_pl(date '2026-07-14') = timestamptz '2026-07-14 20:00:00+00');
  res := res || jsonb_build_object('ok_dzien_zmiany_na_letni', public.draw_time_pl(date '2026-03-29') = timestamptz '2026-03-29 20:00:00+00'
                                                              and public.draw_time_pl(date '2026-03-28') = timestamptz '2026-03-28 21:00:00+00');
  res := res || jsonb_build_object('ok_dzien_zmiany_na_zimowy', public.draw_time_pl(date '2026-10-25') = timestamptz '2026-10-25 21:00:00+00'
                                                               and public.draw_time_pl(date '2026-10-24') = timestamptz '2026-10-24 20:00:00+00');
  res := res || jsonb_build_object('ok_ta_sama_godzina_co_import', public.draw_time_pl(l.draw_date) = l.draw_time);

  -- ---------------------------------------------------------- ile pobrań
  select count(*) into n0 from public.draw_import_requests;
  perform public.request_draws(l.draw_time + interval '1 hour');
  select count(*) into n from public.draw_import_requests;
  res := res || jsonb_build_object('ok_baza_aktualna_2_pobrania_ze_strony', n - n0 = 2);
  n0 := n;
  perform public.request_draws(s + interval '30 minutes');
  select count(*) into n from public.draw_import_requests;
  res := res || jsonb_build_object('ok_brak_losowania_4_pobrania_strona_i_repozytorium', n - n0 = 4);
  res := res || jsonb_build_object('ok_cron_wola_bez_argumentu', exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'request_draws' and p.pronargdefaults = 1));

  -- ---------------------------------------------------------- łączenie tylko po numerze
  -- fikcyjna odpowiedź „z repozytorium”: istniejący numer z inną datą i liczbami (nie może niczego zmienić),
  -- nowy numer (dopisany) i kolejny nowy numer z tą samą datą co poprzedni (też dopisany – liczy się numer, nie data)
  begin
    delete from public.draw_import_requests;
    insert into public.draw_import_requests (id, game) values (-900001, 'lotto');
    insert into net._http_response (id, status_code, content)
    values (-900001, 200, json_build_object('draws', json_build_array(
      json_build_array(l.no,     '1999-01-01', json_build_array(1, 2, 3, 4, 5, 6)),
      json_build_array(l.no + 1, '2099-01-01', json_build_array(7, 8, 9, 10, 11, 12)),
      json_build_array(l.no + 2, '2099-01-01', json_build_array(13, 14, 15, 16, 17, 18))))::text);
    n := public.process_draws();
    res := res || jsonb_build_object('ok_dopisane_tylko_nowe_numery', n = 2);
    res := res || jsonb_build_object('ok_istniejace_losowanie_bez_zmian', exists (
      select 1 from public.draws d where d.game = 'lotto' and d.no = l.no and d.draw_date = l.draw_date and d.nums = l.nums));
    res := res || jsonb_build_object('ok_ta_sama_data_rozne_numery_oba_dopisane',
      (select count(*) = 2 from public.draws d where d.game = 'lotto' and d.draw_date = date '2099-01-01'));
    res := res || jsonb_build_object('ok_odpowiedz_przetworzona_i_usunieta',
      not exists (select 1 from public.draw_import_requests where id = -900001));
  exception when insufficient_privilege then
    res := res || jsonb_build_object('uwaga_test_laczenia_pominiety', 'brak uprawnień do tabeli odpowiedzi pg_net');
  end;

  raise exception 'WYNIK_TESTU %', res;
end $test$;
