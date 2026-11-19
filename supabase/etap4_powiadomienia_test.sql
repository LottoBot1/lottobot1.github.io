-- Typer49 – Etap 4, krok 3: TEST powiadomień (nie zostawia żadnych danych – wszystko jest cofane).
-- Uruchom PRZED etap4_powiadomienia.sql. Test sam na chwilę tworzy tabele i funkcje
-- (środek pliku to dokładna kopia etap4_powiadomienia.sql) i cofa je razem z danymi.
-- Na końcu ZAWSZE pojawi się czerwony komunikat „WYNIK_TESTU {...}” – to celowe: błąd cofa wszystkie zmiany testu.
-- Oczekiwany wynik: wszystkie pola "ok_..." = true. Próbne powiadomienie z testu nie zostanie wysłane (cofnięte).
do $test$
declare
  a   uuid := gen_random_uuid();
  b   uuid := gen_random_uuid();
  ep  text := 'https://fcm.googleapis.com/fcm/send/test-typer49-' || gen_random_uuid();
  ep2 text := 'https://updates.push.services.mozilla.com/wpush/v2/test-typer49-' || gen_random_uuid();
  k1  text := 'B' || repeat('x', 86);
  k2  text := repeat('a', 22);
  res jsonb := '{}'::jsonb;
  n   int;
begin
  execute $ddl$
-- Typer49 – Etap 4, krok 3, część A: powiadomienia po losowaniu (adresy urządzeń i próbne powiadomienie).
-- Uruchom w Supabase: SQL Editor → New query → wklej całość → Run. Skrypt jest idempotentny.
-- Kolejność: najpierw etap4_powiadomienia_test.sql (test, nic nie zostawia), potem ten plik,
-- potem funkcja „powiadomienia” (supabase/functions/powiadomienia/index.ts), na końcu nowa wersja aplikacji.
--
-- Zasady bezpieczeństwa:
--  - push_subscriptions: każdy widzi i usuwa tylko adresy swoich urządzeń; zapis tylko przez push_subscribe().
--  - Funkcję powiadomień uruchamia wyłącznie baza (pg_cron w części B i push_test() poniżej),
--    z hasłem z Vault. Hasło powstaje tutaj, losowo, i nigdy nie opuszcza bazy.
--  - Klucz service_role istnieje tylko wewnątrz funkcji Supabase (zmienna ustawiana przez Supabase).

create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ================================================================ adresy powiadomień urządzeń
-- endpoint = adres u dostawcy powiadomień (Google, Apple, Mozilla); p256dh/auth = klucze szyfrowania treści.
create table if not exists public.push_subscriptions (
  endpoint     text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  user_id      uuid not null references auth.users (id) on delete cascade,
  p256dh       text not null check (length(p256dh) between 20 and 200),
  auth         text not null check (length(auth) between 8 and 100),
  hide_details boolean not null default false,   -- „Ukryj szczegóły na zablokowanym ekranie”
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()  -- odświeżane przy otwarciu aplikacji (najwyżej raz dziennie)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
drop policy if exists "powiadomienia: odczyt własnych"   on public.push_subscriptions;
drop policy if exists "powiadomienia: usuwanie własnych" on public.push_subscriptions;
create policy "powiadomienia: odczyt własnych" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "powiadomienia: usuwanie własnych" on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

-- ================================================================ wysłane powiadomienia (bez duplikatów)
-- kind = 'test' (ref = 'ostatnie', pilnuje limitu 1/min) albo 'draw' (część B, ref = np. 'lotto:7123').
create table if not exists public.push_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind in ('test', 'draw')),
  ref     text not null check (length(ref) <= 40),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.push_sent enable row level security;   -- brak polityk = brak dostępu z aplikacji
revoke all on public.push_sent from anon, authenticated;

-- ================================================================ hasło, którym baza uruchamia funkcję
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'typer_push_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'typer_push_secret',
      'Typer49: hasło, którym baza uruchamia funkcję powiadomień');
  end if;
end $$;

-- Funkcja „powiadomienia” sprawdza otrzymane hasło tym zapytaniem (tylko z kluczem service_role).
create or replace function public.push_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_secret) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets where name = 'typer_push_secret' and decrypted_secret = p_secret);
$$;
revoke all on function public.push_secret_ok(text) from public, anon, authenticated;
grant execute on function public.push_secret_ok(text) to service_role;

-- ================================================================ zapis adresu tego urządzenia
-- Ten sam adres na wspólnym urządzeniu przechodzi na osobę, która jest teraz zalogowana.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_hide boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  if (select count(*) from public.push_subscriptions where user_id = auth.uid() and endpoint <> p_endpoint) >= 20 then
    raise exception 'Limit 20 urządzeń z powiadomieniami';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, hide_details)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, coalesce(p_hide, false))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        hide_details = excluded.hide_details, updated_at = now();
end $$;
revoke all on function public.push_subscribe(text, text, text, boolean) from public, anon;
grant execute on function public.push_subscribe(text, text, text, boolean) to authenticated;

-- ================================================================ próbne powiadomienie (najwyżej raz na minutę)
-- Wynik: 'ok' | 'brak_urzadzen' | 'za_czesto'. Wysyłka idzie w tle (pg_net), zwykle kilka sekund.
create or replace function public.push_test() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  secret text;
  allowed boolean;
