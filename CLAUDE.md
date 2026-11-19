# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Typer49** – a Polish-language PWA for the 6/49 number games (Lotto, Lotto Plus): results, statistics, bet generator, automatic checking of the user's bets, accounts with cloud sync, rankings and friend groups. Live at https://lottobot1.github.io/ (GitHub repo `LottoBot1/lottobot1.github.io`, Pages source = GitHub Actions). Backend is Supabase (project ref `ydntwczvpzydwqqwhmof`, EU). All user-facing text, commit messages and docs are in Polish. The owner is non-technical and communicates in Polish – the overview, parts, status and risks sections below are written in Polish for them.

## Opis projektu prostymi słowami

Typer49 to aplikacja dla osób grających w Lotto i Lotto Plus. Otwiera się ją w przeglądarce albo instaluje na telefonie jak zwykłą aplikację. Robi pięć rzeczy:

1. **Pokazuje wyniki.** Sama pobiera wyniki każdego losowania (wtorek, czwartek, sobota ok. 22:00), więc nie trzeba ich nigdzie sprawdzać ani wpisywać.
2. **Pokazuje statystyki.** Które liczby padają często, a które dawno nie padły, oraz jakie pary liczb się powtarzają.
3. **Pomaga wybrać liczby.** Generator proponuje zestawy według różnych metod albo pozwala wybrać liczby samemu. Aplikacja uczciwie informuje, że żadna metoda nie zwiększa szansy wygranej.
4. **Sprawdza Twoje kupony.** Zapisujesz zakład, a po losowaniu aplikacja sama pokazuje, ile liczb trafiłeś.
5. **Pozwala rywalizować.** Po założeniu konta zakłady są takie same na telefonie i komputerze. Możesz pojawić się w rankingu graczy pod pseudonimem albo założyć grupę ze znajomymi i porównywać wyniki.

W przyszłości część funkcji ma być płatna (Premium), a aplikacja ma trafić do sklepu Google Play.

## Główne części projektu

| Część | Za co odpowiada |
|---|---|
| **Strona aplikacji** (`index.html`, `app.css`, `app.js`) | To, co widzi użytkownik: wszystkie ekrany, generator, statystyki, lista zakładów i ich sprawdzanie. |
| **Moduł konta** (`cloud.js`, `config.js`) | Logowanie i wysyłanie zakładów do chmury. Działa też bez internetu, bo zmiany czekają i wysyłają się później. |
| **Tryb offline i instalacja** (`sw.js`, `manifest.webmanifest`, `icons/`) | Działanie bez internetu, ikona i nazwa na ekranie telefonu. |
| **Dane losowań** (`data/*.json`) | Wszystkie wyniki od 1957 r. (Lotto) i od 2012 r. (Lotto Plus). |
| **Automat na GitHubie** (`.github/workflows/`, `scripts/update_data.py`) | Po każdym losowaniu pobiera nowe wyniki, zapisuje je i publikuje stronę na nowo. Codziennie „budzi” też bazę danych. Strażnik (`monitor.yml`, `scripts/monitor.py`) codziennie sprawdza, czy wszystko działa, i alarmuje e-mailem przez healthchecks.io. |
| **Baza danych Supabase** (`supabase/*.sql`) | Przechowuje konta, zakłady, rankingi i grupy, pilnuje, żeby każdy widział tylko swoje dane, i sama pobiera wyniki do rankingów. |
| **Wysyłka e-maili** (ustawienia w Supabase) | Potwierdzenie konta i reset hasła, wysyłane ze skrzynki typer49.kontakt@gmail.com. |
| **Zasady prywatności** (`privacy.html`) | Informacje wymagane przez RODO. |

## Commands

There is no build step, bundler or linter – plain HTML/CSS/vanilla JS served as static files.

