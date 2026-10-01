"""Full office cycle on three fictional games. Does not touch the live bank."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "docs" / "hermes-skills" / "platewire-f5-engine" / "scripts"
SCRIPT = ENGINE / "analyze_pack.py"


def _side(name: str, ops: float, era: float) -> dict[str, Any]:
    return {
        "ops": ops,
        "ops_l5": ops,
        "ops_l3": ops,
        "ops_l5_sample": 80,
        "ops_l3_sample": 36,
        "mlb_games": 140,
        "team_era": era,
        "team_bullpen_era": era,
        "barrel_pct": 0.09,
        "hardhit_pct": 0.36,
        "lineup_gb_pct": 0.43,
        "sprint_speed": 27.1,
        "fielding_pct": 0.986,
        "oaa": 1,
        "drs": 2,
        "form_win_pct": 0.52,
        "offense_trend": 1.0,
        "avg_risp": 0.25,
        "sp_era": era,
        "sp_fip": era,
        "sp_era_last3": era,
        "sp_ip_avg": 28,
        "sp_season_games_started": 20,
        "sp_k_pct": 0.23,
        "sp_bb_pct": 0.07,
        "sp_fps_pct": 0.6,
        "sp_name": name,
    }


def pack(game_id: str, away: str, home: str, venue: str, *, completed: int, inning: int) -> dict[str, Any]:
    live = None
    if completed:
        live = {
            "completed_innings": completed,
            "inning": inning,
            "inning_half": "top",
            "outs": 0,
            "home_score": 1,
            "away_score": 1,
            "home_sp_pitches": 28,
            "away_sp_pitches": 30,
            "home_inning_runs": [1, 0][:completed],
            "away_inning_runs": [0, 1][:completed],
            "home_inning_hits": [1] * completed,
            "away_inning_hits": [1] * completed,
            "home_inning_hrs": [0] * completed,
            "away_inning_hrs": [0] * completed,
            "home_inning_walks": [0] * completed,
            "away_inning_walks": [0] * completed,
            "home_risp_hits": 1,
            "home_risp_attempts": 3,
            "away_risp_hits": 1,
            "away_risp_attempts": 3,
            "home_sp_ip_today": float(completed),
            "away_sp_ip_today": float(completed),
            "home_sp_k_today": 2,
            "away_sp_k_today": 2,
            "home_sp_bb_today": 1,
            "away_sp_bb_today": 1,
            "home_sp_er_today": 1,
            "away_sp_er_today": 1,
            "home_base_state": "",
            "away_base_state": "",
        }
    track = {
        "ok": True,
        "captured_at": "2026-10-01T12:00:00Z",
        "moneyline": {"home": 2.4, "away": 2.5, "draw": 4.2},
        "main_total": {"line": 4.5, "over": 3.4, "under": 3.2},
    }
    body: dict[str, Any] = {
        "id": game_id,
        "game": {
            "id": game_id,
            "status": "LIVE" if completed else "PREVIEW",
            "home_team": {"abbreviation": home},
            "away_team": {"abbreviation": away},
        },
        "home": {"team": {"abbreviation": home}, "starter": {"last_name": "Home"}},
        "away": {"team": {"abbreviation": away}, "starter": {"last_name": "Away"}},
        "features": {
            "inputs": {
                "venue": venue,
                "day_night": "night",
                "temperature_f": 70,
                "humidity": 50,
                "wind_speed_mph": 6,
                "wind_direction": "out",
                "ump_strike_zone_pct": 0.5,
                "h2h_home_edge": 1.0,
                "home": _side("Home", 0.78, 3.6),
                "away": _side("Away", 0.68, 4.8),
                "input_sources": {"home": {}, "away": {}},
            }
        },
        "odds": {"tracks": {"prematch": track, "inn1": track, "inn2": track}},
        "completeness": 1,
    }
    if live:
        body["features"]["inputs"]["live"] = live
    return body


GAMES = [
    ("g-bos", "NYY", "BOS", "Fenway Park"),
    ("g-sf", "LAD", "SF", "Oracle Park"),
    ("g-sea", "HOU", "SEA", "T-Mobile Park"),
]


def run_script(path: Path, track: str, env: dict[str, str]) -> dict[str, Any]:
    merged = os.environ.copy()
    merged.update(env)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--pack", str(path), "--track", track, "--override-sp"],
        cwd=str(ENGINE),
        env=merged,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "analyze failed")
    return json.loads(proc.stdout)


def login(base: str) -> str:
    env = Path(ROOT / "backend" / ".env").read_text(encoding="utf-8")
    login_name = "admin"
    password = "admin"
    for line in env.splitlines():
        if line.startswith("ADMIN_LOGIN="):
            login_name = line.split("=", 1)[1].strip().strip('"')
        if line.startswith("ADMIN_PASSWORD="):
            password = line.split("=", 1)[1].strip().strip('"')
    body = json.dumps({"login": login_name, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/auth/login",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))["accessToken"]


def api(base: str, token: str, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{base}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def main() -> int:
    errors: list[str] = []
    runtime = Path(tempfile.mkdtemp(prefix="platewire-cycle-"))
    os.environ["PLATEWIRE_RUNTIME"] = str(runtime)
    os.environ["PLATEWIRE_SKIP_TELEGRAM"] = "1"
    sys.path.insert(0, str(ROOT / "desk" / "scripts"))
    from cashier import post_card, send_day_report  # noqa: E402

    work = Path(tempfile.mkdtemp(prefix="platewire-packs-"))
    files = {}
    for game_id, away, home, venue in GAMES:
        path = work / f"{game_id}.json"
        path.write_text(json.dumps(pack(game_id, away, home, venue, completed=0, inning=1)), encoding="utf-8")
        files[game_id] = path

    strict_env = {"PLATEWIRE_FORMULA_VERSION": "v45.1", "PLATEWIRE_VALUE_THRESHOLD": "65", "PLATEWIRE_OVERROUND": "1.05"}
    with ThreadPoolExecutor(max_workers=3) as pool:
        strict = list(pool.map(lambda gid: run_script(files[gid], "prematch", strict_env), [g[0] for g in GAMES]))
    if len(strict) != 3:
        errors.append("parallel prematch did not return 3 games")
    for row in strict:
        mode = (row.get("analysis") or {}).get("simulation_mode")
        if mode != "exact_poisson_pregame":
            errors.append(f"prematch mode {mode}")

    inn1 = pack("g-bos", "NYY", "BOS", "Fenway Park", completed=1, inning=2)
    inn1_path = work / "bos-inn1.json"
    inn1_path.write_text(json.dumps(inn1), encoding="utf-8")
    inn1_row = run_script(inn1_path, "inn1", strict_env)
    if (inn1_row.get("analysis") or {}).get("simulation_mode") != "exact_poisson_live":
        errors.append("inn1 did not switch to live poisson")

    inn2 = pack("g-bos", "NYY", "BOS", "Fenway Park", completed=2, inning=3)
    inn2_path = work / "bos-inn2.json"
    inn2_path.write_text(json.dumps(inn2), encoding="utf-8")
    inn2_row = run_script(inn2_path, "inn2", strict_env)
    if (inn2_row.get("analysis") or {}).get("simulation_mode") != "exact_poisson_live":
        errors.append("inn2 did not stay on live poisson")

    base = "http://localhost:8000/api/v1"
    token = login(base)
    before = api(base, token, "GET", "/office/formula")
    if before.get("version") != "v45.1":
        errors.append(f"active formula before test is {before.get('version')}")
    saved = api(
        base,
        token,
        "POST",
        "/office/formulas",
        {
            "version": "cycle-loose",
            "value_threshold": 1,
            "overround": 1.05,
            "activate": True,
            "notes": "cycle test, not for play",
        },
    )
    active = api(base, token, "GET", "/office/formula")
    if active.get("version") != "cycle-loose" or float(active.get("value_threshold") or 0) != 1:
        errors.append(f"general save did not activate cycle-loose: {active.get('version')} {active.get('value_threshold')}")
    loose_env = {
        "PLATEWIRE_FORMULA_VERSION": str(active.get("version")),
        "PLATEWIRE_VALUE_THRESHOLD": str(active.get("value_threshold")),
        "PLATEWIRE_OVERROUND": str(active.get("overround")),
        "PLATEWIRE_FORMULA_CONSTANTS": json.dumps(active.get("constants") or {}),
    }
    with ThreadPoolExecutor(max_workers=3) as pool:
        loose = list(pool.map(lambda gid: run_script(files[gid], "prematch", loose_env), [g[0] for g in GAMES]))
    bets = []
    for row in loose:
        analysis = row.get("analysis") or {}
        if analysis.get("formula_version") != "cycle-loose":
            errors.append(f"worker kept {analysis.get('formula_version')}")
        found = analysis.get("value_bets") or []
        if not found:
            errors.append(f"no bet for {row.get('matchup')} at threshold 1")
            continue
        bets.append((row, found[0], analysis))

    accepted = 0
    for row, bet, analysis in bets:
        posted = post_card(
            {
                "game_id": row.get("game_id"),
                "matchup": row.get("matchup"),
                "stage": "prematch",
                "trigger": "window_open",
                "formula_version": analysis.get("formula_version"),
                "bet": bet,
                "why": "cycle",
            }
        )
        if posted.get("decision") == "bet":
            accepted += 1
    if accepted != len(bets):
        errors.append(f"cashier accepted {accepted} of {len(bets)}")

    bos = next((item for item in bets if item[0].get("game_id") == "g-bos"), None)
    second = post_card(
        {
            "game_id": "g-bos",
            "matchup": "NYY @ BOS",
            "stage": "inn2",
            "trigger": "stage_changed",
            "formula_version": "cycle-loose",
            "bet": bos[1] if bos else {"market": "total", "side": "over", "line": 4.5, "decimal_odds": 3.4},
        }
    )
    if second.get("reason") != "already_open":
        errors.append(f"second stage was {second.get('reason')}")

    def score_for(bet: dict[str, Any], label: str) -> tuple[int, int]:
        if bet.get("market") == "moneyline":
            home_wins = (label == "win") == (bet.get("side") == "home")
            if bet.get("side") == "away":
                home_wins = label != "win"
            if bet.get("side") == "draw":
                return (2, 2) if label == "win" else (3, 1)
            return (4, 1) if home_wins else (1, 4)
        over = bet.get("side") == "over"
        want_over = (label == "win") == over
        return (4, 3) if want_over else (1, 1)

    for (row, bet, _analysis), label in zip(bets, ["win", "loss", "win"]):
        home_runs, away_runs = score_for(bet, label)
        posted = post_card(
            {
                "reason": "f5_settled",
                "game_id": row.get("game_id"),
                "matchup": row.get("matchup"),
                "f5": {"home": home_runs, "away": away_runs},
                "void": False,
            }
        )
        if posted.get("result") != label:
            errors.append(f"settle {row.get('matchup')} wanted {label} got {posted.get('result')}")

    os.environ.pop("PLATEWIRE_SKIP_TELEGRAM", None)
    report = send_day_report()
    telegram = report.get("telegram") or {}
    if not telegram.get("ok"):
        errors.append(f"day report telegram {telegram}")
    if not report.get("why"):
        errors.append("day report has no note")

    api(base, token, "POST", "/office/formulas/activate", {"version": "v45.1"})
    restored = api(base, token, "GET", "/office/formula")
    if restored.get("version") != "v45.1":
        errors.append(f"formula left on {restored.get('version')}")

    live_budget = json.loads((ROOT / "desk" / "runtime" / "budget.json").read_text(encoding="utf-8"))
    if live_budget.get("open") or float(live_budget.get("bank_units") or 0) != 1000:
        errors.append("live bank was changed")

    summary = report.get("summary") or {}
    print(
        json.dumps(
            {
                "games": 3,
                "strict_modes": [(row.get("analysis") or {}).get("simulation_mode") for row in strict],
                "inn1": (inn1_row.get("analysis") or {}).get("simulation_mode"),
                "inn2": (inn2_row.get("analysis") or {}).get("simulation_mode"),
                "formula_during": active.get("version"),
                "formula_restored": restored.get("version"),
                "accepted": accepted,
                "second_stage": second.get("reason"),
                "won": summary.get("won_units"),
                "lost": summary.get("lost_units"),
                "net": summary.get("net_units"),
                "report_sent": bool(telegram.get("ok")),
                "why": report.get("why"),
                "errors": errors,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
