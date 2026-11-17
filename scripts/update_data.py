#!/usr/bin/env python3
"""Pobiera wyniki Lotto i Lotto Plus i zapisuje je do data/*.json.

Uruchamiane automatycznie przez GitHub Actions (.github/workflows/update-data.yml),
ale można je też odpalić ręcznie:  python scripts/update_data.py

Nie wymaga żadnych dodatkowych bibliotek (tylko standardowa biblioteka Pythona).

Zasady bezpieczeństwa danych:
  * istniejące losowania nigdy nie są usuwane – nowe są DOKLEJANE (po dacie),
  * jeżeli źródło nie odpowie lub zwróci śmieci, plik zostaje bez zmian.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

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
    changed = [update_game(k, c) for k, c in GAMES.items()]
    print("Zmiany:", "tak" if any(changed) else "nie")
    return 0


if __name__ == "__main__":
    sys.exit(main())
