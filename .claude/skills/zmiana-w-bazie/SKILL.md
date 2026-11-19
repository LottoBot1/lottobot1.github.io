---
name: zmiana-w-bazie
description: Użyj przy każdej zmianie w bazie Supabase Typer49 (tabele, funkcje, RLS, cron, ranking, rozliczanie zakładów).
---
# Zmiana w bazie Supabase
1. Opisz właścicielowi prostymi słowami, co zmienisz i dlaczego. Poczekaj na zgodę.
2. Zapisz zmianę jako nowy plik SQL w `supabase/`. Plik ma być idempotentny (`create or replace`, `if not exists`), żeby dało się go uruchomić ponownie bez szkody.
3. Jeśli zmienia się logika rozliczania zakładów (`bet_results`), zmień też `evalBet` w app.js. Obie muszą działać tak samo.
4. Przygotuj osobny blok testowy według metody z CLAUDE.md (`do $$ … raise exception 'WYNIK_TESTU %' … $$`), żeby test nie zostawił danych.
5. Podaj właścicielowi instrukcję krok po kroku: wejdź na supabase.com, otwórz projekt, kliknij SQL Editor, potem New query, wklej kod, kliknij Run. Opisz, co powinien zobaczyć. Najpierw test, potem właściwa zmiana.
   Claude Code może sam uruchamiać SQL w Supabase przez przeglądarkę, ale przed każdym kliknięciem Run pokazuje właścicielowi, co uruchomi, i czeka na jego zgodę. Najpierw zawsze test, potem właściwa zmiana. (Przeglądarka w aplikacji Claude ma osobne logowanie – jeśli Supabase prosi o zalogowanie, poproś o to właściciela; haseł nie wpisujesz sam.)
6. Poproś o wklejenie wyniku albo zrzut ekranu i wyjaśnij, co oznacza. Gdy uruchamiasz SQL sam, odczytaj wynik ze strony i pokaż go właścicielowi.
7. Nigdy nie zmieniaj ustawień bezpieczeństwa i nie usuwaj danych bez wyraźnej zgody właściciela.
