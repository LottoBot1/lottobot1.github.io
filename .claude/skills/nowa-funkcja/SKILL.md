---
name: nowa-funkcja
description: Użyj, gdy właściciel prosi o nową funkcję lub większą zmianę w Typer49.
---
# Nowa funkcja
1. Sprawdź w CLAUDE.md sekcję „Kolejność prac”. Jeśli funkcja nie pasuje do bieżącego etapu, powiedz to właścicielowi i zapytaj, czy na pewno teraz.
2. Przedstaw plan prostymi słowami: co zobaczy użytkownik, które pliki się zmienią, jakie są ryzyka i czy funkcja ma być darmowa czy Premium (`data-premium`). Poczekaj na zgodę.
3. Zrób commit przed rozpoczęciem pracy.
4. Pilnuj zasad: aplikacja działa offline i bez Supabase, dane użytkownika przechodzą przez `esc()`, żadnych obietnic zwiększenia szansy wygranej, wszystkie teksty po polsku.
5. Jeśli funkcja zawiera logikę (daty, liczby, rozliczenia), napisz do niej test.
6. Zaktualizuj w CLAUDE.md sekcję „Stan projektu”.
7. Wdróż według skilla `wdrozenie`.
