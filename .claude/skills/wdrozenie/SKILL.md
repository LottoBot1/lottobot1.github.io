---
name: wdrozenie
description: Użyj zawsze, gdy zmiany mają trafić na stronę Typer49 (commit, push na main, publikacja na GitHub Pages).
---
# Wdrożenie Typer49
1. Uruchom `git status`. Do commita trafia tylko to, co dotyczy bieżącego zadania.
2. Jeśli zmieniły się pliki aplikacji (index.html, app.css, app.js, cloud.js, config.js, manifest.webmanifest, icons/), podbij `VERSION` w sw.js.
3. Sprawdź składnię zmienionych plików JS (np. `node --check`, jeśli Node jest dostępny).
4. Każde nowe miejsce z `innerHTML` i danymi od użytkownika musi używać `esc()`.
5. Zrób commit jako lotto-bot, z opisem po polsku.
6. Uruchom `git pull` (automat sam dopisuje dane do `data/`), potem `git push`.
7. Śledź publikację: `gh run list --limit 1`, a potem `gh run watch <id>`.
8. Gdy publikacja się uda, napisz właścicielowi prostymi słowami, co ma sprawdzić na https://lottobot1.github.io/. Przypomnij, że na telefonie czasem trzeba zamknąć i ponownie otworzyć aplikację, żeby zobaczyć nową wersję.
9. Gdy publikacja się nie uda, nie poprawiaj na ślepo. Pokaż błąd, wyjaśnij go i zaproponuj rozwiązanie.
