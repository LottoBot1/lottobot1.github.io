#!/usr/bin/env python3
"""Strażnik Typer49 – sprawdza, czy wszystko działa, i alarmuje, gdy coś się zepsuło.

Uruchamiany przez GitHub Actions (.github/workflows/monitor.yml). Sprawdza:
  1. wyniki na stronie – najnowsze losowanie nie starsze niż 3,5 dnia,
  2. automat wyników na GitHubie – ostatni przebieg zakończony bez błędu,
  3. bazę Supabase – ma te same wyniki co strona (najwyżej 8 h po losowaniu)
     i wysłała powiadomienia po losowaniu (najwyżej 3 h po losowaniu),
  4. skrzynkę Gmail – hasło aplikacji działa (tylko logowanie, bez wysyłania; najwyżej raz na dobę).

Wynik trafia do healthchecks.io: „OK” albo „problem” z opisem po polsku – healthchecks.io
wysyła wtedy e-mail do właściciela. Gdy przez dobę nie przyjdzie żaden meldunek
(GitHub przestał działać), healthchecks.io też alarmuje. Przy problemie przebieg kończy się
błędem, więc GitHub dodatkowo wysyła swój e-mail.

Do bazy używany jest WYŁĄCZNIE publiczny klucz z config.js (anon / publishable).
Tylko standardowa biblioteka Pythona.
"""
from __future__ import annotations

import base64
import json
import os
import re
import smtplib
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://lottobot1.github.io"
WARSAW = ZoneInfo("Europe/Warsaw")
GAME_NAMES = {"lotto": "Lotto", "lottoplus": "Lotto Plus"}

RESULTS_MAX_AGE = timedelta(days=3, hours=12)   # zwykła przerwa sob→wt to ok. 3 dni
DB_MAX_LAG = timedelta(hours=8)                  # od godziny losowania do wyników w bazie
PUSH_GRACE = timedelta(hours=3)                  # od godziny losowania do wysłanych powiadomień
HOLIDAY_NOTE = "Jeśli dziś lub wczoraj było święto, losowanie mogło zostać przesunięte."


# ---------------------------------------------------------------- logika (testy: tests/test_monitor.py)
def draw_instant(iso: str) -> datetime:
    """Godzina losowania: 22:00 czasu polskiego danego dnia (w UTC)."""
    y, m, d = map(int, iso.split("-"))
    return datetime(y, m, d, 22, 0, tzinfo=WARSAW).astimezone(timezone.utc)


