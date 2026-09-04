#!/usr/bin/env python3
"""Analyze a Platewire game pack with After-5 v42 math (Hermes-side)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

# Allow sibling import when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from platewire_client import PlatewireClient  # noqa: E402

FORMULA_VERSION = "v42"
OVERROUND = 1.05
VALUE_THRESHOLD = 65.0
LEAGUE_ERA = 4.5
LEAGUE_OPS = 0.72
LEAGUE_BARREL = 0.085
LEAGUE_HARDHIT = 0.35
LEAGUE_SPRINT = 27.0
LAMBDA_MIN = 0.05
LAMBDA_MAX = 1.5
PROB_CAP = 0.92

PARK_FACTORS = {
    "coors field": 1.15,
    "fenway park": 1.05,
    "comerica park": 0.98,
    "oracle park": 0.96,
    "petco park": 0.97,
    "wrigley field": 1.04,
    "yankee stadium": 1.03,
    "great american ball park": 1.06,
}


def clamp_lambda(value: float) -> float:
    return max(LAMBDA_MIN, min(LAMBDA_MAX, value))


def cap_prob(p: float, cap: float = PROB_CAP) -> float:
    return min(p, cap)


def predictive_era(era: float, fip: float | None, era_last7: float | None, ip_avg: float | None, team_era: float) -> float:
    parts: list[tuple[float, float]] = [(era, 0.4)]
    if fip is not None:
        parts.append((fip, 0.35))
    if era_last7 is not None:
        parts.append((era_last7, 0.25))
    weight_sum = sum(w for _, w in parts)
    p_era = sum(v * w for v, w in parts) / weight_sum
    sample_weight = min(1.0, (ip_avg or 0) / 30)
    if sample_weight < 1:
        blend = team_era if team_era > 0 else LEAGUE_ERA
        p_era = p_era * sample_weight + blend * (1 - sample_weight)
    return p_era


def fps_factor(fps_pct: float | None) -> float:
    if fps_pct is None:
        return 1.0
    if fps_pct >= 0.65:
        return 0.97
    if fps_pct <= 0.55:
        return 1.05
    return 1.0


def speed_bonus(sprint_speed: float) -> float:
    return 1 + (sprint_speed - LEAGUE_SPRINT) * 0.015


def mqi_multiplier(batter: dict[str, Any], pitcher: dict[str, Any]) -> float:
    mqi = 1.0
    mqi += (batter["barrel_pct"] - LEAGUE_BARREL) * 0.6
    mqi += (batter["hardhit_pct"] - LEAGUE_HARDHIT) * 0.35
    if pitcher.get("k_pct") is not None and pitcher.get("bb_pct") is not None:
        mqi += (pitcher["k_pct"] - pitcher["bb_pct"]) * 0.02
    speed_penalty = max(0.0, (batter["sprint_speed"] - LEAGUE_SPRINT) * 0.01)
    gidp = batter["gb_pct"] * pitcher["gb_pct"] * (1 + speed_penalty)
    mqi -= gidp * 0.15
    if pitcher["gb_pct"] >= 0.44:
        mqi *= 0.8
    if batter["barrel_pct"] >= 0.1:
        mqi *= 1.1
    return max(0.75, min(1.35, mqi))


def defense_adj(fielding_pct: float, oaa: float | None, drs: float | None) -> float:
    if oaa is not None or drs is not None:
        return max(0.9, min(1.1, 1 - (oaa or 0) * 0.008 - (drs or 0) * 0.006))
    return max(0.9, min(1.05, 0.97 + (fielding_pct - 0.985) * 2))


def weather_wif(inputs: dict[str, Any]) -> float:
    temp_mult = 1.0
    tf = inputs.get("temperature_f")
    if tf is not None:
        temp_c = ((tf - 32) * 5) / 9
        if temp_c > 25:
            temp_mult = 1.02
        elif temp_c < 10:
            temp_mult = 0.98
        elif tf <= 63:
            temp_mult = 0.95
        elif tf >= 86:
            temp_mult = 1.1
        else:
            temp_mult = 0.95 + ((tf - 63) * (1.1 - 0.95)) / (86 - 63)
    humidity = inputs.get("humidity")
    humidity_mult = 1.03 if humidity is not None and humidity > 80 else 1.0
    wind_mult = 1.0
    wspd = inputs.get("wind_speed_mph")
    if wspd is not None and wspd > 0:
        direction = inputs.get("wind_direction_deg") or 0
        tail = math.cos((direction * math.pi) / 180)
        wind_mult = max(0.92, min(1.08, 1 + (wspd / 10) * tail / 20))
    return max(0.9, min(1.15, temp_mult * humidity_mult * wind_mult))


def umpire_uif(strike_zone_pct: float | None, accuracy_above_x: float | None) -> float:
    if accuracy_above_x is not None and math.isfinite(accuracy_above_x):
        if accuracy_above_x >= 1:
            return 0.98
        if accuracy_above_x <= -1:
            return 1.04
    if strike_zone_pct is None:
        return 1.0
    if strike_zone_pct > 0.66:
        return 0.97
    if strike_zone_pct < 0.6:
        return 1.05
    return 1.0


def park_factor(venue: str | None) -> tuple[float, float]:
    key = (venue or "").lower()
    factor = 1.0
    for name, value in PARK_FACTORS.items():
        if name in key:
            factor = value
            break
    chaos = 1.2 if "coors" in key else 1.0
    return factor, chaos


def park_time_factor(venue: str | None, day_night: str | None, park_base: float) -> float:
    key = (venue or "").lower()
    dn = (day_night or "").lower()
    night = dn in {"night", "n", "pm"}
    day = (not night) and dn in {"day", "d", "am"}
    if "coors" in key:
        return park_base * (1.1 if day else 1.0)
    if "wrigley" in key and day:
        return park_base * 1.05
    if "petco" in key and night:
        return park_base * 0.95
    if "oracle" in key and night:
        return park_base * 0.92
    return park_base


def form_factor(form_win_pct: float | None) -> float:
    if form_win_pct is None:
        return 1.0
    return 0.9 + form_win_pct * 0.2


def offense_trend_factor(trend: float | None) -> float:
    if trend is None:
        return 1.0
    if trend > 1.1:
        return 1 + (trend - 1) * 0.15
    if trend < 0.85:
        return 1 - (1 - trend) * 0.1
    return 1.0


def hr_risk_factor(sp_gb_pct: float, barrel_pct: float, hardhit_pct: float) -> float:
    hr_risk = (1 - sp_gb_pct) * barrel_pct * hardhit_pct
    if hr_risk > 0.013:
        return min(1.08, 1 + (hr_risk - 0.013) * 3)
    return 1.0


def team_profile(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "ops": float(t.get("ops") or LEAGUE_OPS),
        "team_era": float(t.get("team_era") or LEAGUE_ERA),
        "barrel_pct": float(t.get("barrel_pct") or LEAGUE_BARREL),
        "hardhit_pct": float(t.get("hardhit_pct") or LEAGUE_HARDHIT),
        "gb_pct": float(t.get("lineup_gb_pct") if t.get("lineup_gb_pct") is not None else t.get("gb_pct") or 0.42),
        "sprint_speed": float(t.get("sprint_speed") or LEAGUE_SPRINT),
        "fielding_pct": float(t.get("fielding_pct") or 0.985),
        "oaa": t.get("oaa"),
        "drs": t.get("drs"),
        "form_win_pct": t.get("form_win_pct"),
        "offense_trend": t.get("offense_trend"),
    }


def pitcher_profile(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "era": float(t.get("sp_era") or LEAGUE_ERA),
        "fip": t.get("sp_fip"),
        "era_last7": t.get("sp_era_last7"),
        "ip_avg": t.get("sp_ip_avg"),
        "gb_pct": float(t.get("gb_pct") or 0.42),
        "k_pct": t.get("sp_k_pct"),
        "bb_pct": t.get("sp_bb_pct"),
        "fps_pct": t.get("sp_fps_pct"),
    }


def build_side_lambda(
    offense: dict[str, Any],
    defense: dict[str, Any],
    opposing_pitcher: dict[str, Any],
    park_time: float,
    weather_factor: float,
    ump_factor: float,
    h2h_edge: float = 1.0,
) -> tuple[float, dict[str, float]]:
    p_era = predictive_era(
        opposing_pitcher["era"],
        opposing_pitcher.get("fip"),
        opposing_pitcher.get("era_last7"),
        opposing_pitcher.get("ip_avg"),
        defense["team_era"],
    )
    era_adj = (
        (p_era / LEAGUE_ERA)
        * park_time
        * weather_factor
        * ump_factor
        * fps_factor(opposing_pitcher.get("fps_pct"))
    )
    bat = (offense["ops"] / LEAGUE_OPS) * speed_bonus(offense["sprint_speed"])
    matchup = mqi_multiplier(offense, opposing_pitcher)
    d_adj = defense_adj(defense["fielding_pct"], defense.get("oaa"), defense.get("drs"))
    live_adj = (
        form_factor(offense.get("form_win_pct"))
        * offense_trend_factor(offense.get("offense_trend"))
        * h2h_edge
        * 1.015
        * hr_risk_factor(opposing_pitcher["gb_pct"], offense["barrel_pct"], offense["hardhit_pct"])
    )
    lam = clamp_lambda(0.5 * bat * era_adj * matchup * d_adj * live_adj)
    return lam, {
        "p_era": round(p_era, 3),
        "era_adj": round(era_adj, 4),
        "bat": round(bat, 4),
        "matchup": round(matchup, 4),
        "defense": round(d_adj, 4),
        "live_adj": round(live_adj, 4),
    }


def first_inning_momentum(runs_allowed: float | None, pitches: float | None) -> float:
    if runs_allowed is None:
        return 1.0
    if runs_allowed == 0 and (pitches is None or pitches <= 18):
        return 0.85
    if runs_allowed == 1:
        return 1.15
    if runs_allowed >= 2:
        return 1.25
    return 1.0


def pitcher_fatigue_multiplier(pitches: float | None) -> float:
    if pitches is None:
        return 1.0
    return max(0.7, 1 - (pitches / 500) * 3)


def fatigue_burst(pitches: float | None, inning: int) -> float:
    if pitches is None or pitches < 70:
        return 1.0
    if inning >= 4:
        frac = min(1.0, (pitches - 70) / 14)
        return 1.18 + frac * 0.07
    return 1.0


def compute_live_lambdas(base_home: float, base_away: float, live: dict[str, Any]) -> tuple[float, float, dict[str, float]]:
    mom_home = first_inning_momentum(live.get("home_runs_inning1"), live.get("home_sp_pitches"))
    mom_away = first_inning_momentum(live.get("away_runs_inning1"), live.get("away_sp_pitches"))
    fatigue_home = pitcher_fatigue_multiplier(live.get("home_sp_pitches"))
    fatigue_away = pitcher_fatigue_multiplier(live.get("away_sp_pitches"))
    adj_home = base_home * mom_away * (2 - fatigue_away)
    adj_away = base_away * mom_home * (2 - fatigue_home)
    completed = int(live.get("completed_innings") or 0)
    adj_home *= fatigue_burst(live.get("away_sp_pitches"), completed)
    adj_away *= fatigue_burst(live.get("home_sp_pitches"), completed)
    return clamp_lambda(adj_home), clamp_lambda(adj_away), {
        "mom_home_from_away_sp": mom_away,
        "mom_away_from_home_sp": mom_home,
        "fatigue_home_sp": fatigue_home,
        "fatigue_away_sp": fatigue_away,
    }


def poisson_pmf(k: int, lam: float) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    log_fact = sum(math.log(i) for i in range(2, k + 1))
    return math.exp(-lam + k * math.log(lam) - log_fact)


def exact_poisson_f5(
    lambda_home: float,
    lambda_away: float,
    remaining_innings: float,
    base_home: float,
    base_away: float,
    max_runs: int = 12,
) -> dict[str, float]:
    lam_h = max(0.01, lambda_home * remaining_innings)
    lam_a = max(0.01, lambda_away * remaining_innings)
    home_pmf = [poisson_pmf(k, lam_h) for k in range(max_runs + 1)]
    away_pmf = [poisson_pmf(k, lam_a) for k in range(max_runs + 1)]
    p_home = p_tie = p_away = p_over = total_w = 0.0
    for h_add in range(max_runs + 1):
        for a_add in range(max_runs + 1):
            w = home_pmf[h_add] * away_pmf[a_add]
            total_w += w
            fh = base_home + h_add
            fa = base_away + a_add
            margin = fa - fh
            if margin > 0.5:
                p_away += w
            elif margin < -0.5:
                p_home += w
            else:
                p_tie += w
            if fh + fa > 4.5:
                p_over += w
    if total_w <= 0:
        return {
            "p_home_lead": 0.33,
            "p_tie": 0.34,
            "p_away_lead": 0.33,
            "p_over_4_5": 0.5,
            "avg_total": 4.5,
        }
    return {
        "p_home_lead": p_home / total_w,
        "p_tie": p_tie / total_w,
        "p_away_lead": p_away / total_w,
        "p_over_4_5": p_over / total_w,
        "avg_total": base_home + base_away + lam_h + lam_a,
    }


def remaining_f5_innings(completed: int, inning: int | None = None, inning_half: str | None = None) -> int:
    if completed >= 5:
        return 0
    rem = 5 - max(0, completed)
    if inning is not None and inning <= 5 and (inning_half or "").lower() in {"top", "bottom"}:
        # conservative: at least 1 while F5 unfinished
        rem = max(1, rem)
    return max(0, rem)


def is_sane_f5_odds(odds: float, market: str, side: str | None = None) -> bool:
    if not math.isfinite(odds) or odds < 1.15:
        return False
    if market == "moneyline" and side == "draw":
        return odds <= 15
    return odds <= 5.5


def track_to_markets(track: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not track:
        return []
    out: list[dict[str, Any]] = []
    ml = track.get("moneyline")
    if isinstance(ml, dict):
        for side, key in (("home", "home"), ("away", "away"), ("draw", "draw")):
            if ml.get(key) is None:
                continue
            odds = float(ml[key])
            if is_sane_f5_odds(odds, "moneyline", side):
                out.append({"market": "moneyline", "side": side, "decimal_odds": odds})
    total = track.get("main_total")
    if isinstance(total, dict) and total.get("line") is not None:
        line = float(total["line"])
        for side in ("over", "under"):
            if total.get(side) is None:
                continue
            odds = float(total[side])
            if is_sane_f5_odds(odds, "total", side):
                out.append(
                    {
                        "market": "total",
                        "side": side,
                        "decimal_odds": odds,
                        "line": line,
                    }
                )
    return out


def implied_prob(decimal_odds: float, overround: float = OVERROUND) -> float:
    return 1 / decimal_odds / overround


def value_pct(my_prob: float, implied: float) -> float:
    if implied <= 0:
        return 0.0
    return ((my_prob - implied) / implied) * 100


def roi_pct(my_prob: float, odds: float) -> float:
    return (my_prob * (odds - 1) - (1 - my_prob)) * 100


def prob_total_over(lam: float, line: float) -> float:
    lambda_ = max(0.01, lam)
    if abs((line % 1) - 0.5) < 0.01:
        min_runs = int(line) + 1
    elif line == int(line):
        min_runs = max(1, int(line) + 1)
    else:
        min_runs = int(line) + 1
    p_at_or_below = sum(poisson_pmf(k, lambda_) for k in range(min_runs))
    return max(0.0, min(1.0, 1 - p_at_or_below))


def evaluate_markets(sim: dict[str, float], markets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bets: list[dict[str, Any]] = []
    for market in markets:
        if market["market"] == "moneyline":
            if market["side"] == "home":
                model = sim.get("p_home_lead", 0)
            elif market["side"] == "away":
                model = sim.get("p_away_lead", 0)
            else:
                model = sim.get("p_tie", 0)
        elif market["market"] == "total":
            line = market.get("line") or 4.5
            if abs(line - 4.5) < 0.001:
                p_over = sim.get("p_over_4_5", 0.5)
            else:
                p_over = prob_total_over(sim.get("avg_total", 4.5), line)
            model = p_over if market["side"] == "over" else 1 - p_over
        else:
            continue
        implied = implied_prob(market["decimal_odds"])
        bets.append(
            {
                "market": market["market"],
                "side": market["side"],
                "decimal_odds": market["decimal_odds"],
                "line": market.get("line"),
                "implied_pct": implied * 100,
                "model_prob": model * 100,
                "value_pct": value_pct(model, implied),
                "roi_pct": roi_pct(model, market["decimal_odds"]),
            }
        )
    bets.sort(key=lambda b: b["value_pct"], reverse=True)
    return bets


def build_lambdas(inputs: dict[str, Any]) -> dict[str, Any]:
    park_base, chaos = park_factor(inputs.get("venue"))
    park_time = park_time_factor(inputs.get("venue"), inputs.get("day_night"), park_base)
    weather = weather_wif(inputs)
    ump = umpire_uif(inputs.get("ump_strike_zone_pct"), inputs.get("ump_accuracy_above_x"))
    if (
        inputs.get("ump_strike_zone_pct") is None
        and inputs.get("ump_accuracy_above_x") is None
        and (inputs.get("ump_pitcher_bias") or 1) != 1
    ):
        ump = float(inputs.get("ump_pitcher_bias") or 1)

    home_off = team_profile(inputs.get("home") or {})
    away_off = team_profile(inputs.get("away") or {})
    home_p = pitcher_profile(inputs.get("home") or {})
    away_p = pitcher_profile(inputs.get("away") or {})

    home_side, home_bd = build_side_lambda(
        home_off, away_off, away_p, park_time, weather, ump, float(inputs.get("h2h_home_edge") or 1)
    )
    away_side, away_bd = build_side_lambda(away_off, home_off, home_p, park_time, weather, ump)

    lambda_home, lambda_away = home_side, away_side
    live_meta: dict[str, float] = {}
    live = inputs.get("live")
    if isinstance(live, dict) and int(live.get("completed_innings") or 0) >= 1:
        lambda_home, lambda_away, live_meta = compute_live_lambdas(home_side, away_side, live)

    notes = [
        f"formula={FORMULA_VERSION}",
        f"park={park_time:.3f}",
        f"weather={weather:.3f}",
        f"ump={ump:.3f}",
        f"chaos={chaos:.1f}",
    ]
    return {
        "lambda_home": lambda_home,
        "lambda_away": lambda_away,
        "chaos": chaos,
        "notes": notes,
        "breakdown": {
            "home": home_bd,
            "away": away_bd,
            "park_time": round(park_time, 4),
            "weather": round(weather, 4),
            "ump": round(ump, 4),
            "live": live_meta,
        },
    }


def analyze(inputs: dict[str, Any], markets: list[dict[str, Any]]) -> dict[str, Any]:
    built = build_lambdas(inputs)
    lh, la = built["lambda_home"], built["lambda_away"]
    live = inputs.get("live") if isinstance(inputs.get("live"), dict) else None
    if live and int(live.get("completed_innings") or 0) >= 1:
        rem = remaining_f5_innings(
            int(live.get("completed_innings") or 0),
            live.get("inning"),
            live.get("inning_half"),
        )
        rem = max(1, rem)
        sim = exact_poisson_f5(lh, la, rem, float(live.get("home_score") or 0), float(live.get("away_score") or 0))
        mode = "exact_poisson_live"
        expected_home = float(live.get("home_score") or 0) + lh * rem
        expected_away = float(live.get("away_score") or 0) + la * rem
    else:
        sim = exact_poisson_f5(lh, la, 5, 0, 0)
        mode = "exact_poisson_pregame"
        expected_home = lh * 5
        expected_away = la * 5

    sim_capped = {
        "p_home_lead": cap_prob(sim["p_home_lead"]),
        "p_tie": cap_prob(sim["p_tie"]),
        "p_away_lead": cap_prob(sim["p_away_lead"]),
        "p_over_4_5": cap_prob(sim["p_over_4_5"]),
        "avg_total": sim["avg_total"],
    }
    all_bets = evaluate_markets(sim_capped, markets)
    value_bets = [b for b in all_bets if b["value_pct"] >= VALUE_THRESHOLD]
    return {
        "formula_version": FORMULA_VERSION,
        "simulation_mode": mode,
        "lambda_home": lh,
        "lambda_away": la,
        "expected_home_runs": expected_home,
        "expected_away_runs": expected_away,
        "expected_total": expected_home + expected_away,
        **sim_capped,
        "value_threshold_pct": VALUE_THRESHOLD,
        "overround": OVERROUND,
        "value_bets": value_bets,
        "all_bets": all_bets,
        "notes": built["notes"],
        "breakdown": built["breakdown"],
        "markets_used": len(markets) > 0,
        "market_count": len(markets),
    }


def load_pack(args: argparse.Namespace) -> dict[str, Any]:
    if args.pack:
        return json.loads(Path(args.pack).read_text(encoding="utf-8"))
    if not args.game_id:
        raise SystemExit("Provide --pack or --game-id")
    return PlatewireClient().pack(args.game_id)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Platewire F5 v42 analyzer")
    p.add_argument("--pack", help="Path to pack JSON")
    p.add_argument("--game-id", help="Fetch pack from API")
    p.add_argument("--track", default="prematch", choices=["prematch", "inn1", "inn2"])
    p.add_argument("--pretty", action="store_true", default=True)
    args = p.parse_args(argv)

    pack = load_pack(args)
    inputs = (pack.get("features") or {}).get("inputs") or {}
    tracks = (pack.get("odds") or {}).get("tracks") or {}
    track = tracks.get(args.track)
    markets = track_to_markets(track if isinstance(track, dict) else None)
    analysis = analyze(inputs, markets)

    game = pack.get("game") or {}
    home = ((game.get("home_team") or {}).get("abbreviation")
            or ((pack.get("home") or {}).get("team") or {}).get("abbreviation")
            or "HOME")
    away = ((game.get("away_team") or {}).get("abbreviation")
            or ((pack.get("away") or {}).get("team") or {}).get("abbreviation")
            or "AWAY")
    result = {
        "game_id": game.get("id") or pack.get("id"),
        "matchup": f"{away} @ {home}",
        "track": args.track,
        "track_ok": bool(isinstance(track, dict) and track.get("ok", True)),
        "track_captured_at": (track or {}).get("captured_at") if isinstance(track, dict) else None,
        "completeness": pack.get("completeness"),
        "analysis": analysis,
    }
    print(json.dumps(result, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
