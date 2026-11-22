# Typer49

Aplikacja webowa (PWA) do analizy gier liczbowych 6/49 (Lotto i Lotto Plus). Działa w przeglądarce na komputerze i telefonie, można ją też zainstalować jak zwykłą aplikację. Adres: <https://lottobot1.github.io/>

## Konta użytkowników

- Logowanie e-mailem i hasłem, a zakłady synchronizują się w chmurze między urządzeniami. Aplikacja działa też offline, a zmiany wysyłają się po odzyskaniu internetu.
- Backend: Supabase (projekt `typer49`, Europa). Schemat bazy i reguły bezpieczeństwa są w [`supabase/schema.sql`](supabase/schema.sql), a każdy użytkownik widzi tylko swoje dane.
- `config.js` zawiera **publiczny** klucz Supabase (anon). Klucza `service_role` nigdy nie wpisujemy do kodu.
- E-maile (potwierdzenie konta, reset hasła) wychodzą z typer49.kontakt@gmail.com przez SMTP Gmaila, uwierzytelnione hasłem aplikacji.
- Automat GitHub raz dziennie „budzi” bazę, bo darmowy Supabase usypia projekt po 7 dniach bez ruchu.

## Ranking, grupy i Premium

- Schemat jest w [`supabase/stage2.sql`](supabase/stage2.sql).
- **Losowania w bazie:** pg_cron i pg_net co 30 min pobierają `data/*.json` z GitHub Pages do tabeli `draws`.
- **Ranking:** średnia trafień na rozliczony zakład, w okresach 7 dni, 30 dni i zawsze. W rankingu globalnym są tylko osoby z pseudonimem i włączoną widocznością, które mają min. 3 zakłady.
- **Ochrona przed oszustwami:** kolumnę `bets.ranked` ustawia wyzwalacz. Zakład liczy się tylko wtedy, gdy trafił do chmury w ciągu 15 min od utworzenia i nie był później zmieniany.
- **Grupy:** zakładanie (max 10 własnych), dołączanie kodem lub linkiem `#join=KOD` (max 50 osób), ranking grupy.
- **Premium:** w `profiles.plan` i `premium_until` zmiany robi tylko serwer, a użytkownik nie może sam ustawić planu. W `config.js` opcja `betaAllPremium: true` daje w okresie testów wszystko za darmo.

## Czas polski i zegar urządzenia

- Zakład należy do pierwszego losowania, które faktycznie odbyło się po jego zapisaniu (godz. 22:00 czasu polskiego). Ta sama zasada działa w aplikacji ([`time.js`](time.js)) i w bazie (`bet_results`), niezależnie od strefy czasowej urządzenia. Godziny w aplikacji mają dopisek „(czas polski)”.
- Aplikacja sprawdza prawdziwy czas na serwerze i zapisuje zakłady z prawdziwą godziną, nawet gdy zegar telefonu jest przestawiony. Gdy różnica przekracza 15 min, pokazuje ostrzeżenie ze wskazówką, jak włączyć automatyczny czas (Android, iPhone). Bez internetu używa ostatniego pomiaru najwyżej przez 24 h.

## Co poprawiono względem wersji w Pythonie/Streamlit

| Problem w starej wersji | Rozwiązanie |
|---|---|
| Losowania się nie aktualizowały (API lotto.pl zwraca **403**, blokada botów) | Wyniki pobiera automat GitHub Actions ze źródła mbnet.com.pl po każdym losowaniu (wt/czw/sob) i jeszcze raz następnego dnia. Laptop nie musi być włączony. |
| Działało tylko na jednym laptopie | Strona na GitHub Pages: jeden adres, działa na każdym urządzeniu, także offline. |
| Baza CSV zapisywała same liczby, bez dat (deduplikacja „po liczbach” gubiła losowania) | Każde losowanie ma numer i datę, nowe są doklejane i nic nie jest kasowane. |
| Zakład był porównywany zawsze z *ostatnim* losowaniem | Zakład jest rozliczany z losowaniem, **na które został zagrany** (pierwszym po jego utworzeniu), osobno dla Lotto i Lotto Plus. |
| Ciężkie obliczenia wymagające komputera | „Ważona częstość”: częstość + przerwa od ostatniego wystąpienia, liczona od razu w telefonie. Opisuje przeszłość, nie przewiduje wyników. |

## Funkcje

- **Start:** odliczanie do losowania, ostatnie wyniki Lotto i Lotto Plus, podsumowanie zakładów, alert, gdy wynik się spóźnia.
- **Generator:** metody Statystyka (2 najczęstsze + 2 najrzadsze + 2 losowe), Ważona częstość, Losowo i Własne (wybór liczb palcem). Do tego 7 filtrów z poprzedniej wersji, które można włączać i wyłączać.
- **Statystyki:** mapa cieplna 1–49 (częstość, przerwa, ważona częstość), liczby najczęstsze, najrzadsze i najdłużej niewylosowane, parzyste/nieparzyste, sumy, najczęstsze pary. Zakres: 50, 100, 250, 500 lub wszystkie losowania od 1957 r.
- **Zakłady:** status oczekujący lub rozliczony, podświetlone trafienia, przełącznik „Zagrany”, „Ponów” na kolejne losowanie, filtry.
- **Więcej:** sprawdzanie dowolnego kuponu (także na całej historii), eksport i import zakładów (w tym stary `user_bets.csv`), ręczne dodanie wyniku, instalacja na telefonie.

