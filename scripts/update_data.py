#!/usr/bin/env python3
"""Pobiera wyniki Lotto i Lotto Plus i zapisuje je do data/*.json.

Uruchamiane automatycznie przez GitHub Actions (.github/workflows/update-data.yml),
ale można je też odpalić ręcznie:  python scripts/update_data.py

Nie wymaga żadnych dodatkowych bibliotek (tylko standardowa biblioteka Pythona).

Zasady bezpieczeństwa danych:
  * istniejące losowania nigdy nie są usuwane – nowe są DOKLEJANE (po numerze losowania),
  * jeżeli źródło nie odpowie lub zwróci śmieci, plik zostaje bez zmian.

Rzadziej pytamy źródło (mbnet.com.pl, bez zgody i licencji – nie obciążamy go niepotrzebnie).
Tryb ustawia automat w zmiennej UPDATE_MODE:
  * full – zawsze pobieraj (codziennie o 12:00 UTC, ręczne uruchomienie; domyślnie przy uruchomieniu ręcznym
           z komputera) – wczyta też losowanie w nietypowy dzień (święta) i ewentualne poprawki w źródle,
  * auto – pobieraj tylko, gdy w danych brakuje ostatniego losowania z terminarza (wt/czw/sob 22:00
           czasu polskiego); gdy wyniki już są, przebieg nic nie pobiera,
  * push – nie pobieraj (push kodu na main: publikujemy kod z danymi, które już są w repozytorium).
Strażnik (scripts/monitor.py) niezależnie alarmuje, gdy wyników brakuje.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

WARSAW = ZoneInfo("Europe/Warsaw")
DRAW_WEEKDAYS = (1, 3, 5)   # wtorek, czwartek, sobota (poniedziałek = 0)
MODES = ("full", "auto", "push")


def last_scheduled_draw(now: datetime) -> str:
    """Data ostatniego losowania z terminarza (wt/czw/sob 22:00 czasu polskiego), które już się odbyło."""
    today = now.astimezone(WARSAW).date()
    for i in range(8):
        day: date = today - timedelta(days=i)
        drawn = datetime(day.year, day.month, day.day, 22, 0, tzinfo=WARSAW)
        if day.weekday() in DRAW_WEEKDAYS and drawn <= now:
            return day.isoformat()
    raise AssertionError("terminarz bez losowania w ostatnim tygodniu")   # nie powinno się zdarzyć


def should_download(mode: str, latest: dict[str, str | None], now: datetime) -> tuple[bool, str]:
    """Czy pobierać pliki ze źródła. latest = {gra: data ostatniego losowania w danych albo None}."""
    if mode == "push":
        return False, "push kodu – bez pobierania (dane bez zmian)"
    if mode != "auto":
        return True, "pełne pobranie"
    exp = last_scheduled_draw(now)
    missing = [g for g, d in latest.items() if not d or d < exp]
    if missing:
        return True, f"brak losowania z {exp} ({', '.join(missing)}) – pobieram"
    return False, f"dane mają już losowanie z {exp} – bez pobierania"

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

GAMES = {
    "lotto": {
        "file": "lotto.json",
        "sources": [
            "http://www.mbnet.com.pl/dl.txt",
            "https://www.mbnet.com.pl/dl.txt",
        ],
    },
    "lottoplus": {
        "file": "lottoplus.json",
        "sources": [
            "http://www.mbnet.com.pl/dl_plus.txt",
            "https://www.mbnet.com.pl/dl_plus.txt",
        ],
    },
}

# Format linii:  "7431. 14.11.2026 20,32,33,36,40,42"
LINE_RE = re.compile(r"^\s*(\d+)\.\s+(\d{2})\.(\d{2})\.(\d{4})\s+([\d,\s]+)$")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; lotto-data-updater/2.0)",
    "Accept": "text/plain,*/*",
}


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read()
    for enc in ("utf-8", "cp1250", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def parse(text: str) -> list[list]:
    draws = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if not m:
            continue
        no, dd, mm, yyyy, nums_raw = m.groups()
        nums = sorted(int(x) for x in re.findall(r"\d+", nums_raw))
        if len(nums) != 6 or len(set(nums)) != 6 or not all(1 <= n <= 49 for n in nums):
            continue
        draws.append([int(no), f"{yyyy}-{mm}-{dd}", nums])
    return draws


def load_existing(path: Path) -> list[list]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("draws", [])
    except Exception as exc:  # uszkodzony plik – zaczynamy od zera
        print(f"  ! nie można odczytać {path.name}: {exc}")
        return []


def merge(existing: list[list], fresh: list[list]) -> list[list]:
    # Kluczem jest NUMER losowania – dawniej bywało kilka losowań jednego dnia,
    # więc łączenie po dacie gubiłoby dane.
    by_no = {d[0]: d for d in existing}
    for d in fresh:
        by_no[d[0]] = d  # źródło jest nadrzędne dla tego samego numeru
    return sorted(by_no.values(), key=lambda d: d[0])


def update_game(key: str, cfg: dict) -> bool:
    path = DATA_DIR / cfg["file"]
    existing = load_existing(path)
    print(f"[{key}] w bazie: {len(existing)} losowań"
          + (f", ostatnie {existing[-1][1]}" if existing else ""))

    fresh: list[list] = []
    for url in cfg["sources"]:
        try:
            fresh = parse(fetch_text(url))
            if len(fresh) > 100:
                print(f"  OK {url}: {len(fresh)} losowań, ostatnie {fresh[-1][1]}")
                break
            print(f"  ! {url}: za mało danych ({len(fresh)})")
        except Exception as exc:
            print(f"  ! {url}: {exc}")
        fresh = []

    if not fresh:
        print(f"  ! brak nowych danych dla {key} – plik bez zmian")
        return False

    merged = merge(existing, fresh)
    if len(merged) < len(existing):
        print(f"  ! wynik ma mniej losowań ({len(merged)}) niż baza ({len(existing)}) – przerywam")
        return False
    if merged == existing:
        print("  = bez zmian")
        return False

    DATA_DIR.mkdir(exist_ok=True)
    payload = {
        "game": key,
        "source": "mbnet.com.pl",
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(merged),
        "draws": merged,
    }
    path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"  + zapisano {len(merged)} losowań (nowych: {len(merged) - len(existing)})")
    return True


def main() -> int:
    mode = os.environ.get("UPDATE_MODE", "full").strip().lower()
    if mode not in MODES:
        print(f"  ! nieznany UPDATE_MODE={mode!r} – pełne pobranie")
        mode = "full"
    latest = {}
    for key, cfg in GAMES.items():
        existing = load_existing(DATA_DIR / cfg["file"])
        latest[key] = max((d[1] for d in existing), default=None)
    go, why = should_download(mode, latest, datetime.now(timezone.utc))
    print(f"Tryb {mode}: {why}")
    if not go:
        print("Zmiany: nie")
        return 0
    changed = [update_game(k, c) for k, c in GAMES.items()]
    print("Zmiany:", "tak" if any(changed) else "nie")
    return 0


if __name__ == "__main__":
    sys.exit(main())
