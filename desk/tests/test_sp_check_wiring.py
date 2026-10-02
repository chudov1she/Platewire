"""sp_check must reach the card and the ledger, and exit 3 must not read as a crash.

Defect #6. The engine computed sp_check and put it in its JSON, but run_game took
only `analysis` and `formula_version`, so the pack always carried sp_check=null.
Worse, when the engine refused a mismatch (exit 3) run_game raised RuntimeError,
so a deliberate refusal looked like a formula failure.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import run_game  # noqa: E402

# Some tests below replace run_game.analyze; keep the real one to restore it.
REAL_ANALYZE = run_game.analyze

SP_MISMATCH = {
    "verified": False,
    "reason": "starter_mismatch",
    "compared": 2,
    "mismatches": [{"side": "home", "pack": "Dylan Dodd", "live": "Ray Kerr"}],
    "warnings": ["SP home MISMATCH: pack='Dylan Dodd', live='Ray Kerr'"],
    "pack_home_starter": "Dylan Dodd",
    "pack_away_starter": "Jesús Luzardo",
    "live_home_starter": "Ray Kerr",
    "live_away_starter": "Aaron Nola",
}

SP_OK = {
    "verified": True,
    "reason": None,
    "compared": 2,
    "mismatches": [],
    "warnings": [],
    "pack_home_starter": "Ray Kerr",
    "pack_away_starter": "Aaron Nola",
    "live_home_starter": "Ray Kerr",
    "live_away_starter": "Aaron Nola",
}


def _fake_proc(returncode: int, stdout: str):
    return SimpleNamespace(returncode=returncode, stdout=stdout, stderr="")


def _patch_run(returncode: int, stdout: str):
    run_game.analyze = REAL_ANALYZE  # undo any earlier test's stub
    run_game.subprocess.run = lambda *a, **k: _fake_proc(returncode, stdout)


def test_exit_3_is_a_refusal_not_a_crash():
    """The engine declining to price a mismatched game must come back as data."""
    _patch_run(3, json.dumps({"error": "Starting pitcher mismatch detected", "sp_check": SP_MISMATCH}))
    out = run_game.analyze("g1", "prematch", {"version": "v45.1"})
    assert out["analysis"] == {}, out
    assert out["sp_check"] == SP_MISMATCH, out
    assert "mismatch" in out["engine_error"].lower()


def test_exit_3_with_unparsable_stdout_still_returns_cleanly():
    _patch_run(3, "not json at all")
    out = run_game.analyze("g1", "prematch", {"version": "v45.1"})
    assert out["sp_check"] is None
    assert out["engine_error"]


def test_a_real_failure_still_raises():
    _patch_run(1, "")
    try:
        run_game.analyze("g1", "prematch", {"version": "v45.1"})
    except RuntimeError:
        return
    raise AssertionError("a genuine engine failure must still raise")


def test_successful_run_carries_sp_check_through():
    _patch_run(0, json.dumps({"analysis": {"value_bets": []}, "sp_check": SP_OK}))
    out = run_game.analyze("g1", "prematch", {"version": "v45.1"})
    assert out["sp_check"]["verified"] is True, out


# --- wiring: the card and the ledger ---------------------------------------


def _run_card(result_payload, captured):
    pack = {
        "game": {"id": "g1", "status": "PREVIEW",
                 "home_team": {"abbreviation": "ATL"}, "away_team": {"abbreviation": "PHI"}},
        "completeness": {"has_lineup": True, "has_home_sp": True, "has_away_sp": True,
                         "has_odds": {"prematch": True}, "weather_ready": True},
        "features": {"input_sources": {
            "home_ops": {"source": "feature", "ready": True},
            "away_ops": {"source": "feature", "ready": True}}},
    }

    class C:
        def __init__(self, *_, **__):
            self.base = "http://x/api/v1"
            self.token = "t"

        def pack(self, _g):
            return pack

        def _request(self, *_a, **_k):
            return None

    run_game.PlatewireClient = C
    run_game.repair = lambda *a, **k: []
    run_game.wait_for_fresh_line = lambda c, g, s, p: (p, 3.0, [])
    run_game.load_formula = lambda client=None: {"version": "v45.1"}
    run_game.begin_run = lambda *a, **k: None
    run_game.end_run = lambda *a, **k: None
    run_game.analyze = lambda *a, **k: result_payload
    run_game.explain_pass = lambda card, analysis, reason: "why"
    run_game.explain_bet = lambda card, bet, analysis: "why"

    def fake_post_card(card):
        captured["card"] = card
        return {"decision": "pass", "reason": card.get("pass_reason"), "stake": 0.0}

    run_game.post_card = fake_post_card
    return run_game.run("g1", "window_open", "prematch")


def test_mismatch_reaches_the_card_as_a_pass_reason():
    captured: dict = {}
    _run_card({"analysis": {}, "sp_check": SP_MISMATCH, "engine_error": "Starting pitcher mismatch detected"},
              captured)
    card = captured["card"]
    assert card["sp_check"] == SP_MISMATCH, card
    assert card["pass_reason"].startswith("sp_mismatch"), card


def test_verified_sp_check_is_recorded_on_the_card():
    captured: dict = {}
    _run_card({"analysis": {"value_bets": [], "markets_used": ["moneyline"]}, "sp_check": SP_OK}, captured)
    assert captured["card"]["sp_check"]["verified"] is True


def test_ledger_row_carries_sp_check():
    import cashier

    with tempfile.TemporaryDirectory() as tmp:
        cashier.RUNTIME = Path(tmp)
        cashier.BUDGET_PATH = Path(tmp) / "budget.json"
        cashier.LEDGER = Path(tmp) / "ledger.jsonl"
        cashier.LOCK_PATH = Path(tmp) / "cashier.lock"
        cashier.BUDGET_PATH.write_text(
            json.dumps({"bank_units": 1000, "max_per_game": 10, "max_open_units": 60,
                        "unit": 10, "day": "d", "day_pnl": 0.0, "open": []}),
            encoding="utf-8",
        )
        cashier.send_telegram = lambda *_a, **_k: {"ok": False, "skipped": True, "reason": "t"}
        cashier._touch_board = lambda *_a, **_k: None
        card = {"game_id": "g1", "matchup": "PHI @ ATL", "stage": "prematch",
                "current_stage": "prematch", "bet": None, "pass_reason": "no_value",
                "sp_check": SP_MISMATCH}
        row = cashier.post_card(card)
        assert row["sp_check"] == SP_MISMATCH, row


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except AssertionError as exc:
                failures += 1
                print(f"  FAIL {name}: {exc}")
    print(f"\n{'failures: ' + str(failures) if failures else 'all passed'}")
    sys.exit(1 if failures else 0)
