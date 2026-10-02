"""Line freshness: a verdict must not ride on a stale snapshot.

Reproduces the PHI @ ATL race — the verdict used a snapshot from 15:53:51 while
the market had already moved by 23:00:42 — against a fake collector, with no
network and no Telegram.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import run_game  # noqa: E402


def _pack(age_seconds: float | None, ok: bool = True, stage: str = "prematch"):
    as_of = {"odds": {}}
    if age_seconds is not None:
        stamp = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        as_of["odds"][stage] = stamp.isoformat().replace("+00:00", "Z")
    return {
        "game": {"id": "g1", "status": "PREVIEW"},
        "as_of": as_of,
        "odds": {"tracks": {stage: ({"ok": ok, "main_total": {"line": 6}} if ok else {"ok": False})}},
    }


class FakeClient:
    """Serves the stale pack first, then the fresh one, and counts refreshes."""

    def __init__(self, ages):
        self.ages = list(ages)
        self.refreshes = 0
        self.pack_calls = 0

    def pack(self, _game_id):
        self.pack_calls += 1
        age = self.ages.pop(0) if len(self.ages) > 1 else self.ages[0]
        return _pack(age, stage="prematch")

    def _request(self, _method, path, _body=None):
        if "/odds/f5" in path:
            self.refreshes += 1
        return None


def _wait(client):
    run_game.post = lambda c, path, body=None, timeout=180: c._request("POST", path, body)
    return run_game.wait_for_fresh_line(client, "g1", "prematch", client.pack("g1"))


def test_stale_line_triggers_refresh_and_returns_the_fresh_one():
    """The live case: 25 608 s old on arrival, fresh after the refresh."""
    client = FakeClient([25608, 2.0])
    pack, age, notes = _wait(client)
    assert client.refreshes >= 1, "must have asked the collector for a new read"
    assert age is not None and age <= run_game.MAX_LINE_AGE_S, age
    assert any(n.startswith("refresh_odds") for n in notes), notes
    assert pack["odds"]["tracks"]["prematch"]["ok"] is True


def test_fresh_line_is_used_as_is():
    client = FakeClient([5.0])
    pack, age, notes = _wait(client)
    assert client.refreshes == 0, "a fresh line must not cost a scrape"
    assert notes == []
    assert age is not None and age <= run_game.MAX_LINE_AGE_S


def test_gives_up_after_three_attempts_and_reports_the_real_age():
    """If the collector never serves a fresh line, the age is still recorded."""
    client = FakeClient([9000.0])
    pack, age, notes = _wait(client)
    assert client.refreshes == 3, client.refreshes
    assert age is not None and age > run_game.MAX_LINE_AGE_S
    assert len([n for n in notes if n.startswith("refresh_odds")]) == 3


def test_bad_track_is_treated_as_stale_even_when_recent():
    """ok=false means there is no line, whatever its timestamp."""
    client = FakeClient([1.0])
    client.pack = lambda _g: _pack(1.0, ok=False)  # always a failed read
    pack, age, notes = _wait(client)
    assert client.refreshes == 3, client.refreshes


def test_missing_timestamp_does_not_crash():
    client = FakeClient([None])
    pack, age, notes = _wait(client)
    assert age is None


def test_threshold_is_configurable():
    assert run_game.MAX_LINE_AGE_S == 180.0


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
