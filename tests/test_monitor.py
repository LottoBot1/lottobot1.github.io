"""Testy Strażnika (scripts/monitor.py) – progi alarmów, bez sieci.
Uruchomienie: python -m unittest discover -s tests -p "test_*.py"
"""
import base64
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import monitor as M  # noqa: E402

UTC = timezone.utc


def at(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def jwt(payload: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    return f"{enc({'alg': 'HS256'})}.{enc(payload)}.podpis"


class DrawInstant(unittest.TestCase):
    def test_22_czasu_polskiego_zima_i_lato(self):
        self.assertEqual(M.draw_instant("2026-11-17"), at("2026-11-17T21:00:00Z"))
        self.assertEqual(M.draw_instant("2026-07-14"), at("2026-07-14T20:00:00Z"))


class Results(unittest.TestCase):
    def test_zwykla_przerwa_sobota_wtorek_bez_alarmu(self):
        # sobota 14.11 22:00 → wtorek 17.11 tuż przed północą (wyniki jeszcze nie przyszły)
        self.assertIsNone(M.results_problem("lotto", "2026-11-14", at("2026-11-17T23:30:00Z")))

    def test_prog_3_5_dnia(self):
        last = "2026-11-14"                      # 14.11 21:00 UTC
        self.assertIsNone(M.results_problem("lotto", last, at("2026-11-18T09:00:00Z")))   # 3,5 dnia równo
        p = M.results_problem("lotto", last, at("2026-11-18T09:01:00Z"))
        self.assertIsNotNone(p)

    def test_tresc_alarmu_ze_swietem(self):
        p = M.results_problem("lottoplus", "2026-12-19", at("2026-12-27T08:00:00Z"))
        self.assertIn("Lotto Plus", p)
        self.assertIn("19.12.2026", p)
        self.assertIn("Jeśli dziś lub wczoraj było święto, losowanie mogło zostać przesunięte", p)

    def test_brak_wynikow(self):
        self.assertIsNotNone(M.results_problem("lotto", None, at("2026-11-18T09:00:00Z")))


class Database(unittest.TestCase):
    def test_baza_aktualna(self):
        self.assertIsNone(M.db_problem("lotto", "2026-11-17", "2026-11-17", at("2026-11-19T08:00:00Z")))

    def test_baza_chwile_w_tyle_bez_alarmu(self):
        # losowanie 17.11 21:00 UTC, po 7 h baza może jeszcze czekać
        self.assertIsNone(M.db_problem("lotto", "2026-11-17", "2026-11-14", at("2026-11-18T04:00:00Z")))

    def test_baza_w_tyle_ponad_8_h(self):
        p = M.db_problem("lotto", "2026-11-17", "2026-11-14", at("2026-11-18T05:30:00Z"))
        self.assertIn("17.11.2026", p)
        self.assertIn("14.11.2026", p)

    def test_pusta_baza(self):
        self.assertIn("brak", M.db_problem("lotto", "2026-11-17", None, at("2026-11-19T08:00:00Z")))

    def test_brak_wynikow_na_stronie_to_nie_problem_bazy(self):
        self.assertIsNone(M.db_problem("lotto", None, None, at("2026-11-19T08:00:00Z")))


class Workflow(unittest.TestCase):
    def test_udany(self):
        self.assertIsNone(M.workflow_problem([{"status": "completed", "conclusion": "success"}]))

    def test_nieudany(self):
        p = M.workflow_problem([{"status": "completed", "conclusion": "failure", "html_url": "https://x/1"}])
        self.assertIn("https://x/1", p)

    def test_w_trakcie_liczy_sie_ostatni_zakonczony(self):
        runs = [{"status": "in_progress"}, {"status": "completed", "conclusion": "success"}]
        self.assertIsNone(M.workflow_problem(runs))
        runs = [{"status": "queued"}, {"status": "completed", "conclusion": "failure"}]
        self.assertIsNotNone(M.workflow_problem(runs))

    def test_brak_przebiegow(self):
        self.assertIsNone(M.workflow_problem([]))


class PublicKeyOnly(unittest.TestCase):
    def test_klucz_anon(self):
        self.assertTrue(M.key_is_public(jwt({"role": "anon", "ref": "x"})))

    def test_klucz_service_role_odrzucony(self):
        self.assertFalse(M.key_is_public(jwt({"role": "service_role", "ref": "x"})))

    def test_nowe_klucze(self):
        self.assertTrue(M.key_is_public("sb_publishable_abc123"))
        self.assertFalse(M.key_is_public("sb_secret_abc123"))

    def test_smieci(self):
        for k in ["", "abc", "a.b.c", None]:
            self.assertFalse(M.key_is_public(k or ""))

    def test_klucz_z_config_js_jest_publiczny(self):
        url, key = M.supabase_config()
        self.assertTrue(url.startswith("https://"))
        self.assertTrue(M.key_is_public(key))


class Report(unittest.TestCase):
    def test_raport(self):
        self.assertIn("Wszystko działa", M.report([], []))
        r = M.report(["A", "B"], ["info"])
        self.assertIn("PROBLEMY (2)", r)
        self.assertIn("1. A", r)
        self.assertIn("- info", r)


if __name__ == "__main__":
    unittest.main()
