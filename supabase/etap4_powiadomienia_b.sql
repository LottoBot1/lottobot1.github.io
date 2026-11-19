-- Typer49 – Etap 4, krok 3, część B: automatyczne powiadomienia po losowaniu.
-- Uruchom w Supabase: SQL Editor → New query → wklej całość → Run. Skrypt jest idempotentny.
-- Wymaga: schema.sql, stage2.sql, etap4_powiadomienia.sql (część A).
-- Kolejność: najpierw etap4_powiadomienia_b_test.sql (test, nic nie zostawia), potem nowa wersja funkcji
-- „powiadomienia” (supabase/functions/powiadomienia/index.ts – tryb 'draw'), na końcu ten plik.
--
-- Jak to działa:
--  1. W noce losowań (wt/czw/sob 22:00–2:00 czasu polskiego) baza pobiera wyniki co 10 min (w dzień jak dotąd co 30).
--  2. Po każdym pobraniu push_draw_check() sprawdza, czy jest nowe losowanie Lotto (najwyżej 12 h od losowania)
--     i czy są już wyniki Lotto Plus z tego dnia (albo minęły 3 h). Jeśli tak – raz uruchamia funkcję powiadomień.
--  3. Funkcja pobiera listę z push_draw_targets(): tylko osoby, które mają zakład na to losowanie
--     (ta sama zasada przypisania co w rankingu – pierwsze losowanie po zapisaniu zakładu), ale liczą się
--     wszystkie zakłady, nie tylko rankingowe. Każda osoba dostaje najwyżej jedno powiadomienie na losowanie (push_sent).
--  4. Dziennik push_runs (bez danych osobowych): kiedy, ile wysłano, czy był błąd. Strażnik czyta go przez
--     push_health() kluczem publicznym (widzi tylko liczby i „był błąd: tak/nie”).

-- ================================================================ dziennik wysyłek
create table if not exists public.push_runs (
  ref         text primary key check (length(ref) <= 40),   -- np. 'lotto:7123'
  draw_date   date not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  attempts    int not null default 1,
  users       int,
  sent        int,
  failed      int,
  removed     int,
  error       text check (length(error) <= 1000)
);
alter table public.push_runs enable row level security;   -- brak polityk = brak dostępu z aplikacji
revoke all on public.push_runs from anon, authenticated;

-- ================================================================ komu i co wysłać
-- Jeden wiersz na adres urządzenia osoby, która ma zakład na losowanie Lotto nr p_no i jeszcze nie dostała
-- powiadomienia o nim. played_best / saved_best = najlepsze trafienie (Lotto albo Lotto Plus, jak w rankingu)
-- wśród zakładów „Zagrany” / tylko zapisanych; *_plus = czy to najlepsze trafienie padło w Lotto Plus.
create or replace function public.push_draw_targets(p_no int)
returns table (user_id uuid, endpoint text, p256dh text, auth text, hide_details boolean,
               played_count int, played_best int, played_plus boolean,
               saved_count int, saved_best int, saved_plus boolean)
language sql stable security definer set search_path = '' as $$
  with d as (
    select dl.draw_date, dl.draw_time, dl.nums,
           (select p.draw_time from public.draws p
             where p.game = 'lotto' and p.draw_time < dl.draw_time order by p.draw_time desc limit 1) as prev_time,
           (select pp.nums from public.draws pp where pp.game = 'lottoplus' and pp.draw_date = dl.draw_date limit 1) as plus_nums
    from public.draws dl where dl.game = 'lotto' and dl.no = p_no
  ),
  hits as (
    -- zakład należy do losowania d ⇔ prev_time <= created_at < draw_time (= pierwsze losowanie po zapisaniu, bet_results)
    select b.user_id, b.played,
           (select count(*) from unnest(b.nums) x where x = any (d.nums))::int as hl,
           case when b.plus and d.plus_nums is not null
                then (select count(*) from unnest(b.nums) x where x = any (d.plus_nums))::int else 0 end as hp
    from d join public.bets b
      on b.created_at < d.draw_time and (d.prev_time is null or b.created_at >= d.prev_time)
  ),
  per_user as (
    select h.user_id,
           count(*) filter (where h.played)::int                              as played_count,
           coalesce(max(greatest(h.hl, h.hp)) filter (where h.played), 0)     as played_best,
           coalesce(max(h.hl) filter (where h.played), 0)                     as played_best_lotto,
           count(*) filter (where not h.played)::int                          as saved_count,
           coalesce(max(greatest(h.hl, h.hp)) filter (where not h.played), 0) as saved_best,
           coalesce(max(h.hl) filter (where not h.played), 0)                 as saved_best_lotto
    from hits h group by h.user_id
  ),
  -- „w Lotto Plus” tylko wtedy, gdy najlepsze trafienie padło wyłącznie w Plus (w Lotto było mniej)
  labeled as (
    select u.*, u.played_best_lotto < u.played_best as played_plus, u.saved_best_lotto < u.saved_best as saved_plus
    from per_user u
  )
  select l.user_id, s.endpoint, s.p256dh, s.auth, s.hide_details,
         l.played_count, l.played_best, l.played_plus, l.saved_count, l.saved_best, l.saved_plus
  from labeled l
  join public.push_subscriptions s on s.user_id = l.user_id
  where not exists (select 1 from public.push_sent ps
                    where ps.user_id = l.user_id and ps.kind = 'draw' and ps.ref = 'lotto:' || p_no)
  order by l.user_id;
$$;
revoke all on function public.push_draw_targets(int) from public, anon, authenticated;
grant execute on function public.push_draw_targets(int) to service_role;

