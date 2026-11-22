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


class SameNight(unittest.TestCase):
    # sobota 21.11.2026: losowanie 22:00 czasu polskiego = 21:00 UTC; nocny Strażnik 23:30 UTC
    def test_oczekiwane_losowanie(self):
        self.assertEqual(M.expected_draw(at("2026-11-21T23:30:00Z")), "2026-11-21")
        self.assertEqual(M.expected_draw(at("2026-11-21T23:29:00Z")), "2026-11-19")   # 2 h 29 min – jeszcze nie
        self.assertEqual(M.expected_draw(at("2026-11-21T23:00:00Z")), "2026-11-19")   # przed 2,5 h
        self.assertEqual(M.expected_draw(at("2026-11-23T10:00:00Z")), "2026-11-21")   # poniedziałek

    def test_lato_23_30_utc_to_1_30_czasu_polskiego(self):
        # wtorek 14.07.2026: losowanie 20:00 UTC, nocny Strażnik 23:30 UTC = 3,5 h później
        self.assertEqual(M.expected_draw(at("2026-07-14T23:30:00Z")), "2026-07-14")

    def test_wyniki_sa_bez_alarmu(self):
        self.assertIsNone(M.missing_draw_problem("lotto", "2026-11-21", at("2026-11-21T23:30:00Z")))

    def test_brak_wynikow_tej_nocy(self):
        p = M.missing_draw_problem("lottoplus", "2026-11-19", at("2026-11-21T23:30:00Z"))
        self.assertIn("Lotto Plus", p)
        self.assertIn("21.11.2026", p)
        self.assertIn("Jeśli dziś lub wczoraj było święto, losowanie mogło zostać przesunięte", p)

    def test_przed_2_5_h_bez_alarmu(self):
        self.assertIsNone(M.missing_draw_problem("lotto", "2026-11-19", at("2026-11-21T23:00:00Z")))

    def test_po_3_5_dnia_alarmuje_tylko_results_problem(self):
        now = at("2026-11-21T23:30:00Z")
        self.assertIsNone(M.missing_draw_problem("lotto", "2026-11-14", now))
        self.assertIsNotNone(M.results_problem("lotto", "2026-11-14", now))

    def test_brak_danych(self):
        self.assertIsNone(M.missing_draw_problem("lotto", None, at("2026-11-21T23:30:00Z")))


class Numbering(unittest.TestCase):
    SITE = [[1, "2026-11-14", [1, 2, 3, 4, 5, 6]], [2, "2026-11-17", [7, 8, 9, 10, 11, 12]],
            [3, "2026-11-19", [13, 14, 15, 16, 17, 18]], [4, "2026-11-21", [21, 25, 30, 36, 43, 44]]]

    def db(self, *rows):
        return [{"no": n, "draw_date": d, "nums": x} for n, d, x in rows]

    def test_wszystko_zgodne(self):
        rows = self.db(*[tuple(r) for r in reversed(self.SITE)])
        self.assertIsNone(M.numbering_problem("lotto", self.SITE, rows))

    def test_baza_w_tyle_to_nie_dziura(self):
        rows = self.db(*[tuple(r) for r in reversed(self.SITE[:3])])
        self.assertIsNone(M.numbering_problem("lotto", self.SITE, rows))

    def test_kolejnosc_liczb_bez_znaczenia(self):
        rows = self.db((4, "2026-11-21", [44, 43, 36, 30, 25, 21]))
        self.assertIsNone(M.numbering_problem("lotto", self.SITE, rows))

    def test_dziura_na_stronie(self):
        site = [self.SITE[0], self.SITE[1], self.SITE[3]]
        p = M.numbering_problem("lotto", site, None)
        self.assertIn("na stronie brakuje", p)
        self.assertIn("po nr 2 jest nr 4", p)

    def test_dziura_w_bazie(self):
        rows = self.db(tuple(self.SITE[3]), tuple(self.SITE[1]))
        p = M.numbering_problem("lottoplus", self.SITE, rows)
        self.assertIn("Lotto Plus", p)
        self.assertIn("w bazie brakuje", p)

    def test_inne_liczby_lub_data_w_bazie(self):
        rows = self.db((4, "2026-11-21", [21, 25, 30, 36, 43, 45]), (3, "2026-11-20", [13, 14, 15, 16, 17, 18]))
        p = M.numbering_problem("lotto", self.SITE, rows)
        self.assertIn("inne dane", p)
        self.assertIn("nr 3, 4", p)

    def test_prawdziwe_pliki_z_repozytorium_bez_dziur(self):
        for game in M.GAME_NAMES:
            data = json.loads((Path(M.ROOT) / "data" / f"{game}.json").read_text(encoding="utf-8"))
            self.assertIsNone(M.numbering_problem(game, data["draws"], None), game)


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


class Push(unittest.TestCase):
    # losowanie czw 19.11.2026 22:00 czasu polskiego = 21:00 UTC
    BASE = {"draw_no": 7300, "draw_date": "2026-11-19", "draw_time": "2026-11-19T21:00:00+00:00"}

    def h(self, **kw):
        return {**self.BASE, "started_at": None, "finished_at": None, "attempts": None, "has_error": None, **kw}

    def test_przed_uplywem_3_h_bez_alarmu(self):
        self.assertIsNone(M.push_problem(self.h(), at("2026-11-20T00:00:00Z")))

    def test_nie_uruchomione(self):
        p = M.push_problem(self.h(), at("2026-11-20T01:15:00Z"))
        self.assertIn("nie zostały uruchomione", p)
        self.assertIn("19.11.2026", p)

    def test_udane(self):
        ok = self.h(started_at="2026-11-19T22:10:00+00:00", finished_at="2026-11-19T22:10:20+00:00",
                    attempts=1, has_error=False, users=5, sent=6, failed=0)
        self.assertIsNone(M.push_problem(ok, at("2026-11-20T01:15:00Z")))

    def test_blad(self):
        bad = self.h(started_at="2026-11-19T22:10:00+00:00", finished_at="2026-11-19T22:10:20+00:00",
                     attempts=3, has_error=True)
        self.assertIn("błędem", M.push_problem(bad, at("2026-11-20T01:15:00Z")))

    def test_niezakonczone(self):
        hang = self.h(started_at="2026-11-19T23:00:00+00:00", attempts=1, has_error=False)
        self.assertIsNone(M.push_problem(hang, at("2026-11-19T23:50:00Z")))     # przed 3 h
        self.assertIn("nie zakończyła", M.push_problem(hang, at("2026-11-20T01:15:00Z")))

    def test_nieudane_wysylki(self):
        part = self.h(started_at="2026-11-19T22:10:00+00:00", finished_at="2026-11-19T22:10:20+00:00",
                      attempts=1, has_error=False, users=5, sent=4, failed=2)
        p = M.push_problem(part, at("2026-11-20T01:15:00Z"))
        self.assertIn("nieudane 2", p)
        self.assertIn("19.11.2026", p)

    def test_stare_losowanie_i_brak_danych(self):
        self.assertIsNone(M.push_problem(self.h(), at("2026-11-24T22:00:00Z")))
        self.assertIsNone(M.push_problem(None, at("2026-11-20T01:15:00Z")))


class Report(unittest.TestCase):
    def test_raport(self):
        self.assertIn("Wszystko działa", M.report([], []))
        r = M.report(["A", "B"], ["info"])
        self.assertIn("PROBLEMY (2)", r)
        self.assertIn("1. A", r)
        self.assertIn("- info", r)


if __name__ == "__main__":
    unittest.main()
