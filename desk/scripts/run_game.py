"""One game, one stage: fill holes, run the pinned formula, hand the card to the cashier."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "docs" / "hermes-skills" / "platewire-f5-engine" / "scripts"
FORMULA = ROOT / "desk" / "formula" / "production.json"
sys.path.insert(0, str(ENGINE))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cashier import post_card  # noqa: E402
from explain import explain_bet, explain_pass, model_read  # noqa: E402
from platewire_client import PlatewireClient  # noqa: E402


def office_call(client: PlatewireClient, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    try:
        return client._request(method, path, body)
    except SystemExit:
        return None


def begin_run(client: PlatewireClient, fields: dict[str, Any]) -> str | None:
    row = office_call(client, "POST", "/office/runs", fields)
    if isinstance(row, dict) and row.get("id"):
        return str(row["id"])
    return None


def end_run(client: PlatewireClient, run_id: str | None, status: str, summary: str) -> None:
    if not run_id:
        return
    office_call(client, "POST", f"/office/runs/{run_id}/finish", {"status": status, "summary": summary})


def load_formula(client: PlatewireClient | None = None) -> dict[str, Any]:
    if client is not None:
        try:
            remote = client._request("GET", "/office/formula")
            if isinstance(remote, dict) and remote.get("version"):
                return remote
        except SystemExit:
            pass
    file_formula = json.loads(FORMULA.read_text(encoding="utf-8"))
    return {
        "version": file_formula.get("version") or "v45.1",
        "value_threshold": file_formula.get("value_threshold") or 65,
        "overround": file_formula.get("overround") or 1.05,
        "constants": {},
    }


def post(client: PlatewireClient, path: str, body: dict[str, Any], timeout: int = 180) -> Any:
    url = f"{client.base}{path}"
    if not client.token:
        client.ensure_token()
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {client.token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        return {"ok": False, "error": f"HTTP {exc.code}: {detail}"}


def gaps_for(pack: dict[str, Any], stage: str) -> list[str]:
    comp = pack.get("completeness") or {}
    odds = comp.get("has_odds") or {}
    missing: list[str] = []
    if not comp.get("has_lineup"):
        missing.append("lineup")
    if not comp.get("has_home_sp") or not comp.get("has_away_sp"):
        missing.append("pitchers")
    if not odds.get(stage):
        missing.append("odds")
    if not comp.get("weather_ready"):
        missing.append("weather")
    return missing


def repair(client: PlatewireClient, game_id: str, stage: str, missing: list[str]) -> list[str]:
    notes: list[str] = []
    if "lineup" in missing or "pitchers" in missing:
        notes.append("refresh_context")
        post(client, f"/games/{game_id}/context/refresh", {})
    if "weather" in missing:
        notes.append("refresh_weather")
        post(client, f"/games/{game_id}/weather/refresh", {})
    if "odds" in missing:
        notes.append("refresh_odds")
        post(
            client,
            f"/games/{game_id}/odds/f5",
            {"require_markets": False, "force": True, "stage": stage},
        )
    return notes


def analyze(game_id: str, stage: str, formula: dict[str, Any]) -> dict[str, Any]:
    env = os.environ.copy()
    env["PLATEWIRE_FORMULA_VERSION"] = str(formula.get("version") or "v45.1")
    env["PLATEWIRE_VALUE_THRESHOLD"] = str(formula.get("value_threshold") or 65)
    env["PLATEWIRE_OVERROUND"] = str(formula.get("overround") or 1.05)
    constants = formula.get("constants")
    if isinstance(constants, dict) and constants:
        env["PLATEWIRE_FORMULA_CONSTANTS"] = json.dumps(constants)
    script = ENGINE / "analyze_pack.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--game-id", game_id, "--track", stage],
        cwd=str(ENGINE),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "analyze_pack failed")
    return json.loads(proc.stdout)


def f5_runs(mlb_game_pk: int) -> dict[str, int] | None:
    """Sum the first five innings from the MLB linescore. None until all five are played.

    PLATEWIRE_F5_SCORE="home:away" overrides the fetch — used by rehearsal.py to
    drive a synthetic game through settlement without a real MLB linescore.
    """
    override = (os.environ.get("PLATEWIRE_F5_SCORE") or "").strip()
    if override:
        parts = override.split(":")
        if len(parts) == 2:
            try:
                return {"home": int(parts[0]), "away": int(parts[1])}
            except ValueError:
                pass
    url = f"https://statsapi.mlb.com/api/v1.1/game/{mlb_game_pk}/feed/live"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        feed = json.loads(resp.read().decode("utf-8"))
    innings = ((feed.get("liveData") or {}).get("linescore") or {}).get("innings") or []
    home = away = 0
    seen = 0
    for inn in innings:
        num = inn.get("num")
        if not isinstance(num, int) or num > 5:
            continue
        home_runs = (inn.get("home") or {}).get("runs")
        away_runs = (inn.get("away") or {}).get("runs")
        if home_runs is None or away_runs is None:
            return None
        home += int(home_runs)
        away += int(away_runs)
        seen += 1
    if seen < 5:
        return None
    return {"home": home, "away": away}


def settle(game_id: str, reason: str) -> dict[str, Any]:
    client = PlatewireClient()
    game = client.game(game_id)
    if "home_score" not in game and isinstance(game.get("game"), dict):
        game = game["game"]
    status = str(game.get("status") or "")
    pk = game.get("mlb_game_pk")
    card: dict[str, Any] = {
        "reason": reason,
        "game_id": game_id,
        "matchup": _matchup(game),
        "void": False,
        "f5": None,
    }
    runs = None
    if pk:
        for _ in range(4):
            try:
                runs = f5_runs(int(pk))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                runs = None
            if runs:
                break
            time.sleep(3)
    if runs:
        card["f5"] = runs
    elif status == "FINAL":
        card["void"] = True
    else:
        print(json.dumps({"ok": False, "error": "f5 score not ready"}, ensure_ascii=False))
        return {"ok": False, "error": "f5 score not ready"}
    posted = post_card(card)
    office_call(client, "POST", f"/office/games/{game_id}/settled", {"reason": reason})
    print(json.dumps(posted, ensure_ascii=False, indent=2))
    return posted


def _default_inputs(pack: dict[str, Any]) -> list[str]:
    """Inputs the formula had to fill with a league average instead of a real read."""
    sources = ((pack.get("features") or {}).get("input_sources") or {})
    out: list[str] = []
    for key, value in sources.items():
        if not isinstance(value, dict):
            continue
        if value.get("source") == "default" and value.get("ready") is False:
            out.append(key)
    return sorted(out)


def pass_reason(pack: dict[str, Any], analysis: dict[str, Any]) -> str:
    """Why there is no bet. `not_ready` means there was nothing to read, not that
    the formula looked and found no edge — the two must not share a reason."""
    if not analysis.get("markets_used"):
        return "no_markets"
    defaults = _default_inputs(pack)
    if "home_ops" in defaults or "away_ops" in defaults:
        # Offense strength is the core input: on league averages there is no read.
        return "not_ready"
    if len(defaults) >= 3:
        return "not_ready"
    return "no_value"


def run(game_id: str, reason: str, stage: str) -> dict[str, Any]:
    if reason in {"final", "f5_settled"}:
        return settle(game_id, reason)
    client = PlatewireClient()
    formula = load_formula(client)

    pack = client.pack(game_id)
    missing = gaps_for(pack, stage)
    repairs: list[str] = []
    if missing:
        repairs = repair(client, game_id, stage, missing)
        pack = client.pack(game_id)
        missing = gaps_for(pack, stage)

    game = pack.get("game") or {}
    home = ((game.get("home_team") or {}).get("abbreviation")) or "HOME"
    away = ((game.get("away_team") or {}).get("abbreviation")) or "AWAY"
    card: dict[str, Any] = {
        "game_id": game.get("id") or game_id,
        "matchup": f"{away} @ {home}",
        "stage": stage,
        "trigger": reason,
        "formula_version": formula.get("version"),
        "gaps": missing,
        "repairs": repairs,
        "bet": None,
        "pass_reason": None,
    }
    run_id = begin_run(
        client,
        {
            "game_id": card["game_id"],
            "matchup": card["matchup"],
            "reason": reason,
            "stage": stage,
            "formula": formula.get("version"),
        },
    )
    if "odds" in missing:
        card["pass_reason"] = "missing_odds"
    else:
        try:
            result = analyze(card["game_id"], stage, formula)
        except (RuntimeError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
            card["pass_reason"] = f"formula_error: {exc}"
            result = {}
        analysis = (result.get("analysis") or {}) if result else {}
        bets = analysis.get("value_bets") or []
        card["formula_version"] = analysis.get("formula_version") or formula.get("version")
        if bets:
            card["bet"] = bets[0]
            card["read"] = model_read(analysis, bets[0])
            card["why"] = explain_bet(card, bets[0], analysis)
        elif not card["pass_reason"]:
            card["pass_reason"] = pass_reason(pack, analysis)
        if not card["bet"]:
            card["pass_why"] = explain_pass(card, analysis, str(card["pass_reason"]))
    posted = post_card(card)
    end_run(
        client,
        run_id,
        "done",
        f"{posted.get('decision')} {posted.get('reason')} stake={posted.get('stake')}",
    )
    print(json.dumps({"card": card, "ledger": posted}, ensure_ascii=False, indent=2))
    return posted


def _matchup(game: dict[str, Any]) -> str:
    home = ((game.get("home_team") or {}).get("abbreviation")) or "HOME"
    away = ((game.get("away_team") or {}).get("abbreviation")) or "AWAY"
    return f"{away} @ {home}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Platewire office worker for one game")
    p.add_argument("--game-id", required=True)
    p.add_argument("--reason", default="manual")
    p.add_argument("--stage", default="prematch", choices=["prematch", "inn1", "inn2"])
    args = p.parse_args(argv)
    run(args.game_id, args.reason, args.stage)
    return 0


if __name__ == "__main__":
    sys.exit(main())
