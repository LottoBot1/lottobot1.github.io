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
