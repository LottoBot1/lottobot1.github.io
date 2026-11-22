"""Testy reguły „czy pobierać wyniki ze źródła” (scripts/update_data.py) – bez sieci.
Uruchomienie: python -m unittest discover -s tests -p "test_*.py"
"""
import re
import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import update_data as U  # noqa: E402


def at(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Schedule(unittest.TestCase):
    def test_ostatnie_losowanie_z_terminarza(self):
        # sobota 21.11.2026: losowanie 22:00 czasu polskiego = 21:00 UTC
        self.assertEqual(U.last_scheduled_draw(at("2026-11-21T20:59:00Z")), "2026-11-19")
        self.assertEqual(U.last_scheduled_draw(at("2026-11-21T21:00:00Z")), "2026-11-21")
        self.assertEqual(U.last_scheduled_draw(at("2026-11-23T12:00:00Z")), "2026-11-21")   # poniedziałek

    def test_lato(self):
        # wtorek 14.07.2026: 22:00 czasu polskiego = 20:00 UTC
        self.assertEqual(U.last_scheduled_draw(at("2026-07-14T19:59:00Z")), "2026-07-11")
        self.assertEqual(U.last_scheduled_draw(at("2026-07-14T20:05:00Z")), "2026-07-14")


class ShouldDownload(unittest.TestCase):
    HAVE = {"lotto": "2026-11-21", "lottoplus": "2026-11-21"}

    def test_push_nigdy_nie_pobiera(self):
        go, _ = U.should_download("push", {"lotto": None, "lottoplus": None}, at("2026-11-21T22:00:00Z"))
        self.assertFalse(go)

    def test_pelne_zawsze_pobiera(self):
        go, _ = U.should_download("full", self.HAVE, at("2026-11-22T12:00:00Z"))
        self.assertTrue(go)

    def test_auto_wyniki_sa_bez_pobierania(self):
        # noc losowania po wczytaniu wyników i ranek następnego dnia
        for now in ("2026-11-21T22:35:00Z", "2026-11-22T05:15:00Z", "2026-11-23T20:05:00Z"):
            go, why = U.should_download("auto", self.HAVE, at(now))
            self.assertFalse(go, now)
            self.assertIn("2026-11-21", why)

    def test_auto_brak_wynikow_pobiera(self):
        go, why = U.should_download("auto", {"lotto": "2026-11-19", "lottoplus": "2026-11-21"}, at("2026-11-21T22:05:00Z"))
        self.assertTrue(go)
        self.assertIn("lotto", why)

    def test_auto_tylko_plus_brakuje(self):
        go, _ = U.should_download("auto", {"lotto": "2026-11-21", "lottoplus": "2026-11-19"}, at("2026-11-21T22:05:00Z"))
        self.assertTrue(go)

    def test_auto_przed_losowaniem_bez_pobierania(self):
        go, _ = U.should_download("auto", {"lotto": "2026-11-19", "lottoplus": "2026-11-19"}, at("2026-11-21T20:05:00Z"))
        self.assertFalse(go)

    def test_auto_pusty_plik_pobiera(self):
        go, _ = U.should_download("auto", {"lotto": None, "lottoplus": "2026-11-21"}, at("2026-11-22T05:15:00Z"))
        self.assertTrue(go)

    def test_losowanie_w_nietypowy_dzien_wczyta_przebieg_o_12(self):
        # np. dodatkowe losowanie w poniedziałek 28.12.2026 (święta): dane mają sobotę 26.12, więc przebiegi
        # „auto” go nie szukają, ale przebieg o 12:00 UTC we wtorek pobiera pełne pliki
        have = {"lotto": "2026-12-26", "lottoplus": "2026-12-26"}
        self.assertFalse(U.should_download("auto", have, at("2026-12-28T22:30:00Z"))[0])
        self.assertFalse(U.should_download("auto", have, at("2026-12-29T05:15:00Z"))[0])
        self.assertTrue(U.should_download("full", have, at("2026-12-29T12:00:00Z"))[0])


class Workflow(unittest.TestCase):
    def test_tryby_w_automacie(self):
        yml = (Path(U.ROOT) / ".github" / "workflows" / "update-data.yml").read_text(encoding="utf-8")
        line = re.search(r"UPDATE_MODE: (.+)", yml).group(1)
        self.assertIn("github.event_name == 'push' && 'push'", line)
        self.assertIn("github.event.schedule == '0 12 * * *'", line)
        self.assertIn("'full'", line)
        self.assertIn("'auto'", line)
        self.assertIn('cron: "0 12 * * *"', yml, "przebieg o 12:00 UTC nadal w harmonogramie")

    def test_tryb_domyslny_to_pelne_pobranie(self):
        self.assertEqual(U.MODES[0], "full")


if __name__ == "__main__":
    unittest.main()
