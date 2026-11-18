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
6. Poproś o wklejenie wyniku albo zrzut ekranu i wyjaśnij, co oznacza.
7. Nigdy nie zmieniaj ustawień bezpieczeństwa i nie usuwaj danych bez wyraźnej zgody właściciela.