begin
  if uid is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = uid) then return 'brak_urzadzen'; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'typer_push_secret';
  if secret is null then raise exception 'Brak hasła powiadomień w Vault'; end if;

  -- jeden wiersz na osobę; zmienia się tylko, gdy od poprzedniej próby minęła minuta (odporne na podwójne kliknięcie)
  insert into public.push_sent as s (user_id, kind, ref) values (uid, 'test', 'ostatnie')
  on conflict (user_id, kind, ref) do update set sent_at = now()
    where s.sent_at < now() - interval '1 minute'
  returning true into allowed;
  if allowed is null then return 'za_czesto'; end if;

  perform net.http_post(
    url := 'https://ydntwczvpzydwqqwhmof.supabase.co/functions/v1/powiadomienia',
    body := jsonb_build_object('mode', 'test', 'user_id', uid),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-typer-secret', secret),
    timeout_milliseconds := 15000);
  return 'ok';
end $$;
revoke all on function public.push_test() from public, anon;
grant execute on function public.push_test() to authenticated;

-- ================================================================ usuwanie konta: także wszystkie adresy powiadomień
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  delete from public.push_subscriptions where user_id = auth.uid();   -- jawnie (kaskada też by je usunęła)
  delete from auth.users where id = auth.uid();                        -- kaskadowo usuwa profil, zakłady i resztę
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ================================================================ sprzątanie
-- Adres urządzenia, które nie otworzyło aplikacji przez 180 dni, jest usuwany. Stare odpowiedzi pg_net Supabase czyści sam.
select cron.unschedule(jobid) from cron.job where jobname = 'typer-push-cleanup';
select cron.schedule('typer-push-cleanup', '17 3 * * *',
  $$delete from public.push_subscriptions where updated_at < now() - interval '180 days'$$);
  $ddl$;

  insert into auth.users (id, email, aud, role) values
    (a, 'test-push-a-' || a || '@example.invalid', 'authenticated', 'authenticated'),
    (b, 'test-push-b-' || b || '@example.invalid', 'authenticated', 'authenticated');

  -- ---------------------------------------------------------- osoba A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := res || jsonb_build_object('ok_proba_bez_urzadzen', public.push_test() = 'brak_urzadzen');
  perform public.push_subscribe(ep, k1, k2, false);
  res := res || jsonb_build_object('ok_a_widzi_swoj_adres', (select count(*) = 1 from public.push_subscriptions));
  res := res || jsonb_build_object('ok_pierwsza_proba_wyslana', public.push_test() = 'ok');
  res := res || jsonb_build_object('ok_druga_proba_w_minucie_odrzucona', public.push_test() = 'za_czesto');

  begin
    insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (ep2, a, k1, k2);
    res := res || jsonb_build_object('ok_zapis_tylko_przez_funkcje', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_zapis_tylko_przez_funkcje', true);
  end;
  begin
    perform count(*) from public.push_sent;
    res := res || jsonb_build_object('ok_brak_dostepu_do_wyslanych', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_brak_dostepu_do_wyslanych', true);
  end;
  begin
    perform public.push_secret_ok(repeat('0', 64));
    res := res || jsonb_build_object('ok_haslo_niedostepne_dla_uzytkownika', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_haslo_niedostepne_dla_uzytkownika', true);
  end;

  -- ---------------------------------------------------------- osoba B
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  res := res || jsonb_build_object('ok_b_nie_widzi_cudzych', (select count(*) = 0 from public.push_subscriptions));
  delete from public.push_subscriptions where endpoint = ep;
  get diagnostics n = row_count;
  res := res || jsonb_build_object('ok_b_nie_usunie_cudzego', n = 0);
  -- B loguje się na tym samym urządzeniu → adres przechodzi na B
  perform public.push_subscribe(ep, k1, k2, true);
  res := res || jsonb_build_object('ok_wspolne_urzadzenie_przechodzi_na_b',
    (select count(*) = 1 and bool_and(hide_details) from public.push_subscriptions));

  -- ---------------------------------------------------------- znowu A: drugie urządzenie i usunięcie konta
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  res := res || jsonb_build_object('ok_a_po_przejeciu_nie_widzi', (select count(*) = 0 from public.push_subscriptions));
  perform public.push_subscribe(ep2, k1, k2, false);
  delete from public.push_subscriptions where endpoint = ep2;          -- wyłączenie powiadomień na tym urządzeniu
  get diagnostics n = row_count;
  res := res || jsonb_build_object('ok_a_usuwa_swoj_adres', n = 1);
  perform public.push_subscribe(ep2, k1, k2, false);
  perform public.delete_my_account();

  execute 'reset role';
  res := res || jsonb_build_object('ok_usuniecie_konta_usuwa_adresy',
    not exists (select 1 from public.push_subscriptions where user_id = a));
  res := res || jsonb_build_object('ok_adres_b_zostaje', exists (select 1 from public.push_subscriptions where user_id = b));
  res := res || jsonb_build_object('ok_haslo_w_vault', exists (select 1 from vault.secrets where name = 'typer_push_secret'));
  res := res || jsonb_build_object('ok_haslo_sprawdzane',
    public.push_secret_ok((select decrypted_secret from vault.decrypted_secrets where name = 'typer_push_secret'))
    and not public.push_secret_ok(repeat('0', 64)));
  res := res || jsonb_build_object('ok_sprzatanie_w_harmonogramie', exists (select 1 from cron.job where jobname = 'typer-push-cleanup'));

  -- ---------------------------------------------------------- niezalogowany (klucz publiczny)
  execute 'set local role anon';
  begin
    perform count(*) from public.push_subscriptions;
    res := res || jsonb_build_object('ok_niezalogowany_nic_nie_widzi', false);
  exception when insufficient_privilege then
    res := res || jsonb_build_object('ok_niezalogowany_nic_nie_widzi', true);
  end;

  raise exception 'WYNIK_TESTU %', res;
end $test$;