-- ================================================================ czy uruchomić wysyłkę
-- Wynik (dla podglądu w SQL Editor): 'brak_losowania' | 'za_stare' | 'czeka_na_plus' | 'juz_uruchomione' | 'uruchomiono'.
-- Ponowna próba (najwyżej 3 razy), gdy poprzednia zakończyła się błędem albo nie skończyła się w 20 min.
-- Funkcja powiadomień jest odporna na powtórki – nikt nie dostanie dwóch powiadomień o tym samym losowaniu.
create or replace function public.push_draw_check() returns text
language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_ref text;
  secret text;
  n int;
begin
  select dr.no, dr.draw_date, dr.draw_time into d
  from public.draws dr where dr.game = 'lotto' order by dr.draw_time desc limit 1;
  if d.no is null then return 'brak_losowania'; end if;
  if d.draw_time < now() - interval '12 hours' or d.draw_time > now() then return 'za_stare'; end if;
  if not exists (select 1 from public.draws p where p.game = 'lottoplus' and p.draw_date = d.draw_date)
     and now() < d.draw_time + interval '3 hours' then
    return 'czeka_na_plus';
  end if;

  v_ref := 'lotto:' || d.no;
  insert into public.push_runs as r (ref, draw_date) values (v_ref, d.draw_date)
  on conflict (ref) do update
    set attempts = r.attempts + 1, started_at = now(), finished_at = null, error = null,
        users = null, sent = null, failed = null, removed = null
    where r.attempts < 3
      and (r.error is not null or (r.finished_at is null and r.started_at < now() - interval '20 minutes'))
  returning r.attempts into n;
  if n is null then return 'juz_uruchomione'; end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'typer_push_secret';
  if secret is null then
    update public.push_runs set error = 'Brak hasła powiadomień w Vault', finished_at = now() where ref = v_ref;
    return 'brak_hasla';
  end if;
  perform net.http_post(
    url := 'https://ydntwczvpzydwqqwhmof.supabase.co/functions/v1/powiadomienia',
    body := jsonb_build_object('mode', 'draw', 'no', d.no, 'date', d.draw_date),
    -- x-region: funkcja działa we Frankfurcie, jak baza (privacy.html, pkt 5)
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-typer-secret', secret, 'x-region', 'eu-central-1'),
    timeout_milliseconds := 120000);
  return 'uruchomiono';
end $$;
revoke all on function public.push_draw_check() from public, anon, authenticated;

-- ================================================================ stan dla Strażnika (klucz publiczny)
-- Tylko liczby i „był błąd: tak/nie” – bez treści błędu, adresów i danych osób.
create or replace function public.push_health()
returns table (draw_no int, draw_date date, draw_time timestamptz,
               started_at timestamptz, finished_at timestamptz, attempts int,
               users int, sent int, failed int, has_error boolean)
language sql stable security definer set search_path = '' as $$
  select d.no, d.draw_date, d.draw_time, r.started_at, r.finished_at, r.attempts,
         r.users, r.sent, r.failed, r.error is not null
  from (select dr.no, dr.draw_date, dr.draw_time from public.draws dr
         where dr.game = 'lotto' order by dr.draw_time desc limit 1) d
  left join public.push_runs r on r.ref = 'lotto:' || d.no;
$$;
revoke all on function public.push_health() from public;
grant execute on function public.push_health() to anon, authenticated;

-- ================================================================ noce losowań: wyniki co 10 min i wysyłka
-- pg_cron liczy w UTC, więc harmonogram obejmuje szersze okno, a funkcja sama sprawdza czas polski
-- (wt/czw/sob od 22:00 do 2:00 następnego dnia; zmiana czasu letni/zimowy obsłużona przez 'Europe/Warsaw').
create or replace function public.draw_night(p_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select (extract(isodow from p_at at time zone 'Europe/Warsaw') in (2, 4, 6)
          and (p_at at time zone 'Europe/Warsaw')::time >= time '22:00')
      or (extract(isodow from p_at at time zone 'Europe/Warsaw') in (3, 5, 7)
          and (p_at at time zone 'Europe/Warsaw')::time <  time '02:00');
$$;
revoke all on function public.draw_night(timestamptz) from public, anon, authenticated;

create or replace function public.draws_night_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.draw_night(now()) then return; end if;
  perform public.process_draws();    -- odpowiedzi z poprzedniego pobrania
  perform public.push_draw_check();  -- nowe losowanie? → powiadomienia
  perform public.request_draws();    -- nowe pobranie (odpowiedź przetworzy następne wywołanie)
end $$;
revoke all on function public.draws_night_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('typer-draws-night-a', 'typer-draws-night-b', 'typer-push-check');
-- minuty 2,12,…,52 – nie kolidują z dziennymi zadaniami (5,35 pobranie; 10,40 przetworzenie)
select cron.schedule('typer-draws-night-a', '2,12,22,32,42,52 19-23 * * 2,4,6', 'select public.draws_night_tick()');
select cron.schedule('typer-draws-night-b', '2,12,22,32,42,52 0-1 * * 3,5,0',   'select public.draws_night_tick()');
-- przez cały czas, po dziennym przetworzeniu: wyniki, które przyszły później (np. rano), i ponowne próby
select cron.schedule('typer-push-check', '12,42 * * * *', 'select public.push_draw_check()');

-- ================================================================ sprzątanie dziennika (bez danych osobowych, 1 rok)
select cron.unschedule(jobid) from cron.job where jobname = 'typer-push-runs-cleanup';
select cron.schedule('typer-push-runs-cleanup', '27 3 * * 1',
  $$delete from public.push_runs where started_at < now() - interval '365 days'$$);
