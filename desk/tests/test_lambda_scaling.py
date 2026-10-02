"""Guards on lambda scaling and on the state the engine reports for a given input.

Two things this pins down, both checked on the engine itself rather than by eye:

1. The review claimed lambda is not scaled to the F5 span in the prematch branch.
   It is: expected runs == per-inning lambda * 5, and the live branch multiplies by
   the remaining innings. This test keeps that true.

2. The pack really sent live=None while the game was in the 3rd inning at 3:0
   (verified against the collector). The engine then reports the *pregame* mode and
   pregame expected runs — it does not know the game has started. Nothing in the
   output flags the contradiction, which is how a live verdict ended up written on
   pregame numbers.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "docs" / "hermes-skills"
                   / "platewire-f5-engine" / "scripts"))

import analyze_pack as A  # noqa: E402

INPUTS = {
    "home": {"ops": 0.72, "team_era": 4.5, "sp_era": 1.47, "bull_era": 4.5, "fielding_pct": 0.985,
             "barrel_pct": 0.09, "hardhit_pct": 0.38, "gb_pct": 0.45, "sprint_speed": 27},
    "away": {"ops": 0.72, "team_era": 4.5, "sp_era": 4.67, "bull_era": 4.5, "fielding_pct": 0.985,
             "barrel_pct": 0.09, "hardhit_pct": 0.38, "gb_pct": 0.45, "sprint_speed": 27},
    "venue": "Truist Park", "temperature_f": 72, "day_night": "night", "input_sources": {},
}

LIVE_3RD = {
    "completed_innings": 2, "home_score": 3, "away_score": 0,
    "inning": 3, "inning_half": "top",
    "home_inning_runs": [3, 0], "away_inning_runs": [0, 0],
    "home_inning_hits": [2, 1], "away_inning_hits": [0, 0],
    "home_inning_walks": [0, 0], "away_inning_walks": [0, 0],
    "home_sp_pitches": 34, "away_sp_pitches": 51,
}


def _built():
    b = A.build_lambdas(INPUTS)
    return b["lambda_home"], b["lambda_away"]


def test_prematch_lambda_is_scaled_over_five_innings():
    lh, _ = _built()
    res = A.analyze(dict(INPUTS), [])
    assert res["simulation_mode"] == "exact_poisson_pregame"
    assert abs(res["expected_home_runs"] - lh * 5) < 1e-6, res["expected_home_runs"]
    assert res["lambda_home"] == lh, "the reported lambda stays per-inning"


def test_live_lambda_is_scaled_over_the_remaining_innings():
    """The live branch scales the *live-adjusted* lambda, not the pregame one.

    On a 3:0 game the live modules pull the home lambda down (0.3943 -> 0.3176),
    and expected runs are the three already scored plus that lambda over the three
    remaining F5 innings.
    """
    res = A.analyze({**INPUTS, "live": LIVE_3RD}, [])
    assert res["simulation_mode"] == "exact_poisson_live"
    remaining = A.remaining_f5_innings(2, 3, "top")
    assert remaining == 3

    live_lambdas = A.build_lambdas({**INPUTS, "live": LIVE_3RD})
    lh_live = live_lambdas["lambda_home"]
    assert lh_live != _built()[0], "the live modules must move lambda, else this proves nothing"
    assert abs(res["expected_home_runs"] - (3 + lh_live * remaining)) < 1e-6, res["expected_home_runs"]


def test_no_live_reports_the_pregame_mode():
    res = A.analyze({**INPUTS, "live": None}, [])
    assert res["simulation_mode"] == "exact_poisson_pregame"


def test_a_started_game_without_live_is_indistinguishable_from_pregame():
    """The trap: the engine cannot tell 'not started' from 'started, data missing'.

    That is exactly what the pack produced. The two results are identical, so a
    caller must not rely on the mode to notice a missing live block — the caller
    has to compare the game clock with the input it was handed.
    """
    pregame = A.analyze(dict(INPUTS), [])
    missing_live = A.analyze({**INPUTS, "live": None}, [])
    assert pregame["simulation_mode"] == missing_live["simulation_mode"]
    assert abs(pregame["expected_home_runs"] - missing_live["expected_home_runs"]) < 1e-9


def test_live_and_pregame_differ_when_live_is_present():
    """Sanity: had live been sent, the numbers would not have matched pregame."""
    pregame = A.analyze(dict(INPUTS), [])
    live = A.analyze({**INPUTS, "live": LIVE_3RD}, [])
    assert abs(pregame["expected_home_runs"] - live["expected_home_runs"]) > 0.5


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
