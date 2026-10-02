"""The office must actually CALL pass_reason, not just import it.

Runs run_game.run() against a fake collector so the wiring is checked, not the
helper in isolation. No network: PlatewireClient, repair and the engine runner
are monkeypatched.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import run_game  # noqa: E402

COLD_PACK = {
    "game": {
        "id": "fake-game-1",
        "status": "PREVIEW",
        "home_team": {"abbreviation": "ATL"},
        "away_team": {"abbreviation": "PHI"},
    },
    "completeness": {
        "has_lineup": True,
        "has_home_sp": True,
        "has_away_sp": True,
        "has_odds": {"prematch": True, "inn1": False, "inn2": False},
        "weather_ready": True,
    },
    "features": {
        "input_sources": {
            "home_ops": {"value": 0.72, "source": "default", "ready": False},
            "away_ops": {"value": 0.72, "source": "default", "ready": False},
            "home_sp_era": {"value": 4.5, "source": "default", "ready": False},
            "away_sp_era": {"value": 4.5, "source": "default", "ready": False},
        }
    },
}

WARM_PACK = {
    **COLD_PACK,
    "features": {
        "input_sources": {
            "home_ops": {"value": 0.743, "source": "feature", "ready": True},
            "away_ops": {"value": 0.758, "source": "feature", "ready": True},
            "home_sp_era": {"value": 1.47, "source": "feature", "ready": True},
            "away_sp_era": {"value": 4.67, "source": "feature", "ready": True},
        }
    },
}

# Markets exist, but the formula finds nothing.
ANALYSIS = {
    "formula_version": "v45.1",
    "markets_used": ["moneyline"],
    "value_bets": [],
    "value_threshold_pct": 65,
}


class FakeClient:
    def __init__(self, *_, **__):
        self.pack_calls = 0
        self.base = "http://127.0.0.1:8000/api/v1"
        self.token = "tok"

    def pack(self, _game_id):
        self.pack_calls += 1
        return FakeClient.pack_payload

    def _request(self, *_a, **_k):
        return None

    def ensure_token(self):
        return "tok"


def _run_once(pack_payload, captured):
    FakeClient.pack_payload = pack_payload
    run_game.PlatewireClient = FakeClient
    run_game.repair = lambda *a, **k: []  # no collector repairs in the test
    # A fresh line is served, so the freshness gate is a no-op here — the pass
    # reason is what this test is about.
    run_game.wait_for_fresh_line = lambda client, game_id, stage, pack: (pack, 5.0, [])
    run_game.analyze = lambda *a, **k: {"analysis": ANALYSIS}
    run_game.begin_run = lambda *a, **k: None
    run_game.end_run = lambda *a, **k: None
    run_game.explain_pass = lambda card, analysis, reason: captured.setdefault("explain_reason", reason) or "why"
    run_game.load_formula = lambda client=None: {"version": "v45.1"}

    def fake_post_card(card):
        captured["card"] = card
        return {
            "decision": "bet" if card.get("bet") else "pass",
            "reason": "accepted" if card.get("bet") else card.get("pass_reason"),
            "stake": 10.0 if card.get("bet") else 0.0,
        }

    run_game.post_card = fake_post_card
    return run_game.run("fake-game-1", "window_open", "prematch")


def test_run_reports_not_ready_for_a_cold_pack():
    captured: dict = {}
    posted = _run_once(COLD_PACK, captured)
    assert posted["reason"] == "not_ready", posted
    assert captured["card"]["pass_reason"] == "not_ready"
    # the explanation must be asked about the same reason
    assert captured["explain_reason"] == "not_ready"


def test_run_reports_no_value_for_a_ready_pack():
    captured: dict = {}
    posted = _run_once(WARM_PACK, captured)
    assert posted["reason"] == "no_value", posted
    assert captured["explain_reason"] == "no_value"


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