## Publikacja i automat

Strona jest publikowana na GitHub Pages z tego repozytorium (Settings → Pages → Source: **GitHub Actions**). Wszystko robi automat [`.github/workflows/update-data.yml`](.github/workflows/update-data.yml):

- **Testy** – przy każdej zmianie, na każdej gałęzi, w 6 strefach czasowych.
- **Wyniki** – po każdym losowaniu (wt/czw/sob) i raz dziennie pobiera nowe wyniki do `data/` i zapisuje je w repozytorium.
- **Publikacja** – tylko z gałęzi `main`. Gdy testy przejdą, publikuje bieżący kod i zapisuje go jako gałąź `last-good`. Gdy testy nie przejdą, publikuje ostatni dobry kod (`last-good`) ze świeżymi wynikami, a przebieg kończy się błędem, więc przychodzi e-mail z GitHuba.

Żeby opublikować zmianę, wystarczy commit i push na `main` (przed pushem `git pull`, bo automat sam dopisuje wyniki). Zmianę bez publikacji, np. tylko do uruchomienia testów, wysyła się na osobną gałąź.

**Strażnik** ([`.github/workflows/monitor.yml`](.github/workflows/monitor.yml), [`scripts/monitor.py`](scripts/monitor.py)) uruchamia się codziennie rano i po losowaniach. Sprawdza:
- czy wyniki na stronie nie są starsze niż 3,5 dnia,
- czy automat wyników działa,
- czy baza Supabase ma aktualne wyniki (tylko publiczny klucz z `config.js`),
- czy działa hasło aplikacji do Gmaila (raz dziennie, samo logowanie).

Meldunek trafia do healthchecks.io, które wysyła e-mail, gdy coś jest nie tak albo gdy meldunki przestaną przychodzić. Potrzebne tajne klucze w Settings → Secrets: `HC_PING_URL` i `GMAIL_MONITOR_PASSWORD`. Próbny alarm: Actions → Strażnik → Run workflow → zaznacz „Próbny alarm”.

Zmiany w bazie (pliki w [`supabase/`](supabase/)) wkleja się ręcznie w Supabase → SQL Editor: najpierw `schema.sql`, potem `stage2.sql`. Oba pliki można bezpiecznie uruchomić ponownie.

## Instalacja na telefonie

Otwórz adres strony na telefonie, a następnie:
- **Android (Chrome):** menu ⋮ → *Zainstaluj aplikację* / *Dodaj do ekranu głównego*
- **iPhone (Safari):** *Udostępnij* → *Do ekranu początkowego*

## Twoje zakłady na kilku urządzeniach

Po zalogowaniu na to samo konto zakłady są takie same na telefonie i komputerze, bo synchronizują się w chmurze. Bez konta zakłady zostają w pamięci przeglądarki na danym urządzeniu.

Kopię zapasową zrobisz przez *Więcej → Eksportuj* (plik `.json`), a wczytasz przez *Więcej → Importuj*. Import łączy dane bez duplikatów. Tak samo wczytasz stary plik `user_bets.csv`. Zakłady z importu nie liczą się do rankingu.

## Lokalny podgląd (opcjonalnie)

Aplikacja potrzebuje serwera HTTP, bo otwarta dwuklikiem z dysku nie wczyta danych. Z Pythonem wystarczy:

```bash
python -m http.server 8000
```

i wejście na <http://localhost:8000>. Ręczna aktualizacja danych: `python scripts/update_data.py`.

Testy: `node --test tests/*.test.js` (Node.js) i `python -m unittest discover -s tests -p "test_*.py"` (Strażnik).

## Struktura

```
index.html, app.css, app.js   – aplikacja (ekrany, generator, statystyki, zakłady)
time.js                       – czas polski, rozliczanie zakładów, zegar urządzenia
cloud.js, config.js           – konto i synchronizacja zakładów (Supabase, publiczny klucz)
sw.js, manifest.webmanifest   – tryb offline i instalacja (PWA)
icons/                        – ikony aplikacji
privacy.html                  – polityka prywatności (RODO)
data/lotto.json               – wyniki Lotto od 1957 r.
data/lottoplus.json           – wyniki Lotto Plus od 2012 r.
scripts/update_data.py        – pobieranie wyników (bez dodatkowych bibliotek)
scripts/monitor.py            – Strażnik: sprawdzanie, czy wszystko działa, i alarmy
supabase/                     – schemat bazy, ranking, grupy (SQL)
tests/                        – testy automatyczne (czas polski, zegar urządzenia, Strażnik)
.github/workflows/            – testy, harmonogram automatu i publikacja na GitHub Pages
```

> Losowania Lotto są całkowicie losowe. Żadna statystyka ani model nie zwiększa szansy wygranej. Graj odpowiedzialnie, 18+.
