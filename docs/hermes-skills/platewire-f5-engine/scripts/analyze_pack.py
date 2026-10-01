#!/usr/bin/env python3
"""Analyze a Platewire game pack with After-5 v45 math (Hermes-side)."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

# Allow sibling import when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from platewire_client import PlatewireClient, RobustJSONParser  # noqa: E402

FORMULA_VERSION = os.environ.get("PLATEWIRE_FORMULA_VERSION", "v45.1")
OVERROUND = float(os.environ.get("PLATEWIRE_OVERROUND", "1.05"))
VALUE_THRESHOLD = float(os.environ.get("PLATEWIRE_VALUE_THRESHOLD", "65"))
LEAGUE_ERA = 4.5
LEAGUE_OPS = 0.72
LEAGUE_BARREL = 0.085
LEAGUE_HARDHIT = 0.35
LEAGUE_SPRINT = 27.0
LEAGUE_GB_PCT = 0.42
LEAGUE_BULLPEN_ERA = 4.5
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

# Standard 2020-ish RE24 matrix (run expectancy by outs & base state).
# Base state tuple: (runner on 1B, runner on 2B, runner on 3B).
RE24_MATRIX: dict[tuple[int, tuple[bool, bool, bool]], float] = {
    (0, (False, False, False)): 0.29,
    (0, (True, False, False)): 0.50,
    (0, (False, True, False)): 0.65,
    (0, (False, False, True)): 0.86,
    (0, (True, True, False)): 0.90,
    (0, (True, False, True)): 1.10,
    (0, (False, True, True)): 1.30,
    (0, (True, True, True)): 1.54,
    (1, (False, False, False)): 0.17,
    (1, (True, False, False)): 0.30,
    (1, (False, True, False)): 0.42,
    (1, (False, False, True)): 0.54,
    (1, (True, True, False)): 0.58,
    (1, (True, False, True)): 0.72,
    (1, (False, True, True)): 0.88,
    (1, (True, True, True)): 1.02,
    (2, (False, False, False)): 0.07,
    (2, (True, False, False)): 0.13,
    (2, (False, True, False)): 0.22,
    (2, (False, False, True)): 0.29,
    (2, (True, True, False)): 0.32,
    (2, (True, False, True)): 0.39,
    (2, (False, True, True)): 0.48,
    (2, (True, True, True)): 0.62,
}


def apply_formula_constants() -> None:
    """Overlay the active database formula onto this process."""
    global LEAGUE_ERA, LEAGUE_OPS, LEAGUE_BARREL, LEAGUE_HARDHIT, LEAGUE_SPRINT
    global LEAGUE_GB_PCT, LEAGUE_BULLPEN_ERA, LAMBDA_MIN, LAMBDA_MAX, PROB_CAP
    raw = os.environ.get("PLATEWIRE_FORMULA_CONSTANTS")
    if not raw:
        return
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return
    if not isinstance(data, dict):
        return

    def num(name: str, current: float) -> float:
        value = data.get(name)
        return float(value) if isinstance(value, (int, float)) else current

    LEAGUE_ERA = num("league_era", LEAGUE_ERA)
    LEAGUE_OPS = num("league_ops", LEAGUE_OPS)
    LEAGUE_BARREL = num("league_barrel", LEAGUE_BARREL)
    LEAGUE_HARDHIT = num("league_hardhit", LEAGUE_HARDHIT)
    LEAGUE_SPRINT = num("league_sprint", LEAGUE_SPRINT)
    LEAGUE_GB_PCT = num("league_gb_pct", LEAGUE_GB_PCT)
    LEAGUE_BULLPEN_ERA = num("league_bullpen_era", LEAGUE_BULLPEN_ERA)
    LAMBDA_MIN = num("lambda_min", LAMBDA_MIN)
    LAMBDA_MAX = num("lambda_max", LAMBDA_MAX)
    PROB_CAP = num("prob_cap", PROB_CAP)
    parks = data.get("park_factors")
    if isinstance(parks, dict):
        for name, value in parks.items():
            if isinstance(value, (int, float)):
                PARK_FACTORS[str(name).lower()] = float(value)


apply_formula_constants()


def clamp_lambda(value: float) -> float:
    return max(LAMBDA_MIN, min(LAMBDA_MAX, value))


def cap_prob(p: float, cap: float = PROB_CAP) -> float:
    return min(p, cap)


def cap_probs_triplet(p_home: float, p_tie: float, p_away: float, cap: float = PROB_CAP) -> tuple[float, float, float]:
    """Cap a set of mutually exclusive probs without inflating total above 1."""
    s = p_home + p_tie + p_away
    if s <= 0:
        return (1 / 3, 1 / 3, 1 / 3)
    raw = [p_home, p_tie, p_away]
    for _ in range(3):
        capped = [min(x, cap + 1e-12) for x in raw]
        excess = sum(x - c for x, c in zip(raw, capped))
        if excess <= 1e-12:
            break
        uncapped_count = sum(1 for c in capped if c < cap - 1e-12)
        if uncapped_count == 0:
            total = sum(capped) or 1.0
            return tuple(c / total for c in capped)
        per = excess / uncapped_count
        raw = [c + per if c < cap - 1e-12 else c for c in capped]
    total = sum(raw) or 1.0
    return tuple(x / total for x in raw)


def is_default_source(sources: dict[str, Any] | None, key: str) -> bool:
    """A value marked 'default' in input_sources carries no real signal."""
    if not sources:
        return False
    return str(sources.get(key, "")).lower() == "default"


def get_value(
    raw: dict[str, Any],
    key: str,
    default: float,
    sources: dict[str, Any] | None = None,
) -> tuple[float, bool]:
    """Return (numeric value, is_default). Missing values are not treated as default here."""
    if is_default_source(sources, key):
        return float(default), True
    val = raw.get(key)
    if val is None:
        return float(default), True
    try:
        return float(val), False
    except (TypeError, ValueError):
        return float(default), True


def shrunk_ops(
    l5: float,
    l3: float,
    l5_sample: float,
    l3_sample: float,
    is_rookie: bool,
    fallback: float,
) -> float:
    """v45: regress L5/L3 OPS toward league mean with sample-size weighting."""
    base_shrink = 30.0  # PA-equivalent shrinkage constant
    l5_shrink = base_shrink * (3.0 if is_rookie else 1.0)
    l3_shrink = base_shrink * 1.5

    vals: list[float] = []
    weights: list[float] = []
    if l5_sample > 0:
        l5_shrunk = (l5 * l5_sample + LEAGUE_OPS * l5_shrink) / (l5_sample + l5_shrink)
        vals.append(l5_shrunk)
        weights.append(l5_sample)
    if l3_sample > 0:
        l3_shrunk = (l3 * l3_sample + LEAGUE_OPS * l3_shrink) / (l3_sample + l3_shrink)
        vals.append(l3_shrunk)
        weights.append(l3_sample)

    if not vals:
        return fallback
    return sum(v * w for v, w in zip(vals, weights)) / sum(weights)


def predictive_era(
    era: float,
    fip: float | None,
    era_last3: float | None,
    ip_avg: float | None,
    team_era: float,
    live_today_era: float | None = None,
    fallback_era: float | None = None,
    is_reliever: bool = False,
) -> float:
    """v45: weighted ERA = 30% season / 40% last-3 / 30% live-today (when available)."""
    season = float(era)
    last3 = float(era_last3) if era_last3 is not None else season
    if live_today_era is not None and live_today_era >= 0:
        weighted = 0.30 * season + 0.40 * last3 + 0.30 * live_today_era
    else:
        weighted = 0.30 * season + 0.70 * last3

    parts: list[tuple[float, float]] = [(weighted, 0.55)]
    if fip is not None:
        parts.append((fip, 0.30))
    weight_sum = sum(w for _, w in parts)
    p_era = sum(v * w for v, w in parts) / weight_sum

    sample_weight = 1.0 if is_reliever else min(1.0, (ip_avg or 0) / 30)
    if sample_weight < 1:
        blend = fallback_era if fallback_era is not None else (team_era if team_era > 0 else LEAGUE_ERA)
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
    """v45: default values contribute zero weight in the MQI blend."""
    mqi = 1.0
    mqi += (batter["barrel_pct"] - LEAGUE_BARREL) * 0.6
    mqi += (batter["hardhit_pct"] - LEAGUE_HARDHIT) * 0.35

    if pitcher.get("k_pct") is not None and pitcher.get("bb_pct") is not None:
        mqi += (pitcher["k_pct"] - pitcher["bb_pct"]) * 0.02

    if not pitcher.get("is_gb_pct_default") and pitcher["gb_pct"] >= 0.44:
        mqi *= 0.8

    if not batter.get("is_sprint_speed_default"):
        spd_bonus = 1 + max(-0.03, min(0.03, (batter["sprint_speed"] - LEAGUE_SPRINT) * 0.01))
    else:
        spd_bonus = 1.0

    if not batter.get("is_gb_pct_default") and not pitcher.get("is_gb_pct_default"):
        gidp = batter["gb_pct"] * pitcher["gb_pct"] * (2 - spd_bonus)
    else:
        # default GB% carries zero signal; use neutral GIDP estimate
        gidp = LEAGUE_GB_PCT * LEAGUE_GB_PCT * (2 - 1.0)
    mqi -= gidp * 0.15

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
        if temp_c < 10:
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
    wdir = inputs.get("wind_direction")
    if isinstance(wdir, str):
        wdir_norm = wdir.strip().lower()
    else:
        wdir_norm = ""
    if wspd is not None and wspd > 0:
        if wdir_norm == "out":
            wind_mult = max(0.92, min(1.12, 1 + (wspd / 10) / 18))
        elif wdir_norm == "in":
            wind_mult = max(0.88, min(1.08, 1 - (wspd / 10) / 18))
        else:
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


def risp_factor(batter: dict[str, Any]) -> float:
    """v43: high-leverage RISP modifier."""
    avg_risp = batter.get("avg_risp")
    if avg_risp is None:
        return 1.0
    try:
        val = float(avg_risp)
    except (TypeError, ValueError):
        return 1.0
    return max(0.94, min(1.06, 1 + (val - 0.250) * 1.2))


def sigmoid_correction(delta: float, scale: float = 0.08) -> float:
    try:
        return 2 / (1 + math.exp(-delta / scale)) - 1
    except OverflowError:
        return 1.0 if delta > 0 else -1.0


def nonlinear_live_multiplier(delta: float, scale: float = 0.10) -> float:
    sig = sigmoid_correction(delta, scale=scale)
    return max(0.85, min(1.15, 1 + sig * 0.12))


def team_profile(raw: dict[str, Any], sources: dict[str, Any] | None = None) -> dict[str, Any]:
    ops, ops_def = get_value(raw, "ops", LEAGUE_OPS, sources)
    ops_l5, _ = get_value(raw, "ops_l5", ops, sources)
    ops_l3, _ = get_value(raw, "ops_l3", ops, sources)
    ops_l5_sample, _ = get_value(raw, "ops_l5_sample", 0, sources)
    ops_l3_sample, _ = get_value(raw, "ops_l3_sample", 0, sources)
    mlb_games, _ = get_value(raw, "mlb_games", 9999, sources)
    is_rookie = mlb_games < 50

    final_ops = shrunk_ops(ops_l5, ops_l3, ops_l5_sample, ops_l3_sample, is_rookie, ops)

    team_era, _ = get_value(raw, "team_era", LEAGUE_ERA, sources)
    team_bullpen_era, bp_def = get_value(raw, "team_bullpen_era", team_era, sources)
    if team_bullpen_era <= 0:
        team_bullpen_era = LEAGUE_ERA
    barrel_pct, _ = get_value(raw, "barrel_pct", LEAGUE_BARREL, sources)
    hardhit_pct, _ = get_value(raw, "hardhit_pct", LEAGUE_HARDHIT, sources)

    gb_pct, gb_def = get_value(raw, "lineup_gb_pct", LEAGUE_GB_PCT, sources)
    if gb_def:
        gb_pct, gb_def = get_value(raw, "gb_pct", LEAGUE_GB_PCT, sources)

    sprint_speed, sprint_def = get_value(raw, "sprint_speed", LEAGUE_SPRINT, sources)
    fielding_pct, _ = get_value(raw, "fielding_pct", 0.985, sources)

    return {
        "ops": final_ops,
        "raw_ops": ops,
        "is_ops_default": ops_def,
        "team_era": team_era,
        "team_bullpen_era": team_bullpen_era,
        "is_bullpen_era_default": bp_def,
        "barrel_pct": barrel_pct,
        "hardhit_pct": hardhit_pct,
        "gb_pct": gb_pct,
        "is_gb_pct_default": gb_def,
        "sprint_speed": sprint_speed,
        "is_sprint_speed_default": sprint_def,
        "fielding_pct": fielding_pct,
        "oaa": raw.get("oaa"),
        "drs": raw.get("drs"),
        "form_win_pct": raw.get("form_win_pct"),
        "offense_trend": raw.get("offense_trend"),
        "avg_risp": raw.get("avg_risp"),
        "mlb_games": mlb_games,
        "is_rookie": is_rookie,
    }


def pitcher_profile(
    raw: dict[str, Any],
    sources: dict[str, Any] | None = None,
    live_stats: dict[str, Any] | None = None,
    reliever_era: float | None = None,
) -> dict[str, Any]:
    era, era_def = get_value(raw, "sp_era", LEAGUE_ERA, sources)
    fip = raw.get("sp_fip")
    era_last3 = raw.get("sp_era_last3")
    ip_avg = raw.get("sp_ip_avg")
    gb_pct, gb_def = get_value(raw, "gb_pct", LEAGUE_GB_PCT, sources)
    k_pct = raw.get("sp_k_pct")
    bb_pct = raw.get("sp_bb_pct")
    fps_pct = raw.get("sp_fps_pct")

    live_today_era: float | None = None
    if live_stats:
        ip_today = live_stats.get("ip_today")
        er_today = live_stats.get("er_today")
        if ip_today is not None and ip_today >= 2 and er_today is not None and ip_today > 0:
            live_today_era = (er_today / ip_today) * 9

    return {
        "era": era,
        "is_era_default": era_def,
        "fip": fip,
        "era_last3": era_last3,
        "ip_avg": ip_avg,
        "sp_season_games_started": raw.get("sp_season_games_started"),
        "gb_pct": gb_pct,
        "is_gb_pct_default": gb_def,
        "k_pct": k_pct,
        "bb_pct": bb_pct,
        "fps_pct": fps_pct,
        "live_today_era": live_today_era,
        "reliever_era": reliever_era,
        "is_reliever": reliever_era is not None,
    }


def build_side_lambda(
    offense: dict[str, Any],
    defense: dict[str, Any],
    opposing_pitcher: dict[str, Any],
    park_time: float,
    weather_factor: float,
    ump_factor: float,
    h2h_edge: float = 1.0,
    force_bullpen: bool = False,
) -> tuple[float, dict[str, float]]:
    if force_bullpen:
        base_era = opposing_pitcher.get("reliever_era") or defense["team_bullpen_era"]
        is_reliever = bool(opposing_pitcher.get("reliever_era"))
        fallback_era = base_era
    else:
        base_era = opposing_pitcher["era"]
        is_reliever = False
        fallback_era = None

    p_era = predictive_era(
        base_era,
        None if force_bullpen else opposing_pitcher.get("fip"),
        None if force_bullpen else opposing_pitcher.get("era_last3"),
        None if force_bullpen else opposing_pitcher.get("ip_avg"),
        defense["team_era"],
        None if force_bullpen else opposing_pitcher.get("live_today_era"),
        fallback_era=fallback_era,
        is_reliever=is_reliever,
    )
    era_adj = (
        (p_era / LEAGUE_ERA)
        * park_time
        * weather_factor
        * ump_factor
        * fps_factor(None if force_bullpen else opposing_pitcher.get("fps_pct"))
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
        * risp_factor(offense)
    )
    lam = clamp_lambda(0.5 * bat * era_adj * matchup * d_adj * live_adj)
    return lam, {
        "p_era": round(p_era, 3),
        "era_adj": round(era_adj, 4),
        "bat": round(bat, 4),
        "matchup": round(matchup, 4),
        "defense": round(d_adj, 4),
        "live_adj": round(live_adj, 4),
        "risp": round(risp_factor(offense), 4),
        "force_bullpen": force_bullpen,
        "is_reliever": is_reliever,
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


def quality_surge_factor(live: dict[str, Any], side: str) -> float:
    """v45: only quality events (RISP hits, XBH, BB+HBP, steals into scoring) drive surge."""
    runs_arr = live.get(f"{side}_inning_runs", []) or []
    if not runs_arr:
        return 1.0
    runs = int(runs_arr[-1])
    if runs <= 0:
        return 1.0

    quality = 0
    for suffix in ("inning_risp_hits", "inning_xbh", "inning_bb_hbp", "inning_sb_scoring"):
        arr = live.get(f"{side}_{suffix}", []) or []
        if arr:
            quality += int(arr[-1])

    if quality == 0:
        return 0.55
    if quality >= runs + 2:
        return 1.0
    if quality < runs:
        return min(1.0, 0.55 + 0.15 * quality)
    return 1.0


def surge_factor(runs: int, hits: int, walks: int) -> float:
    """Legacy v44 helper retained for compatibility; new code uses quality_surge_factor."""
    if runs <= 0:
        return 1.0
    contact_events = hits + walks
    if contact_events == 0:
        return 0.55
    if contact_events >= runs + 2:
        return 1.0
    if contact_events < runs:
        return min(1.0, 0.55 + 0.15 * contact_events)
    return 1.0


def shutout_factor(hit_history: list[int]) -> float:
    """v44: 0 hits over 2+ consecutive innings -> collapse/dominance penalty."""
    if not hit_history:
        return 1.0
    zero_streak = 0
    for h in reversed(hit_history):
        if h == 0:
            zero_streak += 1
        else:
            break
    if zero_streak >= 2:
        return 0.7
    return 1.0


def fatigue_v44(pitches: float | None) -> float:
    """v44: pitch count > 85 -> boost opposing lambda 15% for remaining innings."""
    if pitches is None or pitches <= 85:
        return 1.0
    return 1.15


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


def fatigue_by_pc(pitches: float | None, inning: int) -> float:
    """v43: explicit PC > 80 boost for 4th/5th innings."""
    if pitches is None or pitches <= 80:
        return 1.0
    if inning in {4, 5}:
        return 1.15
    return 1.0


def ice_cold_factor(completed: int, score: Any, total_hits: int) -> float:
    """Ice Cold Start: <=1 run and <=3 hits through 2 innings -> offense lambda cut."""
    if completed < 2:
        return 1.0
    runs = int(score or 0)
    if runs <= 1 and total_hits <= 3:
        if runs == 0 and total_hits <= 2:
            return 0.50
        return 0.70
    return 1.0


def risp_conversion_factor(
    live: dict[str, Any], side: str, completed: int
) -> tuple[float, float | None, list[str]]:
    """v45.1 RISP Conversion Module (RISP-Early floor)."""
    hits = live.get(f"{side}_risp_hits")
    attempts = live.get(f"{side}_risp_attempts")
    if hits is None or attempts is None:
        hits_arr = live.get(f"{side}_inning_risp_hits", []) or []
        att_arr = live.get(f"{side}_inning_risp_attempts", []) or []
        if hits_arr and att_arr:
            hits = sum(hits_arr)
            attempts = sum(att_arr)
    if attempts is None or attempts < 3:
        return 1.0, None, []
    conv = hits / attempts
    notes: list[str] = []
    # v45.1: early 0-for-N in first 2 innings -> immediate x0.60 floor
    early = completed <= 2
    if early and hits == 0 and attempts >= 3:
        return 0.60, conv, ["risp_early_floor_x0.60"]
    if attempts >= 4 and conv <= 0.25:
        notes.append("risp_cut_x0.75")
        return 0.75, conv, notes
    if attempts >= 3 and conv >= 0.50:
        notes.append("risp_boost_x1.15")
        return 1.15, conv, notes
    return 1.0, conv, notes


def extract_pitcher_live(live: dict[str, Any], side: str) -> dict[str, Any]:
    return {
        "ip_today": live.get(f"{side}_sp_ip_today"),
        "k_today": live.get(f"{side}_sp_k_today"),
        "bb_today": live.get(f"{side}_sp_bb_today"),
        "fps_pct": live.get(f"{side}_sp_fps_pct"),
        "er_by_inning": live.get(f"{side}_sp_er_by_inning", []) or [],
        "er_today": live.get(f"{side}_sp_er_today"),
    }




def solo_hr_dampener(live: dict[str, Any], side: str, risp_hits: Any, risp_attempts: Any) -> tuple[float, list[str]]:
    """v45.1: isolated solo HR offense with 0 RISP gets x0.90."""
    hr_arr = live.get(f"{side}_inning_hrs", []) or []
    runs_arr = live.get(f"{side}_inning_runs", []) or []
    if not hr_arr or sum(hr_arr) == 0:
        return 1.0, []
    total_runs = int(live.get(f"{side}_score", sum(runs_arr) if runs_arr else 0) or 0)
    total_hrs = sum(int(x) for x in hr_arr)
    # require all runs via solo HR (1 RBI per HR) and zero RISP conversion
    if total_hrs <= 0 or total_runs != total_hrs:
        return 1.0, []
    if risp_attempts is not None and int(risp_attempts) > 0 and int(risp_hits or 0) > 0:
        return 1.0, []
    if risp_attempts is not None and int(risp_attempts) > 0 and int(risp_hits or 0) == 0:
        return 0.90, ["solo_hr_dampener_x0.90"]
    # no RISP data -> mild signal if score==hrs
    return 1.0, []


def is_opener_pitcher(
    pitcher: dict[str, Any],
    live_stats: dict[str, Any],
    live: dict[str, Any] | None = None,
    side: str | None = None,
) -> tuple[bool, list[str]]:
    """Detect opener / expected short outing."""
    reasons: list[str] = []
    season_games_started = pitcher.get("sp_season_games_started")
    if season_games_started is not None and int(season_games_started) == 0:
        reasons.append("opener_games_started_0")
    sp_ip_avg = pitcher.get("ip_avg")
    if sp_ip_avg is not None and float(sp_ip_avg) < 4.0:
        reasons.append("opener_ip_avg_below_4")
    # live evidence removed before 3rd inning
    ip_today = live_stats.get("ip_today")
    if ip_today is not None and float(ip_today) < 3.0:
        removed_flag = live_stats.get("removed_before_3rd", False)
        if not removed_flag and live is not None and side is not None:
            removed_flag = bool(live.get(f"{side}_sp_removed"))
        if removed_flag:
            reasons.append("opener_removed_before_3rd")
    return bool(reasons), reasons


def resurrection_factor(pitcher: dict[str, Any], live_stats: dict[str, Any]) -> tuple[float, list[str]]:
    """v45.1: bad-form SP with 2+ clean innings -> discount opposing offense x0.70."""
    er_by_inning = live_stats.get("er_by_inning") or []
    meltdown = any(int(er) >= 3 for er in er_by_inning)
    if meltdown:
        return 1.0, []
    ip = live_stats.get("ip_today")
    if ip is None or float(ip) < 2.0:
        return 1.0, []
    er_today = live_stats.get("er_today")
    # 2+ consecutive clean innings: total ER == 0 through current outing
    if er_today is None or int(er_today) != 0:
        return 1.0, []
    season_era = pitcher.get("era")
    last7_era = pitcher.get("era_last3")  # reuse last3 ERA as proxy for recent form
    if (season_era is not None and float(season_era) > 6.0) or (last7_era is not None and float(last7_era) > 7.0):
        return 0.70, ["resurrection_x0.70"]
    return 1.0, []


def locked_meltdown_factor(
    pitcher: dict[str, Any],
    live_stats: dict[str, Any],
    live: dict[str, Any] | None = None,
    side: str | None = None,
    enable_locked_in: bool = True,
) -> tuple[float, float, list[str]]:
    """v45.1: Locked-In / Meltdown / Resurrection / Opener-Lock live override."""
    notes: list[str] = []
    ip = live_stats.get("ip_today")
    if ip is None or float(ip) < 2:
        return 1.0, 1.0, notes
    k = (live_stats.get("k_today") or 0)
    bb = (live_stats.get("bb_today") or 0)
    k9 = (k / float(ip)) * 9 if float(ip) > 0 else 0.0
    fps = live_stats.get("fps_pct")
    er_by_inning = live_stats.get("er_by_inning") or []
    meltdown = any(int(er) >= 3 for er in er_by_inning)

    factor = 1.0
    if meltdown:
        factor *= 1.30
        notes.append("meltdown_x1.30")

    locked_in = k9 >= 9 and bb <= 1
    opener, opener_reasons = is_opener_pitcher(pitcher, live_stats, live=live, side=side)
    if opener:
        notes.extend([f"opener_lock_skip:{r}" for r in opener_reasons])
        locked_in = False

    if enable_locked_in and locked_in:
        factor *= 0.65
        notes.append("locked_in_x0.65")
        if fps is not None and float(fps) >= 0.60:
            factor *= 0.90
            notes.append("locked_in_fps_x0.90")

    # Resurrection (only if not already meltdown and not locked-in)
    if not meltdown and not locked_in:
        res_factor, res_notes = resurrection_factor(pitcher, live_stats)
        if res_factor < 1.0:
            factor *= res_factor
            notes.extend(res_notes)

    return factor, factor, notes


def error_factor(live: dict[str, Any], side: str) -> float:
    return 1.20 if live.get(f"{side}_error_current_inning") else 1.0


def stress_factor(live: dict[str, Any], pitcher_side: str) -> float:
    """Pitcher threw >=25 pitches in an inning -> next inning opposing lambda *1.15."""
    return 1.15 if live.get(f"{pitcher_side}_sp_pitches_last_inning", 0) >= 25 else 1.0


def ttop_factor(live: dict[str, Any], side: str, current_inning: int) -> float:
    """v45: third-time-through-order penalty for SP still in from inning 3 onward."""
    removed = bool(live.get(f"{side}_sp_removed"))
    if removed or current_inning < 3:
        return 1.0
    remaining = max(0, 5 - current_inning + 1)
    if remaining <= 0:
        return 1.0
    penalized = sum(1 for inn in range(current_inning, 6) if inn >= 4)
    return 1 + 0.08 * (penalized / remaining)


def compute_live_lambdas(
    base_home: float,
    base_away: float,
    live: dict[str, Any],
    home_pitcher: dict[str, Any],
    away_pitcher: dict[str, Any],
) -> tuple[float, float, dict[str, Any]]:
    if not isinstance(live, dict) or int(live.get("completed_innings") or 0) < 1:
        return base_home, base_away, {"live_active": False}

    completed = int(live.get("completed_innings") or 0)
    current_inning = int(live.get("inning") or completed)

    home_inn_runs = live.get("home_inning_runs", []) or []
    away_inn_runs = live.get("away_inning_runs", []) or []
    home_inn_hits = live.get("home_inning_hits", []) or []
    away_inn_hits = live.get("away_inning_hits", []) or []
    home_inn_walks = live.get("home_inning_walks", []) or []
    away_inn_walks = live.get("away_inning_walks", []) or []

    home_recent_runs = home_inn_runs[-1] if home_inn_runs else 0
    away_recent_runs = away_inn_runs[-1] if away_inn_runs else 0
    home_recent_hits = home_inn_hits[-1] if home_inn_hits else 0
    away_recent_hits = away_inn_hits[-1] if away_inn_hits else 0
    home_recent_walks = home_inn_walks[-1] if home_inn_walks else 0
    away_recent_walks = away_inn_walks[-1] if away_inn_walks else 0

    # v45 self-modules (offense penalizes/benefits itself)
    ice_home = ice_cold_factor(completed, live.get("home_score"), sum(home_inn_hits))
    ice_away = ice_cold_factor(completed, live.get("away_score"), sum(away_inn_hits))
    risp_home, risp_home_conv, risp_home_notes = risp_conversion_factor(live, "home", completed)
    risp_away, risp_away_conv, risp_away_notes = risp_conversion_factor(live, "away", completed)
    solo_hr_home, solo_hr_home_notes = solo_hr_dampener(
        live, "home", live.get("home_risp_hits"), live.get("home_risp_attempts")
    )
    solo_hr_away, solo_hr_away_notes = solo_hr_dampener(
        live, "away", live.get("away_risp_hits"), live.get("away_risp_attempts")
    )
    err_home = error_factor(live, "home")
    err_away = error_factor(live, "away")

    # v45 opponent-pitcher modules
    home_pitcher_live = extract_pitcher_live(live, "home")
    away_pitcher_live = extract_pitcher_live(live, "away")
    home_lock_meltdown, _, home_lock_notes = locked_meltdown_factor(home_pitcher, home_pitcher_live, live=live, side="home")
    away_lock_meltdown, _, away_lock_notes = locked_meltdown_factor(away_pitcher, away_pitcher_live, live=live, side="away")
    stress_home = stress_factor(live, "away")  # away pitcher stress -> home offense
    stress_away = stress_factor(live, "home")  # home pitcher stress -> away offense
    ttop_home = ttop_factor(live, "away", current_inning)  # away pitcher TTOP -> home offense
    ttop_away = ttop_factor(live, "home", current_inning)  # home pitcher TTOP -> away offense

    # v44 sigmoid momentum + quality surge + shutout + fatigue
    raw_mom_home = first_inning_momentum(home_recent_runs, live.get("home_sp_pitches"))
    raw_mom_away = first_inning_momentum(away_recent_runs, live.get("away_sp_pitches"))
    surge_home = quality_surge_factor(live, "home")
    surge_away = quality_surge_factor(live, "away")
    mom_home = 1 + (raw_mom_home - 1) * surge_home
    mom_away = 1 + (raw_mom_away - 1) * surge_away

    shutout_home = shutout_factor(away_inn_hits)
    shutout_away = shutout_factor(home_inn_hits)

    fatigue_home_sp = pitcher_fatigue_multiplier(live.get("home_sp_pitches"))
    fatigue_away_sp = pitcher_fatigue_multiplier(live.get("away_sp_pitches"))

    raw_delta_home = (mom_home - 1.0) + (1.0 - fatigue_home_sp)
    raw_delta_away = (mom_away - 1.0) + (1.0 - fatigue_away_sp)

    adj_home = base_home * nonlinear_live_multiplier(raw_delta_home) * shutout_home
    adj_away = base_away * nonlinear_live_multiplier(raw_delta_away) * shutout_away

    adj_home *= fatigue_burst(live.get("away_sp_pitches"), completed)
    adj_away *= fatigue_burst(live.get("home_sp_pitches"), completed)

    adj_home *= fatigue_by_pc(live.get("away_sp_pitches"), current_inning)
    adj_away *= fatigue_by_pc(live.get("home_sp_pitches"), current_inning)

    adj_home *= fatigue_v44(live.get("away_sp_pitches"))
    adj_away *= fatigue_v44(live.get("home_sp_pitches"))

    # Apply v45.1 modules
    adj_home *= ice_home * risp_home * err_home * away_lock_meltdown * stress_home * ttop_home * solo_hr_home
    adj_away *= ice_away * risp_away * err_away * home_lock_meltdown * stress_away * ttop_away * solo_hr_away

    return clamp_lambda(adj_home), clamp_lambda(adj_away), {
        "live_active": True,
        "mom_home": mom_home,
        "mom_away": mom_away,
        "surge_home": surge_home,
        "surge_away": surge_away,
        "shutout_home": shutout_home,
        "shutout_away": shutout_away,
        "fatigue_home_sp": fatigue_home_sp,
        "fatigue_away_sp": fatigue_away_sp,
        "fatigue_v44_home": fatigue_v44(live.get("away_sp_pitches")),
        "fatigue_v44_away": fatigue_v44(live.get("home_sp_pitches")),
        "sigmoid_delta_home": raw_delta_home,
        "sigmoid_delta_away": raw_delta_away,
        "ice_cold_home": ice_home,
        "ice_cold_away": ice_away,
        "risp_home": risp_home,
        "risp_home_conv": risp_home_conv,
        "risp_away": risp_away,
        "risp_away_conv": risp_away_conv,
        "error_home": err_home,
        "error_away": err_away,
        "locked_meltdown_home": home_lock_meltdown,
        "locked_meltdown_away": away_lock_meltdown,
        "stress_home": stress_home,
        "stress_away": stress_away,
        "ttop_home": ttop_home,
        "ttop_away": ttop_away,
        "risp_home_notes": risp_home_notes,
        "risp_away_notes": risp_away_notes,
        "solo_hr_home": solo_hr_home,
        "solo_hr_away": solo_hr_away,
        "solo_hr_home_notes": solo_hr_home_notes,
        "solo_hr_away_notes": solo_hr_away_notes,
        "locked_meltdown_home_notes": home_lock_notes,
        "locked_meltdown_away_notes": away_lock_notes,
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
    if remaining_innings <= 0:
        return {
            "p_home_lead": 1.0 if base_home > base_away else 0.0 if base_home < base_away else 1.0,
            "p_tie": 1.0 if base_home == base_away else 0.0,
            "p_away_lead": 1.0 if base_away > base_home else 0.0 if base_away < base_home else 0.0,
            "p_over_4_5": 1.0 if (base_home + base_away) > 4.5 else 0.0,
            "avg_total": base_home + base_away,
        }
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
    safe_odds = max(1.001, float(decimal_odds))
    return 1 / safe_odds / overround


def value_pct(my_prob: float, implied: float) -> float:
    if implied <= 0 or not math.isfinite(implied):
        return 0.0
    return ((my_prob - implied) / implied) * 100


def roi_pct(my_prob: float, odds: float) -> float:
    safe_odds = max(1.0, float(odds))
    return (my_prob * (safe_odds - 1) - (1 - my_prob)) * 100


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


def _starter_name(player: dict[str, Any] | None) -> str:
    if not player:
        return ""
    return " ".join(
        part for part in [player.get("first_name"), player.get("last_name")] if part
    ).strip() or (player.get("name") or "")


def verify_starting_pitchers(pack: dict[str, Any]) -> dict[str, Any]:
    """v43: compare pack starters with current game status, return warnings and allow override."""
    game = pack.get("game") or {}
    pack_home = _starter_name((pack.get("home") or {}).get("starter"))
    pack_away = _starter_name((pack.get("away") or {}).get("starter"))

    status = game.get("status") or {}
    if isinstance(status, str):
        status = {}
    status_home = _starter_name((status or {}).get("home_starter"))
    status_away = _starter_name((status or {}).get("away_starter"))

    warnings: list[str] = []
    mismatches: list[dict[str, Any]] = []

    def check(side: str, pack_name: str, live_name: str) -> None:
        pack_norm = pack_name.lower().strip()
        live_norm = live_name.lower().strip()
        if not live_norm or not pack_norm:
            return
        if pack_norm != live_norm:
            warnings.append(f"SP {side} MISMATCH: pack={pack_name!r}, live={live_name!r}")
            mismatches.append({"side": side, "pack": pack_name, "live": live_name})

    check("home", pack_home, status_home)
    check("away", pack_away, status_away)

    return {
        "verified": len(mismatches) == 0,
        "warnings": warnings,
        "mismatches": mismatches,
        "pack_home_starter": pack_home,
        "pack_away_starter": pack_away,
        "live_home_starter": status_home,
        "live_away_starter": status_away,
        "override_allowed": True,
    }


def parse_base_state(state: Any) -> tuple[bool, bool, bool]:
    s = str(state or "")
    return ("1" in s, "2" in s, "3" in s)


def re24_value(outs: Any, base_state: Any) -> float:
    runners = parse_base_state(base_state)
    outs = min(2, max(0, int(outs or 0)))
    return RE24_MATRIX.get((outs, runners), 0.29)


def ace_duel_signal(
    home_era: float,
    away_era: float,
    completed: int,
    home_score: Any,
    away_score: Any,
) -> bool:
    return (
        home_era <= 3.5
        and away_era <= 3.5
        and completed >= 2
        and int(home_score or 0) == 0
        and int(away_score or 0) == 0
    )


def build_lambdas(inputs: dict[str, Any]) -> dict[str, Any]:
    sources = inputs.get("input_sources") or {}
    home_sources = sources.get("home") or {}
    away_sources = sources.get("away") or {}

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

    home_off = team_profile(inputs.get("home") or {}, home_sources)
    away_off = team_profile(inputs.get("away") or {}, away_sources)

    live = inputs.get("live")
    home_sp_removed = isinstance(live, dict) and bool(live.get("home_sp_removed"))
    away_sp_removed = isinstance(live, dict) and bool(live.get("away_sp_removed"))
    home_reliever_era = live.get("home_current_reliever_era") if isinstance(live, dict) else None
    away_reliever_era = live.get("away_current_reliever_era") if isinstance(live, dict) else None

    # Live stats for blended ERA / locked-in / meltdown
    home_live_stats = extract_pitcher_live(live, "home") if isinstance(live, dict) else {}
    away_live_stats = extract_pitcher_live(live, "away") if isinstance(live, dict) else {}

    home_p = pitcher_profile(
        inputs.get("home") or {},
        home_sources,
        live_stats=home_live_stats,
        reliever_era=home_reliever_era,
    )
    away_p = pitcher_profile(
        inputs.get("away") or {},
        away_sources,
        live_stats=away_live_stats,
        reliever_era=away_reliever_era,
    )

    home_side, home_bd = build_side_lambda(
        home_off,
        away_off,
        away_p,
        park_time,
        weather,
        ump,
        float(inputs.get("h2h_home_edge") or 1),
        force_bullpen=away_sp_removed,
    )
    away_side, away_bd = build_side_lambda(
        away_off,
        home_off,
        home_p,
        park_time,
        weather,
        ump,
        force_bullpen=home_sp_removed,
    )

    lambda_home, lambda_away = home_side, away_side
    live_meta: dict[str, Any] = {"live_active": False}
    ace_duel = False
    if isinstance(live, dict) and int(live.get("completed_innings") or 0) >= 1:
        lambda_home, lambda_away, live_meta = compute_live_lambdas(
            home_side, away_side, live, home_p, away_p
        )
        ace_duel = ace_duel_signal(
            home_p["era"],
            away_p["era"],
            int(live.get("completed_innings") or 0),
            live.get("home_score"),
            live.get("away_score"),
        )

    home_bd["bullpen"] = away_sp_removed
    away_bd["bullpen"] = home_sp_removed
    home_bd["is_reliever"] = away_p.get("is_reliever")
    away_bd["is_reliever"] = home_p.get("is_reliever")

    problems: list[str] = []

    def gap(flag: bool, text: str) -> None:
        if flag:
            problems.append(text)

    gap(bool(home_off.get("is_ops_default")), "нет OPS атаки хозяев, взято среднее лиги")
    gap(bool(away_off.get("is_ops_default")), "нет OPS атаки гостей, взято среднее лиги")
    gap(bool(home_off.get("is_bullpen_era_default")), "нет ERA буллпена хозяев, взято среднее лиги")
    gap(bool(away_off.get("is_bullpen_era_default")), "нет ERA буллпена гостей, взято среднее лиги")
    gap(bool(home_p.get("is_era_default")), "нет ERA стартера хозяев")
    gap(bool(away_p.get("is_era_default")), "нет ERA стартера гостей")
    gap(home_p.get("era_last3") is None, "нет ERA стартера хозяев за последние три старта")
    gap(away_p.get("era_last3") is None, "нет ERA стартера гостей за последние три старта")
    gap(bool(home_off.get("is_rookie")), "у атаки хозяев мало игр, сезонные цифры сырые")
    gap(bool(away_off.get("is_rookie")), "у атаки гостей мало игр, сезонные цифры сырые")
    gap(
        inputs.get("ump_strike_zone_pct") is None and inputs.get("ump_accuracy_above_x") is None,
        "нет зоны судьи",
    )
    gap(inputs.get("temperature_f") is None, "нет погоды")
    notes = [
        f"formula={FORMULA_VERSION}",
        f"park={park_time:.3f}",
        f"weather={weather:.3f}",
        f"ump={ump:.3f}",
        f"chaos={chaos:.1f}",
    ]
    if ace_duel:
        notes.append("ace_duel_pass=overs")

    return {
        "lambda_home": lambda_home,
        "lambda_away": lambda_away,
        "chaos": chaos,
        "notes": notes,
        "data_problems": problems,
        "breakdown": {
            "home": home_bd,
            "away": away_bd,
            "park_time": round(park_time, 4),
            "weather": round(weather, 4),
            "ump": round(ump, 4),
            "live": live_meta,
            "ace_duel_pass": ace_duel,
        },
    }


def analyze(inputs: dict[str, Any], markets: list[dict[str, Any]]) -> dict[str, Any]:
    built = build_lambdas(inputs)
    lh, la = built["lambda_home"], built["lambda_away"]
    live = inputs.get("live") if isinstance(inputs.get("live"), dict) else None
    re24_home = 0.0
    re24_away = 0.0
    if live and int(live.get("completed_innings") or 0) >= 1:
        rem = remaining_f5_innings(
            int(live.get("completed_innings") or 0),
            live.get("inning"),
            live.get("inning_half"),
        )
        home_score = float(live.get("home_score") or 0)
        away_score = float(live.get("away_score") or 0)
        half = str(live.get("inning_half") or "").lower()
        if half == "top":
            re24_away = re24_value(live.get("outs"), live.get("away_base_state"))
        elif half == "bottom":
            re24_home = re24_value(live.get("outs"), live.get("home_base_state"))
        if rem <= 0:
            sim = exact_poisson_f5(lh, la, 0, home_score + re24_home, away_score + re24_away)
            mode = "f5_settled"
        else:
            rem = max(1, rem)
            sim = exact_poisson_f5(lh, la, rem, home_score + re24_home, away_score + re24_away)
            mode = "exact_poisson_live"
        expected_home = home_score + re24_home + lh * max(0, rem)
        expected_away = away_score + re24_away + la * max(0, rem)
    else:
        sim = exact_poisson_f5(lh, la, 5, 0, 0)
        mode = "exact_poisson_pregame"
        expected_home = lh * 5
        expected_away = la * 5

    ph, pt, pa = cap_probs_triplet(sim["p_home_lead"], sim["p_tie"], sim["p_away_lead"])
    sim_capped = {
        "p_home_lead": ph,
        "p_tie": pt,
        "p_away_lead": pa,
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
        "data_problems": built.get("data_problems") or [],
        "breakdown": built["breakdown"],
        "markets_used": len(markets) > 0,
        "market_count": len(markets),
    }


def load_pack(args: argparse.Namespace) -> dict[str, Any]:
    if args.pack:
        raw = Path(args.pack).read_text(encoding="utf-8", errors="replace")
        return RobustJSONParser.parse(raw)
    if not args.game_id:
        raise SystemExit("Provide --pack or --game-id")
    return PlatewireClient().pack(args.game_id)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Platewire F5 v45.1 analyzer")
    p.add_argument("--pack", help="Path to pack JSON")
    p.add_argument("--game-id", help="Fetch pack from API")
    p.add_argument("--track", default="prematch", choices=["prematch", "inn1", "inn2"])
    p.add_argument("--override-sp", action="store_true", help="Acknowledge SP mismatch and continue")
    p.add_argument("--pretty", action="store_true", default=True)
    args = p.parse_args(argv)

    pack = load_pack(args)
    inputs = (pack.get("features") or {}).get("inputs") or {}
    tracks = (pack.get("odds") or {}).get("tracks") or {}
    track = tracks.get(args.track)
    markets = track_to_markets(track if isinstance(track, dict) else None)
    analysis = analyze(inputs, markets)

    sp_check = verify_starting_pitchers(pack)
    if sp_check["mismatches"] and not args.override_sp:
        print(
            json.dumps(
                {
                    "error": "Starting pitcher mismatch detected",
                    "sp_check": sp_check,
                    "hint": "Re-run with --override-sp to force analysis",
                },
                indent=2,
            )
        )
        return 3

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
        "sp_check": sp_check,
        "analysis": analysis,
    }
    print(json.dumps(result, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
