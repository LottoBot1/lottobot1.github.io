-- Typer49 – Etap 4: TEST kolumny prize (nie zostawia żadnych danych – wszystko jest cofane).
-- Uruchom PRZED etap4_bilans.sql: test sam na chwilę dodaje kolumnę i cofa ją razem z danymi.
-- Na końcu ZAWSZE pojawi się czerwony komunikat
-- „WYNIK_TESTU {...}” – to celowe: błąd cofa wszystkie zmiany testu.
-- Oczekiwany wynik: wszystkie pola "ok_..." = true.
do $$
declare
  u   uuid := gen_random_uuid();
  t   timestamptz := now();
  res jsonb := '{}'::jsonb;
  r   boolean;
begin
  -- to samo co etap4_bilans.sql (cofane razem z testem)
  alter table public.bets add column if not exists prize numeric(11, 2);
  alter table public.bets drop constraint if exists bets_prize_check;
  alter table public.bets add constraint bets_prize_check
    check (prize is null or (prize >= 0 and prize <= 999999999.99));

  insert into auth.users (id, email, aud, role) values (u, 'test-bilans-' || u || '@example.invalid', 'authenticated', 'authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- świeży zakład wysłany od razu → liczy się do rankingu
  insert into public.bets (id, created_at, nums, method, base, plus, played)
  values ('test-bilans-1', t, '{1,2,3,4,5,6}', 'manual', 'lotto', false, true);
  select ranked into r from public.bets where id = 'test-bilans-1';
  res := res || jsonb_build_object('ok_nowy_zaklad_ranked', r);

  -- 1) dopisanie kwoty zwykłą zmianą
  update public.bets set prize = 35.00 where id = 'test-bilans-1';
  select ranked into r from public.bets where id = 'test-bilans-1';
  res := res || jsonb_build_object('ok_kwota_nie_odbiera_rankingu', r);

  -- 2) dokładnie tak, jak wysyła aplikacja (upsert całego wiersza z tymi samymi liczbami i czasem)
  insert into public.bets (id, created_at, nums, method, base, plus, played, prize, updated_at)
  values ('test-bilans-1', t, '{1,2,3,4,5,6}', 'manual', 'lotto', false, true, 40.50, now())
  on conflict (user_id, id) do update set
    created_at = excluded.created_at, nums = excluded.nums, method = excluded.method, base = excluded.base,
    plus = excluded.plus, played = excluded.played, prize = excluded.prize, updated_at = excluded.updated_at;
  select ranked into r from public.bets where id = 'test-bilans-1';
  res := res || jsonb_build_object('ok_upsert_z_kwota_nie_odbiera_rankingu', r);
  res := res || jsonb_build_object('ok_kwota_zapisana', (select prize = 40.50 from public.bets where id = 'test-bilans-1'));

  -- 3) usunięcie kwoty (powrót do podpowiedzi)
  update public.bets set prize = null where id = 'test-bilans-1';
  select ranked into r from public.bets where id = 'test-bilans-1';
  res := res || jsonb_build_object('ok_usuniecie_kwoty_nie_odbiera_rankingu', r);

  -- 4) kontrola: zmiana liczb nadal odbiera ranking (ochrona działa)
  update public.bets set nums = '{1,2,3,4,5,7}' where id = 'test-bilans-1';
  select ranked into r from public.bets where id = 'test-bilans-1';
  res := res || jsonb_build_object('ok_zmiana_liczb_odbiera_ranking', not r);

  -- 5) ujemna kwota jest odrzucana
  begin
    update public.bets set prize = -1 where id = 'test-bilans-1';
    res := res || jsonb_build_object('ok_ujemna_kwota_odrzucona', false);
  exception when check_violation then
    res := res || jsonb_build_object('ok_ujemna_kwota_odrzucona', true);
  end;

  raise exception 'WYNIK_TESTU %', res;
end $$;
