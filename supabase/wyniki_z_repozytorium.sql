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
