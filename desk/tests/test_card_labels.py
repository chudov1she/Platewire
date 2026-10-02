"""The card must not read backwards.

Defect #17. cashier printed bare 'П1' while Winline counts the hosts first, and the
score was rendered away:home. On the PHI @ ATL card that produced 'П1 @ 2.42' and
'0:5', which reads as if П1 (Philadelphia, to a reader) had scored nothing — while
the stake was on ATL, the hosts, who actually won the first five 5:0.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import cashier  # noqa: E402

MATCHUP = "PHI @ ATL"


def test_home_side_names_the_hosts():
    label = cashier._side_label("home", MATCHUP)
    assert label == "П1 (хозяева ATL)", label
    assert "ATL" in label


def test_away_side_names_the_guests():
    assert cashier._side_label("away", MATCHUP) == "П2 (гости PHI)"


def test_totals_are_not_numbered():
    assert cashier._side_label("over", MATCHUP) == "больше"
    assert cashier._side_label("under", MATCHUP) == "меньше"
    assert cashier._side_label("draw", MATCHUP) == "Х (ничья)"


def test_missing_matchup_still_names_the_side():
    assert cashier._side_label("home") == "П1 (хозяева)"
    assert cashier._side_label("away", "") == "П2 (гости)"


def test_score_is_hosts_first_like_winline():
    """The won game: ATL hosts 5, PHI guests 0. Winline shows 5:0."""
    out = cashier._score_label(0, 5, MATCHUP)
    assert out.startswith("5:0"), out
    assert "хозяева ATL" in out
    assert "гости PHI" in out


def test_score_order_differs_from_the_old_rendering():
    """The old code printed away:home, i.e. 0:5 for the same game."""
    old = f"{0}:{5}"
    new = cashier._score_label(0, 5, MATCHUP)
    assert not new.startswith(old), "the score must not stay away:home"


def test_score_without_matchup_is_still_readable():
    out = cashier._score_label(1, 4, "")
    assert out.startswith("4:1"), out


def test_score_survives_missing_values():
    assert cashier._score_label(None, None, MATCHUP) == ""
    assert cashier._score_label("x", "y", MATCHUP) == ""


def test_alert_card_labels_the_side_and_the_score():
    """The end-to-end card: no bare П1, and the score is hosts-first."""
    card = {
        "game_id": "g1",
        "matchup": MATCHUP,
        "stage": "prematch",
        "formula_version": "v45.1",
    }
    bet = {"market": "moneyline", "side": "home", "line": None, "decimal_odds": 2.42, "value_pct": 70.98}
    budget = {"bank_units": 990.0}
    message = cashier._alert(card, bet, 10.0, budget)
    text = message["plain"]
    assert "хозяева ATL" in text, text
    assert "ATL" in text

    settle = {
        "matchup": MATCHUP,
        "result": "win",
        "side": "home",
        "market": "moneyline",
        "line": None,
        "payout": 24.2,
        "day_pnl": 14.2,
        "bank_units": 1014.2,
        "f5": {"home": 5, "away": 0},
    }
    card_msg = cashier._settle_alert(settle, "Ставка зашла")
    flat = " ".join(
        cell["text"]
        for block in card_msg["blocks"]
        if block.get("type") == "table"
        for row in block["cells"]
        for cell in row
    )
    assert "П1 (хозяева ATL)" in flat, flat
    assert "5:0" in flat, "the score must be hosts-first"
    assert "хозяева ATL" in flat and "гости PHI" in flat


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