- Tests: `node --test tests/*.test.js` (Node's built-in runner; pass the files – Node 22 rejects a bare `tests/` folder). Single test: `node --test --test-name-pattern "zmiana czasu" tests/time.test.js`. Node is not installed on the owner's laptop – tests run on GitHub Actions on every push to any branch, in 6 time zones (`TZ=...`). Push a work branch to run tests without publishing. Monitor tests: `python -m unittest discover -s tests -p "test_*.py"` (also run in the `test` job).

- Local preview (needs an HTTP server; opening `index.html` from disk cannot load `data/*.json`):
  `python -m http.server 8000` from the repo root (Python is not installed on the owner's laptop; any static server works).
- Refresh draw data manually: `python scripts/update_data.py` (stdlib only).
- Deploy: commit and push to `main`. `.github/workflows/update-data.yml` has three jobs: `test`, `update-data` (main only, never blocked by tests) and `deploy` (main only). When tests pass, the current commit is published and saved as branch `last-good`; when they fail, `last-good` code is published with the fresh `data/` and the run fails, so GitHub e-mails the owner. The workflow itself commits to `data/`, so `git pull` before pushing. On Windows add `C:\Program Files\Git\cmd` and `C:\Program Files\GitHub CLI` to PATH first; `gh run watch <id>` to follow the deploy.
- Database changes: SQL files in `supabase/` are applied by hand in the Supabase SQL Editor (`schema.sql` first, then `stage2.sql`, then `etap4_bilans.sql`; `*_test.sql` files are rollback-only tests). Both are idempotent – keep new migrations that way.
- Testing SQL logic without leaving data behind: run a `do $$ … $$` block that inserts fake `auth.users`, switches identity with `set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role','authenticated')::text, true)` + `execute 'set local role authenticated'`, collects results into a jsonb and ends with `raise exception 'WYNIK_TESTU %', res;` – the exception rolls everything back.

## Architecture

### Front end (no framework)
- Script order in `index.html` matters: `config.js` → Supabase UMD from jsDelivr (pinned `@supabase/supabase-js@2.45.4`) → `cloud.js` (`window.Cloud`) → `time.js` (`window.TyperTime`) → `bilans.js` (`window.TyperBilans`) → `app.js`. The app must keep working when the CDN or Supabase is unavailable (`Cloud.enabled` false → local-only mode).
- `app.js` is one IIFE with a single `state` object. Each screen is `<section id="view-<name>">`; `setView()`/`renderView()` dispatch by name, routing is the URL hash (`VIEWS` list), and `#join=CODE` is a group-invite link handled by `checkJoinLink()`. Views `account`, `rank`, `premium` have no draw-data dependency; others return early until data is loaded.
- Draws come from `data/lotto.json` / `data/lottoplus.json` (`draws: [[no, "YYYY-MM-DD", [6 nums]], …]`), merged with user-entered manual results from localStorage (`withManual`).
- All time logic is in `time.js` and always uses Polish time (Europe/Warsaw via `Intl`, with an EU DST fallback), never the device time zone. Bet settlement (`evalBet` → `TyperTime.targetDraw`): a bet belongs to the **first draw actually present in the data whose 22:00 Warsaw time is strictly after the bet's creation**; only while that draw is not in the data does the Tue/Thu/Sat schedule decide (`pending` / `waiting`). This mirrors `bet_results()` in the database – change both together, and keep `tests/time.test.js` in sync. Every displayed clock time carries the suffix `(czas polski)` (`PL` constant).
- Device clock: app.js never reads `new Date()` for "now"; it uses `now()` = device clock + offset. `syncClock()` measures the offset with a `HEAD manifest.webmanifest?clock=…` request (`cache: 'no-store'`; the service worker ignores HEAD and `?clock`) from the `Date` + `Age` headers and the request duration (`TyperTime.measureOffset`). The offset is saved in `typer.clock` and used offline for at most 24 h (`activeOffset`), then the device clock. Bet time `t` is stored already corrected, so the `bets_ranked` ±15 min check passes even on a wrong device clock. Yellow banner `#clockWarn` above 15 min, with OS-specific instructions (`devicePlatform`). Tests: `tests/clock.test.js`.
- Spending balance (`bilans.js`, free for everyone – responsible gaming): only bets with `played` count. Price (`CENY`) and the fixed 3-hit prize (`TROJKA`) are tables keyed by the **date of the draw the bet belongs to** (from `TT.targetDraw`), not the calendar day of the bet – the 2026 price change happened at 22:10 on 18.08 (first 5 zł draw 20.08). A new price = a new row in the table. Amounts are summed in grosze. `b.prize` (zł, optional) is the user's own amount and overrides the suggestion; suggestion only for exactly 3 Lotto hits with <3 in Plus, 4–6 and Plus wins need manual entry. `prize` syncs via `bets.prize` (`supabase/etap4_bilans.sql`); it does not affect `ranked`. Tests: `tests/bilans.test.js`.
- localStorage keys: `lotto2.*` (bets, filters, manual draws, game – legacy prefix kept on purpose so existing users keep data) and `typer.*` (auth session, sync queue, owner id).
- `sw.js`: shell is network-first with cache fallback, `data/` network-first, the pinned Supabase CDN file cache-first. **Bump `VERSION` whenever shell files change.**

### Accounts and sync (`cloud.js`)
- Offline-first: every bet change goes to a queue (`typer.queue`) and `flush()` upserts/deletes in batches; network errors leave the queue for later.
- `fullSync()` merge rule: a local bet without `synced` is new → upload; a local bet with `synced` missing from the cloud was deleted on another device → drop; pending queued deletes win over remote rows.
- `signOut()` must never block (timeouts + `scope: 'local'` + manual removal of `typer.auth*`) – this fixed a real "cannot log out on phone" bug.
- Only the public anon key lives in `config.js`; access control is entirely RLS in Postgres.

### Database (Supabase)
- `bets` (PK `user_id,id`), `profiles` (auto-created by trigger on `auth.users`), `draws`, `groups`, `group_members`. Every table has RLS; users only see their own bets.
- `draws` is filled inside Postgres: pg_cron jobs `typer-draws-request` / `typer-draws-process` use pg_net to fetch the Pages JSON every 30 min (no secrets involved).
- Ranking integrity: trigger `bets_ranked` sets `bets.ranked` – true only if the row reached the server within ±15 min of `created_at` and `nums`/`created_at` were never edited. Imported/offline/edited bets never count.
- RPCs (security definer): `ranking(period, group)`, `my_stats`, `my_groups`, `create_group`, `join_group`, `delete_my_account`. `bet_results` is internal (no execute grant).
- Premium: `profiles.plan` / `premium_until` are not writable by users (column grants allow only `nick`, `public_ranking`). Client gating uses `isPremium()` / `requirePremium()` / `canAddBets()` and `data-premium` attributes (crown badge). `config.js` `betaAllPremium: true` unlocks everything during the beta; `freeLimits` holds the free-plan limits.

### Data pipeline
GitHub Action cron (after Tue/Thu/Sat draws + daily) → `scripts/update_data.py` downloads `mbnet.com.pl/dl.txt` and `dl_plus.txt` (lotto.pl's API returns 403) → merges **by draw number, never by date** (old years had several draws per day; merging by date once deleted 956 draws) and refuses to write fewer draws than already stored → commits `data/` → deploys Pages → Supabase imports from Pages.

### Monitoring („Strażnik”)
`.github/workflows/monitor.yml` runs `scripts/monitor.py` (stdlib only) daily at 06:30 UTC and after draws (Wed/Fri/Sun 02:15 UTC). Checks: published results not older than 3.5 days (the alert text must keep the holiday sentence), latest `update-data.yml` run on main succeeded, Supabase `draws` caught up with the site within 8 h of the draw, Gmail SMTP login (no e-mail sent). Rules from the owner: Supabase is queried **only with the public key from `config.js`** (`key_is_public` refuses anything else – never `service_role`); Gmail login **at most once per UTC day** (the script writes `.gmail-checked`, the workflow stores it in the Actions cache keyed by date). Result goes to healthchecks.io (`HC_PING_URL` secret: success ping or `/fail` with the Polish report), which e-mails the owner and also alerts when no ping arrives (GitHub Actions stopped). On problems the job also fails, so GitHub e-mails as a second channel. Secrets: `HC_PING_URL`, `GMAIL_MONITOR_PASSWORD` (a separate Gmail app password „typer49-straznik”, not the Supabase one). healthchecks.io check „Typer49 Strażnik”: Period 1 day, Grace 12 h, e-mail integration on (configured 19.11.2026). Manual run: Actions → Strażnik → Run workflow (`test_alarm`, `check_gmail`). Tests: `tests/test_monitor.py` (Python `unittest`, run in the `test` job).

## Stan projektu

### Skończone i sprawdzone w działaniu
- Wyniki pobierane automatycznie: pełna historia Lotto i Lotto Plus.
- Statystyki, generator z filtrami, ręczny wybór liczb, sprawdzanie kuponu na całej historii.
- Zapisywanie zakładów i rozliczanie ich z właściwym losowaniem, zawsze według czasu polskiego, niezależnie od strefy urządzenia. Zasada jest taka sama w aplikacji i w bazie. Przy wdrożeniu (18.11.2026) żaden z 10 zapisanych zakładów nie zmienił losowania. Godziny w aplikacji mają dopisek „(czas polski)”.
- Zegar urządzenia (19.11.2026): aplikacja sprawdza prawdziwy czas na serwerze i zapisuje zakłady z prawdziwą godziną, nawet gdy zegar telefonu jest przestawiony. Gdy różnica przekracza 15 min, pokazuje żółty pasek ze wskazówką, jak włączyć automatyczny czas (osobno dla Androida, iPhone'a i innych systemów). Bez internetu używa ostatniego pomiaru najwyżej przez 24 h, potem zegara telefonu.
- Automatyczne testy logiki czasu i zegara urządzenia (14 + 12 testów × 6 stref czasowych) na GitHubie przy każdej zmianie. Nieudane testy blokują publikację kodu, ale nie aktualizację wyników.
- Import starego pliku `user_bets.csv` z poprzedniej wersji programu, eksport i import kopii.
- Instalacja na telefonie i działanie bez internetu.
- Konta: rejestracja z potwierdzeniem e-mailem, logowanie, reset hasła, wylogowanie (także na telefonie), usuwanie konta.
- Synchronizacja zakładów między urządzeniami.
- Ranking globalny i grupy znajomych z zaproszeniami. Logika bazy jest przetestowana na fikcyjnych kontach, a ranking sprawdził właściciel na prawdziwych zakładach po losowaniu (wtorek 17.11.2026). Działa poprawnie.

### Niedokończone albo prowizoryczne
- **Premium nie ma płatności.** Wszystko jest darmowe dzięki przełącznikowi `betaAllPremium`. Przycisk „Kup Premium” jest nieaktywny.
- **Limity wersji darmowej działają tylko w aplikacji, nie na serwerze.** Gdy ruszą płatności, limity trzeba będzie też egzekwować w bazie, bo inaczej da się je obejść.
- **Bilans wydatków (Etap 4, krok 1) – gotowy, jeszcze nieopublikowany.** Karta „💰 Bilans” na ekranie Zakłady: wydane, wygrane i bilans za miesiąc, rok i od początku. Liczą się tylko zakłady „Zagrany”. Ceny zależą od daty losowania (2 zł, 3 zł od 9.10.2009, 5 zł od losowania 20.08.2026, Plus +1 zł). Przy trójce aplikacja podpowiada 24 zł / 35 zł, inne wygrane wpisuje się ręcznie. Przed publikacją trzeba uruchomić w Supabase `etap4_bilans_test.sql` i `etap4_bilans.sql`. Data zmiany ceny z 2009 r. (9.10) pochodzi od właściciela – źródła potwierdzają tylko październik 2009.
- **Funkcje opisane jako „wkrótce” nie istnieją:** powiadomienia po losowaniu, systemy skrócone. Reklam też jeszcze nie ma.
- **Brak regulaminu.** Jest tylko polityka prywatności, a regulamin będzie potrzebny przed płatną subskrypcją i Google Play.
- **Tymczasowa infrastruktura:**
  - adres `lottobot1.github.io` zamiast własnej domeny;
  - e-maile z Gmaila (limit ok. 500 dziennie);
  - dane z mbnet.com.pl bez oficjalnej zgody i licencji.
- **Automatyczne testy obejmują tylko logikę czasu, zegar urządzenia, bilans wydatków i progi alarmów Strażnika.** Reszta (synchronizacja, ranking w aplikacji, generator) jest sprawdzana ręcznie.
- **Korekta zegara bez internetu jest przybliżona.** Gdy ktoś przestawi zegar bez internetu, aplikacja do 24 h liczy według starego pomiaru. Po połączeniu z internetem od razu mierzy na nowo.

## Problemy i ryzyka w kodzie

- **Przestawiony zegar urządzenia** – obsłużony (Etap 1, krok 2). Zostaje jedno ryzyko: zakład zapisany bez internetu przez kogoś, kto nigdy nie był online albo jest offline od ponad 24 h, ma godzinę z zegara telefonu. Taki zakład i tak nie liczy się do rankingu, ale może trafić do złego losowania.
- **Terminarz losowań (wt/czw/sob 22:00) jest wpisany na stałe.** Rozliczanie opiera się na losowaniach, które faktycznie są w danych, więc odwołane lub przesunięte losowanie nie psuje przypisania. Terminarz decyduje tylko o odliczaniu i o statusie „oczekuje”, a przy przesuniętym losowaniu przez chwilę może pokazać zły termin. Gdyby losowanie odbyło się o innej godzinie niż 22:00, przypisanie zakładów zapisanych w tym czasie mogłoby się różnić od rzeczywistego.
- **Jedno źródło wyników.** Jeśli mbnet.com.pl zmieni format, adres albo zablokuje automat, wyniki przestaną się aktualizować. Skrypt nie usunie danych, ale nowych nie będzie. Źródło działa też tylko przez nieszyfrowane `http`.
- **Wpisane na stałe adresy.**
  - Baza pobiera wyniki z `lottobot1.github.io`, więc zmiana adresu strony (np. własna domena) przerwie import, dopóki nie zmieni się SQL.
  - Krok „budzenia” bazy w automacie odczytuje klucz z `config.js` prostym wzorcem tekstowym, więc zmiana formatu tego pliku go zepsuje.
- **Wydajność przy dużej liczbie użytkowników.**
  - Ranking jest liczony od zera przy każdym wyświetleniu, przez przejrzenie wszystkich zakładów wszystkich graczy.
  - Każdy zapis zakładu liczy wszystkie zakłady użytkownika (limit 5000).
  - Aplikacja przy każdym powrocie na ekran pobiera z chmury wszystkie zakłady.
  
  Przy kilkuset osobach to nie problem, przy tysiącach będzie wolno.
- **Konflikty między urządzeniami.** Gdy ten sam zakład zostanie zmieniony na dwóch urządzeniach (np. „Zagrany”), wygrywa zmiana wysłana później, bez ostrzeżenia.
- **Bezpieczeństwo HTML.** Ekrany są budowane z tekstu (`innerHTML`, 38 miejsc w `app.js`). Dane od użytkowników (pseudonimy, nazwy grup) są zabezpieczane funkcją `esc()`. Każda nowa funkcja, która o tym zapomni, otworzy lukę.
- **Kody zaproszeń** mają 8 znaków i nie ma limitu prób dołączenia. Odgadnięcie kodu jest bardzo mało prawdopodobne, ale technicznie możliwe przy masowych próbach.
- **Zależności, które mogą się zestarzeć.**
  - Biblioteka Supabase jest przypięta do starszej wersji 2.45.4.
  - Używany jest „starszy” typ klucza (anon JWT), a Supabase zaleca nowe klucze „publishable”. Jeśli wyłączy stare, logowanie przestanie działać do czasu podmiany klucza.
- **Awarie e-maili.** Zmiana hasła do skrzynki typer49.kontakt@gmail.com unieważnia hasła aplikacji i e-maile przestają wychodzić. Strażnik wykrywa to raz dziennie przez próbne logowanie. Nie wykryje za to przekroczenia limitu Gmaila (ok. 500 dziennie) ani błędnych ustawień SMTP w samym Supabase.
- **Darmowy plan Supabase** usypia bazę po 7 dniach bez ruchu i ma limity. Chroni przed tym codzienny automat. Gdy automat GitHuba przestanie działać, baza zaśnie, ale healthchecks.io zaalarmuje o braku meldunków Strażnika.
- **Alarmy Strażnika przychodzą tylko przy zmianie stanu.** healthchecks.io wysyła e-mail, gdy stan zmieni się z „OK” na „problem” i z powrotem. Nowy problem, który pojawi się, zanim stary zostanie naprawiony, nie da osobnego e-maila z healthchecks.io. Każdy nieudany przebieg da za to e-mail z GitHuba.
- **Fałszywe alarmy w święta.** Gdy losowanie zostanie odwołane lub przesunięte, przerwa może przekroczyć 3,5 dnia.
- **Ryzyka prawne przy zarabianiu:** znak towarowy „Lotto”, ograniczenia reklamy gier hazardowych, licencja na dane. Szczegóły są w zasadach projektu poniżej.

## Project rules

- Keep the public project anonymous: commit as `lotto-bot <lotto-bot@users.noreply.github.com>` (set in the repo's git config) and never put the owner's real name or personal GitHub username into code, commits or docs.
- Don't use "Lotto" as the product name or imitate Totalizator Sportowy branding (trademark); game names are used only descriptively.
- Aplikacja musi działać na Androidzie (Chrome) i iPhonie (Safari, także zainstalowana na ekranie początkowym). Każdą zmianę sprawdzaj pod kątem obu systemów, a różnice opisuj właścicielowi.
- Never claim the app improves the chance of winning (store policy and consumer law); keep the 18+/responsible-gaming notes.
- E-mails go through custom SMTP (Gmail app password, entered by the owner). Security-related Supabase settings (e.g. "Confirm email") are the owner's decision – don't change them.

## Cele i plan pracy

### Cel
Projekt zaczął się jako hobby i nauka, teraz ma stać się źródłem zarobku. Celem jest jak najwięcej użytkowników. Właściciel ma ok. 10 h tygodniowo i jest gotów na rozsądne wydatki (domena, konto Google Play, porada prawna).

### Kolejność prac (nie przeskakuj etapów bez zgody właściciela)
Punkty poniżej to **Etap 1–6**. Tylko tak nazywamy etapy w rozmowach, commitach i dokumentach. Mniejsze części etapu to kroki (np. „Etap 1, krok 2”). Nazwa pliku `supabase/stage2.sql` pochodzi z wcześniejszego podziału prac i nie oznacza Etapu 2.

- **Etap 1** ✅ (zrobione 18–19.11.2026) Poprawka czasu: rozliczanie zakładów zawsze według czasu polskiego (Europe/Warsaw), niezależnie od strefy i zegara urządzenia, zgodnie z logiką bazy (`bet_results`). Ostrzeżenie dla użytkownika, gdy zegar urządzenia jest przestawiony o więcej niż 15 min. Do tej logiki powstaje automatyczny test.
- **Etap 2** ✅ (zrobione 19.11.2026) Szybkie poprawki: napis „rankingi (wkrótce)”, przestarzały README.md, ekran Premium bez wzmianek o Google Play (aplikacja działa też na iPhonie).
- **Etap 3** ✅ (19.11.2026 – skonfigurowany, próbny alarm dotarł e-mailem) Ostrzeżenia o awariach: właściciel dostaje e-mail, gdy przez ponad 3,5 dnia nie przyjdą nowe wyniki, gdy automat GitHuba się wysypie lub stanie, gdy baza przestanie pobierać wyniki lub gdy przestanie działać hasło do Gmaila. Rozwiązanie: Strażnik + healthchecks.io (szczegóły w „Monitoring”).
- **Etap 4** Nowe funkcje, każda osobno: bilans wydatków (krok 1 – w trakcie, 19.11.2026), systemy skrócone, powiadomienia po losowaniu.
  - Ceny i wygrane zmieniają się rzadko: przy kolejnej zmianie dopisz linijkę w tabelach `CENY` / `TROJKA` w `bilans.js` (data = pierwsze losowanie po nowej cenie) i test w `tests/bilans.test.js`.
- **Etap 5** Wydajność przed promocją: ranking, zapis zakładów i synchronizacja przy tysiącach użytkowników.
- **Etap 6** Google Play (aplikacja na Androida przez TWA) i płatności Premium (Play Billing) – dopiero gdy właściciel potwierdzi, że kwestie prawne (znak „Lotto”, reklama gier, licencja na dane) są zamknięte w osobnym projekcie.

### Zasady współpracy z właścicielem
- Przed każdą zmianą zrób commit, żeby można było wrócić.
- Jedna zmiana na raz. Po każdej napisz prostymi słowami po polsku, co zrobiłeś i jak to sprawdzić.
- Zanim zmienisz logikę rozliczania zakładów, rankingu albo bazę danych, opisz plan i poczekaj na zgodę.
- Gdy trzeba coś wykonać w Supabase (SQL Editor, ustawienia), podaj właścicielowi instrukcję krok po kroku: gdzie kliknąć, co wkleić i co powinien zobaczyć.
- Gdy czegoś nie da się zrobić bez decyzji właściciela, zapytaj, zamiast zgadywać.
