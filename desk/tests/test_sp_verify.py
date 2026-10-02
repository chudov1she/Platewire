"""verify_starting_pitchers must not report a pass it never performed.

Defect #5. On the live pack it returned verified=True with every field empty:
Game has no homeStarter/awayStarter columns, and game.status arrives as the string
'FINAL', which the check coerced to {}. Nothing was compared, and the caller read
verified=True as 'starters confirmed'.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "docs" / "hermes-skills"
                   / "platewire-f5-engine" / "scripts"))

import analyze_pack as A  # noqa: E402

# The real pack: starters present, game.status a bare string, no starter fields.
PACK_REAL = {
    "game": {"status": "FINAL", "mlb_game_pk": 849844},
    "home": {"starter": {"first_name": "Dylan", "last_name": "Dodd", "mlb_player_id": 689266}},
    "away": {"starter": {"first_name": "Jesús", "last_name": "Luzardo", "mlb_player_id": 666200}},
}

# A status that does carry starters, agreeing with the pack.
PACK_AGREE = {
    "game": {"status": {"home_starter": {"first_name": "Ray", "last_name": "Kerr"},
                        "away_starter": {"first_name": "Aaron", "last_name": "Nola"}}},
    "home": {"starter": {"first_name": "Ray", "last_name": "Kerr"}},
    "away": {"starter": {"first_name": "Aaron", "last_name": "Nola"}},
}

# A status that disagrees with the pack.
PACK_MISMATCH = {
    "game": {"status": {"home_starter": {"first_name": "Ray", "last_name": "Kerr"},
                        "away_starter": {"first_name": "Aaron", "last_name": "Nola"}}},
    "home": {"starter": {"first_name": "Dylan", "last_name": "Dodd"}},
    "away": {"starter": {"first_name": "Jesús", "last_name": "Luzardo"}},
}


def test_no_live_starters_is_not_verified():
    """The live case: nothing to compare, so verified must be False."""
    out = A.verify_starting_pitchers(PACK_REAL)
    assert out["verified"] is False, out
    assert out["reason"] == "no_live_starter_data", out
    assert out["pack_home_starter"] == "Dylan Dodd"
    assert out["live_home_starter"] == ""


def test_agreeing_starters_are_verified():
    out = A.verify_starting_pitchers(PACK_AGREE)
    assert out["verified"] is True, out
    assert out["reason"] is None
    assert out["compared"] == 2


def test_disagreeing_starters_are_caught():
    """The mismatch the defect was about: Dodd/Luzardo vs Kerr/Nola."""
    out = A.verify_starting_pitchers(PACK_MISMATCH)
    assert out["verified"] is False, out
    assert out["reason"] == "starter_mismatch"
    sides = {m["side"] for m in out["mismatches"]}
    assert sides == {"home", "away"}, out
    assert any("Dodd" in w and "Kerr" in w for w in out["warnings"]), out["warnings"]


def test_one_side_is_enough_to_compare():
    pack = {
        "game": {"status": {"home_starter": {"first_name": "Ray", "last_name": "Kerr"}}},
        "home": {"starter": {"first_name": "Ray", "last_name": "Kerr"}},
        "away": {"starter": {"first_name": "Jesús", "last_name": "Luzardo"}},
    }
    out = A.verify_starting_pitchers(pack)
    assert out["verified"] is True, out
    assert out["compared"] == 1


def test_empty_pack_does_not_crash():
    out = A.verify_starting_pitchers({})
    assert out["verified"] is False
    assert out["reason"] == "no_live_starter_data"


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
