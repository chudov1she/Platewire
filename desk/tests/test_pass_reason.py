"""Offline checks for the office desk scripts.

Run:  python3 -m pytest desk/tests -q      (or)   python3 desk/tests/test_pass_reason.py
No network, no collector, no Telegram: the pack shapes below are copied from the
live packs of PHI @ ATL (pk 849844).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from run_game import _default_inputs, pass_reason  # noqa: E402

# --- real shapes ------------------------------------------------------------

# What the collector actually served before the game had lineups: every core
# input is a league average, source=default, ready=false.
PACK_COLD = {
    "features": {
        "input_sources": {
            "home_ops": {"value": 0.72, "source": "default", "ready": False},
            "away_ops": {"value": 0.72, "source": "default", "ready": False},
            "home_sp_era": {"value": 4.5, "source": "default", "ready": False},
            "away_sp_era": {"value": 4.5, "source": "default", "ready": False},
            "temperature_f": {"value": 72, "source": "default"},
            "ump_strike_zone_pct": {"value": None, "source": "default", "ready": False},
        }
    }
}

# Once lineups and pitchers arrived: real readings, only the umpire is missing.
PACK_WARM = {
    "features": {
        "input_sources": {
            "home_ops": {"value": 0.743, "source": "feature", "ready": True},
            "away_ops": {"value": 0.758, "source": "feature", "ready": True},
            "home_sp_era": {"value": 1.47, "source": "feature", "ready": True},
            "away_sp_era": {"value": 4.67, "source": "feature", "ready": True},
            "temperature_f": {"value": 72, "source": "open_meteo"},
            "ump_strike_zone_pct": {"value": None, "source": "default", "ready": False},
        }
    }
}

# A live pack: same, plus the live block (which the backend sends as None today).
PACK_LIVE = json.loads(json.dumps(PACK_WARM))
PACK_LIVE["features"]["inputs"] = {"live": None}

ANALYSIS_WITH_MARKETS = {"markets_used": ["moneyline", "total"], "value_bets": []}
ANALYSIS_NO_MARKETS = {"markets_used": [], "value_bets": []}


# --- tests ------------------------------------------------------------------


def test_default_inputs_finds_every_default():
    got = _default_inputs(PACK_COLD)
    assert got == [
        "away_ops",
        "away_sp_era",
        "home_ops",
        "home_sp_era",
        "ump_strike_zone_pct",
    ]
    # temperature_f has no `ready: false`, so it is not a "failed" input.
    assert "temperature_f" not in got


def test_default_inputs_empty_when_everything_ready():
    assert _default_inputs(PACK_WARM) == ["ump_strike_zone_pct"]


def test_cold_pack_is_not_ready_not_no_value():
    """The registry defect: an unreadable game used to be reported as no_value."""
    assert pass_reason(PACK_COLD, ANALYSIS_WITH_MARKETS) == "not_ready"


def test_no_markets_is_its_own_reason():
    assert pass_reason(PACK_COLD, ANALYSIS_NO_MARKETS) == "no_markets"
    assert pass_reason(PACK_WARM, ANALYSIS_NO_MARKETS) == "no_markets"


def test_ready_pack_with_markets_is_no_value():
    """Lineups known, markets priced, formula found no edge — that is no_value."""
    assert pass_reason(PACK_WARM, ANALYSIS_WITH_MARKETS) == "no_value"


def test_one_missing_umpire_alone_does_not_block():
    """A single missing input must not masquerade as 'nothing to read'."""
    assert _default_inputs(PACK_WARM) == ["ump_strike_zone_pct"]
    assert pass_reason(PACK_WARM, ANALYSIS_WITH_MARKETS) == "no_value"


def test_three_missing_inputs_is_not_ready():
    pack = json.loads(json.dumps(PACK_WARM))
    pack["features"]["input_sources"]["home_sp_era"] = {"source": "default", "ready": False}
    pack["features"]["input_sources"]["away_sp_era"] = {"source": "default", "ready": False}
    pack["features"]["input_sources"]["home_ops"] = {"source": "feature", "ready": True}
    pack["features"]["input_sources"]["away_ops"] = {"source": "feature", "ready": True}
    # 3 defaults (2 ERA + ump), no OPS default -> still not_ready by the count rule.
    assert pass_reason(pack, ANALYSIS_WITH_MARKETS) == "not_ready"


def test_missing_features_block_does_not_crash():
    assert pass_reason({}, ANALYSIS_WITH_MARKETS) == "no_value"
    assert pass_reason({"features": {}}, ANALYSIS_WITH_MARKETS) == "no_value"


def test_live_pack_none_live_is_handled():
    """The backend sends live=None; the reason must still be computed."""
    assert pass_reason(PACK_LIVE, ANALYSIS_WITH_MARKETS) == "no_value"


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
