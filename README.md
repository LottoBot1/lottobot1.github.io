# Lotto Analizator 2.0

Aplikacja webowa (PWA) do Lotto i Lotto Plus. Działa w przeglądarce na komputerze i telefonie, można ją też zainstalować jak zwykłą aplikację.

## Co poprawiono względem wersji w Pythonie/Streamlit

| Problem w starej wersji | Rozwiązanie |
|---|---|
| Losowania się nie aktualizowały (API lotto.pl zwraca **403**, blokada botów) | Wyniki pobiera automat GitHub Actions ze źródła mbnet.com.pl po każdym losowaniu (wt/czw/sob) i jeszcze raz następnego dnia. Laptop nie musi być włączony. |
| Działało tylko na jednym laptopie | Strona na GitHub Pages: jeden adres, działa na każdym urządzeniu, także offline. |
| Baza CSV zapisywała same liczby, bez dat (deduplikacja „po liczbach” gubiła losowania) | Każde losowanie ma numer i datę, nowe są doklejane i nic nie jest kasowane. |
| Zakład był porównywany zawsze z *ostatnim* losowaniem | Zakład jest rozliczany z losowaniem, **na które został zagrany** (pierwszym po jego utworzeniu), osobno dla Lotto i Lotto Plus. |
| Ciężka sieć neuronowa (scikit-learn) | „Model trendu”: ważona częstość + zaległość, liczony od razu w telefonie. |

## Funkcje

- **Start:** odliczanie do losowania, ostatnie wyniki Lotto i Lotto Plus, podsumowanie zakładów, alert, gdy wynik się spóźnia.
- **Generator:** metody Statystyka (2 gorące + 2 zimne + 2 losowe), Model trendu, Losowo i Własne (wybór liczb palcem). Do tego 7 filtrów z poprzedniej wersji, które można włączać i wyłączać.
- **Statystyki:** mapa cieplna 1–49 (częstość, zaległość, ocena modelu), gorące, zimne i zaległe liczby, parzyste/nieparzyste, sumy, najczęstsze pary. Zakres: 50, 100, 250, 500 lub wszystkie losowania od 1957 r.
- **Zakłady:** status oczekujący lub rozliczony, podświetlone trafienia, przełącznik „Zagrany”, „Ponów” na kolejne losowanie, filtry.
- **Więcej:** sprawdzanie dowolnego kuponu (także na całej historii), eksport i import zakładów (w tym stary `user_bets.csv`), ręczne dodanie wyniku, instalacja na telefonie.

## Uruchomienie w internecie (jednorazowo, ok. 10 minut)

1. Załóż darmowe konto na <https://github.com> (jeśli nie masz).
2. Kliknij **New repository** i nazwij je np. `lotto`. Ustaw **Public** (darmowe GitHub Pages wymaga publicznego repozytorium). Repozytorium zawiera tylko kod i wyniki losowań, a Twoje zakłady zostają w przeglądarce.
3. Na stronie nowego repozytorium wybierz **„uploading an existing file”** i przeciągnij **całą zawartość** folderu `Analizator LOTTO` (razem z folderami `.github`, `data`, `icons`, `scripts`). Kliknij **Commit changes**.
   > Windows ukrywa folder `.github`. Jeśli go nie widać, przeciągnij cały folder albo w Eksploratorze włącz *Widok → Elementy ukryte*.
   > Jeśli przeglądarka nie wgra folderu `.github`, w repozytorium wybierz **Add file → Create new file**, wpisz nazwę `.github/workflows/update-data.yml` i wklej zawartość tego pliku.
4. Wejdź w **Settings → Pages**, w polu *Source* wybierz **GitHub Actions**.
5. Wejdź w **Actions**, zaakceptuj uruchamianie workflowów, wybierz *Aktualizacja wyników i publikacja* i kliknij **Run workflow**.
6. Po 1–2 minutach aplikacja będzie dostępna pod adresem `https://TWOJA-NAZWA.github.io/lotto/`.

Od tej chwili automat sam pobiera wyniki po każdym losowaniu i publikuje stronę.

## Instalacja na telefonie

Otwórz adres strony na telefonie, a następnie:
- **Android (Chrome):** menu ⋮ → *Zainstaluj aplikację* / *Dodaj do ekranu głównego*
- **iPhone (Safari):** *Udostępnij* → *Do ekranu początkowego*

## Twoje zakłady na kilku urządzeniach

Zakłady zapisują się w pamięci przeglądarki na danym urządzeniu. Żeby je przenieść, użyj *Więcej → Eksportuj* (plik `.json`), a na drugim urządzeniu *Więcej → Importuj*. Import łączy dane bez duplikatów. Tak samo wczytasz stary plik `user_bets.csv`.

## Lokalny podgląd (opcjonalnie)

Aplikacja potrzebuje serwera HTTP, bo otwarta dwuklikiem z dysku nie wczyta danych. Z Pythonem wystarczy:

```bash
python -m http.server 8000
```

i wejście na <http://localhost:8000>. Ręczna aktualizacja danych: `python scripts/update_data.py`.

## Struktura

```
index.html, app.css, app.js   – aplikacja
sw.js, manifest.webmanifest   – tryb offline i instalacja (PWA)
data/lotto.json               – wyniki Lotto od 1957 r.
data/lottoplus.json           – wyniki Lotto Plus od 2012 r.
scripts/update_data.py        – pobieranie wyników (bez dodatkowych bibliotek)
.github/workflows/            – harmonogram automatu i publikacja na GitHub Pages
```

> Losowania Lotto są całkowicie losowe. Żadna statystyka ani model nie zwiększa szansy wygranej. Graj odpowiedzialnie, 18+.
