-- Typer49 – schemat bazy danych (Supabase / PostgreSQL)
-- Uruchom w Supabase: SQL Editor → New query → wklej całość → Run.
-- Skrypt można uruchamiać wielokrotnie (jest idempotentny).

-- ---------------------------------------------------------------- profile
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nick       text unique check (nick is null or nick ~ '^[A-Za-z0-9_.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,20}$'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- zakłady
create table if not exists public.bets (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null check (length(id) between 4 and 40),
  created_at timestamptz not null,
  nums       smallint[] not null check (
               array_length(nums, 1) = 6
               and 1 <= all (nums) and 49 >= all (nums)
             ),
  method     text not null default 'manual' check (length(method) <= 20),
  base       text not null default 'lotto' check (base in ('lotto', 'lottoplus')),
  plus       boolean not null default false,
  played     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists bets_user_created_idx on public.bets (user_id, created_at desc);

-- ---------------------------------------------------------------- uprawnienia API (tylko zalogowani; RLS zawęża do własnych wierszy)
revoke all on public.profiles, public.bets from anon;
grant select, update            on public.profiles to authenticated;
grant select, insert, update, delete on public.bets to authenticated;

-- ---------------------------------------------------------------- RLS: każdy widzi tylko swoje dane
alter table public.profiles enable row level security;
alter table public.bets     enable row level security;

drop policy if exists "profil: odczyt własnego"     on public.profiles;
drop policy if exists "profil: zmiana własnego"     on public.profiles;
create policy "profil: odczyt własnego" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profil: zmiana własnego" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "zakłady: odczyt własnych"    on public.bets;
drop policy if exists "zakłady: dodawanie własnych" on public.bets;
drop policy if exists "zakłady: zmiana własnych"    on public.bets;
drop policy if exists "zakłady: usuwanie własnych"  on public.bets;
create policy "zakłady: odczyt własnych" on public.bets
  for select to authenticated using (user_id = (select auth.uid()));
create policy "zakłady: dodawanie własnych" on public.bets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "zakłady: zmiana własnych" on public.bets
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "zakłady: usuwanie własnych" on public.bets
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- limit: maks. 5000 zakładów na konto
create or replace function public.bets_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.bets where user_id = new.user_id) >= 5000 then
    raise exception 'Limit 5000 zakładów na konto';
  end if;
  return new;
end $$;
drop trigger if exists bets_limit_trg on public.bets;
create trigger bets_limit_trg before insert on public.bets
  for each row execute function public.bets_limit();

-- ---------------------------------------------------------------- automatyczny profil dla nowego konta
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- usunięcie konta przez użytkownika (RODO)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Brak zalogowanego użytkownika'; end if;
  delete from auth.users where id = auth.uid();   -- kaskadowo usuwa profil i zakłady
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
