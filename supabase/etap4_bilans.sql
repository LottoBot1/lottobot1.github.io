-- Typer49 – Etap 4, bilans wydatków: kwota wygranej przy zakładzie (synchronizowana między urządzeniami).
-- Uruchom w Supabase: SQL Editor → wklej całość → Run. Skrypt jest idempotentny.
-- Uruchom PRZED publikacją nowej wersji aplikacji (aplikacja wysyła pole prize).
--
-- prize = kwota wygranej w zł wpisana przez użytkownika; null = nie wpisano.
-- To prywatne zestawienie użytkownika: nie wpływa na ranking ani na status „ranked”
-- (trigger bets_ranked zeruje go tylko przy zmianie liczb lub czasu zakładu).

alter table public.bets add column if not exists prize numeric(11, 2);

alter table public.bets drop constraint if exists bets_prize_check;
alter table public.bets add constraint bets_prize_check
  check (prize is null or (prize >= 0 and prize <= 999999999.99));