def fmt_pl(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def results_problem(game: str, latest: str | None, now: datetime) -> str | None:
    """Alarm, gdy najnowsze wyniki gry są starsze niż 3,5 dnia."""
    name = GAME_NAMES.get(game, game)
    if not latest:
        return f"Na stronie nie ma żadnych wyników {name}."
    age = now - draw_instant(latest)
    if age <= RESULTS_MAX_AGE:
        return None
    days = age.total_seconds() / 86400
    return (f"Brak nowych wyników {name} od {days:.1f} dnia (ostatnie: {fmt_pl(latest)}). "
            f"{HOLIDAY_NOTE} Jeśli nie – sprawdź automat wyników na GitHubie (zakładka Actions) "
            f"i czy źródło mbnet.com.pl działa.")


def db_problem(game: str, site_latest: str | None, db_latest: str | None, now: datetime) -> str | None:
    """Alarm, gdy baza nie ma wyników, które są na stronie, dłużej niż 8 h od losowania."""
    if not site_latest or (db_latest and db_latest >= site_latest):
        return None
    if now - draw_instant(site_latest) <= DB_MAX_LAG:
        return None                                   # baza pobiera wyniki co 30 min – jeszcze czekamy
    name = GAME_NAMES.get(game, game)
    have = fmt_pl(db_latest) if db_latest else "brak"
    return (f"Baza Supabase nie pobrała wyników {name} z {fmt_pl(site_latest)} (w bazie ostatnie: {have}). "
            f"Ranking się nie aktualizuje. Sprawdź w Supabase, czy projekt nie jest wstrzymany (Paused) "
            f"i czy działają zadania cron „typer-draws-…”.")


def parse_ts(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def push_problem(h: dict | None, now: datetime) -> str | None:
    """Alarm, gdy po losowaniu powiadomienia się nie wysłały (dane z push_health(), bez danych osób).

    Czekamy 3 h od losowania (wyniki zwykle są w bazie po ok. 1 h). Losowania starsze niż 4 dni
    pomijamy – wtedy i tak alarmuje sprawdzenie wyników.
    """
    if not h or not h.get("draw_time"):
        return None
    drawn = parse_ts(h["draw_time"])
    if now - drawn <= PUSH_GRACE or now - drawn > timedelta(days=4):
        return None
    when = fmt_pl(h["draw_date"])
    where = ("Sprawdź w Supabase: Edge Functions → powiadomienia → Logs oraz zadania cron "
             "„typer-draws-night-…” i „typer-push-check”.")
    if not h.get("started_at"):
        return f"Powiadomienia po losowaniu z {when} nie zostały uruchomione. {where}"
    if h.get("has_error"):
        return (f"Wysyłka powiadomień po losowaniu z {when} zakończyła się błędem "
                f"(próby: {h.get('attempts')}). {where}")
    if not h.get("finished_at") and now - parse_ts(h["started_at"]) > timedelta(minutes=30):
        return f"Wysyłka powiadomień po losowaniu z {when} nie zakończyła się. {where}"
    return None


def workflow_problem(runs: list[dict]) -> str | None:
    """Alarm, gdy ostatni zakończony przebieg automatu wyników na main nie jest udany."""
    done = [r for r in runs if r.get("status") == "completed"]
    if not done:
        return None
    last = done[0]
    if last.get("conclusion") in ("success", "skipped", "cancelled"):
        return None
    return (f"Automat wyników na GitHubie zakończył się błędem ({last.get('conclusion')}). "
            f"Szczegóły: {last.get('html_url', 'zakładka Actions')}")


def key_is_public(key: str) -> bool:
    """Tylko klucz publiczny: nowy „publishable” albo stary JWT z rolą anon. Nigdy service_role / secret."""
    if not key:
        return False
    if key.startswith("sb_publishable_"):
        return True
    if key.startswith("sb_secret_"):
        return False
    try:
        part = key.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except Exception:
        return False
    return payload.get("role") == "anon"


def report(problems: list[str], notes: list[str]) -> str:
    when = datetime.now(WARSAW).strftime("%d.%m.%Y %H:%M")
    lines = [f"Strażnik Typer49 – {when} (czas polski)", ""]
    if problems:
        lines.append(f"PROBLEMY ({len(problems)}):")
        lines += [f"{i}. {p}" for i, p in enumerate(problems, 1)]
    else:
        lines.append("Wszystko działa.")
    if notes:
        lines += ["", "Informacje:"] + [f"- {n}" for n in notes]
    return "\n".join(lines)


# ---------------------------------------------------------------- sprawdzenia (sieć)
def get_json(url: str, headers: dict | None = None, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "typer49-monitor", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def site_latest(game: str) -> str | None:
    data = get_json(f"{SITE}/data/{game}.json?t={int(datetime.now().timestamp())}")
    draws = data.get("draws") or []
    return max(d[1] for d in draws) if draws else None


def supabase_config() -> tuple[str, str]:
    text = (ROOT / "config.js").read_text(encoding="utf-8")
    url = re.search(r"supabaseUrl:\s*'([^']+)'", text)
    key = re.search(r"supabaseKey:\s*'([^']+)'", text)
    return (url.group(1) if url else "", key.group(1) if key else "")


def db_latest(url: str, key: str, game: str) -> str | None:
    rows = get_json(f"{url}/rest/v1/draws?select=draw_date&game=eq.{game}&order=draw_date.desc&limit=1",
                    {"apikey": key, "Authorization": f"Bearer {key}"})
    return rows[0]["draw_date"] if rows else None


def push_health(url: str, key: str) -> dict | None:
    req = urllib.request.Request(f"{url}/rest/v1/rpc/push_health", data=b"{}", method="POST",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json", "User-Agent": "typer49-monitor"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read().decode("utf-8"))
    return rows[0] if rows else None


def workflow_runs() -> list[dict]:
    repo, token = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not repo or not token:
        return []
    data = get_json(f"https://api.github.com/repos/{repo}/actions/workflows/update-data.yml/runs?branch=main&per_page=5",
                    {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
    return data.get("workflow_runs", [])


def gmail_login(user: str, password: str) -> None:
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, password)


def ping(url: str, ok: bool, text: str) -> None:
    target = url.rstrip("/") + ("" if ok else "/fail")
    req = urllib.request.Request(target, data=text.encode("utf-8"), method="POST",
                                 headers={"Content-Type": "text/plain; charset=utf-8", "User-Agent": "typer49-monitor"})
    for _ in range(3):
        try:
            urllib.request.urlopen(req, timeout=15).close()
            return
        except Exception as e:                       # noqa: BLE001
            err = e
    print(f"::warning::Nie udało się wysłać meldunku do healthchecks.io: {err}")


def main() -> int:
    now = datetime.now(timezone.utc)
    problems: list[str] = []
    notes: list[str] = []

    if os.environ.get("TEST_ALARM") == "true":
        problems.append("PRÓBNY ALARM – to tylko test. Jeśli czytasz ten e-mail, ostrzeżenia działają.")

    # 1. wyniki na stronie
    latest: dict[str, str | None] = {}
    for game in GAME_NAMES:
        try:
            latest[game] = site_latest(game)
            p = results_problem(game, latest[game], now)
            if p:
                problems.append(p)
        except Exception as e:                       # noqa: BLE001
            latest[game] = None
            problems.append(f"Nie da się pobrać wyników {GAME_NAMES[game]} ze strony {SITE} ({e}). "
                            f"Strona może nie działać – sprawdź ją w przeglądarce.")

    # 2. automat wyników
    try:
        p = workflow_problem(workflow_runs())
        if p:
            problems.append(p)
    except Exception as e:                           # noqa: BLE001
        notes.append(f"Nie udało się sprawdzić automatu wyników ({e}).")

    # 3. baza Supabase – tylko klucz publiczny
    url, key = supabase_config()
    if not url or not key:
        notes.append("Brak adresu lub klucza Supabase w config.js – pomijam sprawdzanie bazy.")
    elif not key_is_public(key):
        problems.append("Klucz w config.js NIE jest kluczem publicznym (anon/publishable). "
                        "Strażnik go nie użyje. Natychmiast usuń go z config.js i wygeneruj nowy w Supabase.")
    else:
        for game in GAME_NAMES:
            try:
                p = db_problem(game, latest.get(game), db_latest(url, key, game), now)
                if p:
                    problems.append(p)
            except Exception as e:                   # noqa: BLE001
                problems.append(f"Baza Supabase nie odpowiada ({e}). Sprawdź w Supabase, czy projekt "
                                f"nie jest wstrzymany (Paused) – darmowy plan usypia bazę po 7 dniach bez ruchu.")
                break
        # 3a. powiadomienia po losowaniu (Etap 4, krok 3, część B)
        try:
            h = push_health(url, key)
            p = push_problem(h, now)
            if p:
                problems.append(p)
            elif h and h.get("finished_at"):
                notes.append(f"Powiadomienia po losowaniu z {fmt_pl(h['draw_date'])}: "
                             f"osoby {h.get('users')}, wysłane {h.get('sent')}, nieudane {h.get('failed')}.")
        except Exception as e:                       # noqa: BLE001
            notes.append(f"Nie udało się sprawdzić powiadomień po losowaniu ({e}).")

    # 4. Gmail – tylko logowanie, najwyżej raz na dobę (pilnuje tego monitor.yml)
    if os.environ.get("CHECK_GMAIL") == "true":
        user, pw = os.environ.get("GMAIL_USER", ""), os.environ.get("GMAIL_PASSWORD", "")
        if not pw:
            notes.append("Nie ustawiono hasła aplikacji Gmail w GitHub Secrets – pomijam sprawdzanie e-maili.")
        else:
            # znacznik dla monitor.yml: dziś już była próba logowania – kolejny przebieg tego dnia pominie Gmaila
            (ROOT / ".gmail-checked").write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
            try:
                gmail_login(user, pw)
                notes.append("Logowanie do Gmaila: OK.")
            except smtplib.SMTPAuthenticationError:
                problems.append(f"Hasło aplikacji do skrzynki {user} nie działa (np. po zmianie hasła do Gmaila). "
                                f"E-maile z potwierdzeniem konta i resetem hasła prawdopodobnie NIE wychodzą. "
                                f"Utwórz nowe hasło aplikacji i wpisz je w Supabase (SMTP) oraz w GitHub Secrets.")
            except Exception as e:                   # noqa: BLE001
                notes.append(f"Nie udało się połączyć z Gmailem ({e}) – spróbuję jutro.")

    text = report(problems, notes)
    print(text)
    hc = os.environ.get("HC_PING_URL", "").strip()
    if hc:
        ping(hc, not problems, text)
    else:
        print("::warning::Brak HC_PING_URL w GitHub Secrets – meldunek do healthchecks.io nie został wysłany.")
    for p in problems:
        print(f"::error::{p}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
