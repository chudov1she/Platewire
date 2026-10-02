"""Position recalc: a staked track may be rewritten only inside its own window.

Defect #2. A second signal for the same game used to answer already_open and
leave the position frozen on a line that no longer existed (2.42 while the market
stood at 2.40). The rule mirrors stageOpenForContextRecalc() in f5-scope.ts:

  prematch — open while the game is PREVIEW or in the 1st inning
  inn1     — open during the 2nd inning
  inn2     — open from the 3rd inning through the end of F5
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import cashier  # noqa: E402

BET_242 = {"market": "moneyline", "side": "home", "line": None, "decimal_odds": 2.42}
BET_240 = {"market": "moneyline", "side": "home", "line": None, "decimal_odds": 2.40}


def _budget(stage: str, bet=None):
    b = bet or BET_242
    return {
        "bank_units": 990.0,
        "max_per_game": 10,
        "max_open_units": 60,
        "unit": 10,
        "day": "2026-10-02",
        "day_pnl": 0.0,
        "open": [
            {
                "game_id": "g1",
                "matchup": "PHI @ ATL",
                "stage": stage,
                "stake": 10.0,
                "market": b["market"],
                "side": b["side"],
                "line": b["line"],
                "decimal_odds": b["decimal_odds"],
            }
        ],
    }


def _card(current_stage: str, bet):
    return {"game_id": "g1", "stage": "prematch", "current_stage": current_stage, "bet": bet}


# --- inside the window ------------------------------------------------------


def test_line_moved_inside_the_window_is_rewritten():
    """The live case: prematch stake, market moved 2.42 -> 2.40, still in window."""
    budget = _budget("prematch")
    out = cashier._recalc_open(budget, _card("prematch", BET_240), BET_240)
    assert out["rewritten"] is True, out
    assert out["frozen"] is False
    assert out["before"]["decimal_odds"] == 2.42
    assert out["after"]["decimal_odds"] == 2.40
    assert budget["open"][0]["decimal_odds"] == 2.40
    assert "recalc_at" in budget["open"][0]


def test_same_book_is_left_alone():
    budget = _budget("prematch")
    out = cashier._recalc_open(budget, _card("prematch", BET_242), BET_242)
    assert out["rewritten"] is False
    assert out["same_book"] is True
    assert out["frozen"] is False


def test_side_flip_inside_the_window_is_rewritten():
    budget = _budget("inn1")
    flipped = {"market": "moneyline", "side": "away", "line": None, "decimal_odds": 2.05}
    out = cashier._recalc_open(budget, _card("inn1", flipped), flipped)
    assert out["rewritten"] is True
    assert budget["open"][0]["side"] == "away"


def test_total_line_move_is_rewritten():
    budget = _budget("inn2", {"market": "total", "side": "over", "line": 4.5, "decimal_odds": 1.75})
    moved = {"market": "total", "side": "over", "line": 4, "decimal_odds": 1.67}
    out = cashier._recalc_open(budget, _card("inn2", moved), moved)
    assert out["rewritten"] is True
    assert budget["open"][0]["line"] == 4
    assert out["before"]["line"] == 4.5


# --- frozen outside the window ---------------------------------------------


def test_past_the_window_the_row_is_frozen():
    """prematch stake, game already in the 3rd: the old line must stand."""
    budget = _budget("prematch")
    out = cashier._recalc_open(budget, _card("inn2", BET_240), BET_240)
    assert out["rewritten"] is False
    assert out["frozen"] is True
    assert budget["open"][0]["decimal_odds"] == 2.42, "a frozen row must not move"


def test_next_stage_does_not_touch_the_previous_track():
    budget = _budget("inn1")
    out = cashier._recalc_open(budget, _card("inn2", BET_240), BET_240)
    assert out["frozen"] is True
    assert budget["open"][0]["decimal_odds"] == 2.42


def test_stage_ahead_of_the_game_is_not_rewritten():
    """A track ahead of the game clock is not open yet."""
    budget = _budget("inn2")
    out = cashier._recalc_open(budget, _card("inn1", BET_240), BET_240)
    assert out["frozen"] is True
    assert budget["open"][0]["decimal_odds"] == 2.42


def test_no_open_position_returns_none():
    budget = _budget("prematch")
    budget["open"] = []
    assert cashier._recalc_open(budget, _card("prematch", BET_240), BET_240) is None


# --- wiring: post_card must use it -----------------------------------------


def test_post_card_reports_recalculated_instead_of_already_open():
    """End-to-end through post_card on an isolated runtime."""
    with tempfile.TemporaryDirectory() as tmp:
        cashier.RUNTIME = Path(tmp)
        cashier.BUDGET_PATH = Path(tmp) / "budget.json"
        cashier.LEDGER = Path(tmp) / "ledger.jsonl"
        cashier.LOCK_PATH = Path(tmp) / "cashier.lock"
        cashier.BUDGET_PATH.write_text(json.dumps(_budget("prematch")), encoding="utf-8")
        # no Telegram, no board
        cashier.send_telegram = lambda *_a, **_k: {"ok": False, "skipped": True, "reason": "test"}
        cashier._touch_board = lambda *_a, **_k: None
        cashier.send_telegram_to_board = lambda *_a, **_k: None

        row = cashier.post_card(_card("prematch", BET_240))
        assert row["reason"] == "recalculated", row
        assert row["decision"] == "bet"
        assert row["stake"] == 10.0, "a recalc must not charge the bank twice"
        assert row["recalc"]["before"]["decimal_odds"] == 2.42
        assert row["recalc"]["after"]["decimal_odds"] == 2.40
        assert row["bank_units"] == 990.0, "recalc must not move the bank"


def test_post_card_reports_already_open_when_frozen():
    with tempfile.TemporaryDirectory() as tmp:
        cashier.RUNTIME = Path(tmp)
        cashier.BUDGET_PATH = Path(tmp) / "budget.json"
        cashier.LEDGER = Path(tmp) / "ledger.jsonl"
        cashier.LOCK_PATH = Path(tmp) / "cashier.lock"
        cashier.BUDGET_PATH.write_text(json.dumps(_budget("prematch")), encoding="utf-8")
        cashier.send_telegram = lambda *_a, **_k: {"ok": False, "skipped": True, "reason": "test"}
        cashier._touch_board = lambda *_a, **_k: None

        row = cashier.post_card(_card("inn2", BET_240))
        assert row["reason"] == "already_open", row
        assert row["recalc"]["frozen"] is True
        assert row["bank_units"] == 990.0


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
