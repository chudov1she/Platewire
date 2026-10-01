---
name: platewire-f5-engine
description: "Use when computing MLB F5 lambdas, probabilities, or value bets from a Platewire pack — run the bundled Python analyzer (v45.1 port). Hermes calculates; Platewire API never returns value_bets. Triggers: edge, λ, over 4.5, moneyline fair price, signals."
version: 1.2.1
author: Platewire
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [platewire, mlb, f5, formula, poisson, value-bets]
    related_skills: [platewire-api, platewire-pack, platewire-desk]
---

# Platewire F5 Engine (Hermes-side)

## Overview

Port of After-5 **v45.1** math with robust JSON parsing, SP verification, weighted ERA, directional wind, RISP, PC fatigue, sigmoid live correction, surge/shutout handling, bullpen transition, fatigue penalties, locked-in/meltdown overrides, RE24 base-out state, TTOP penalty, form shrinkage, error/stress innings, and personal reliever ERA.
You **must run the script** for numbers — do not hand-wave Poisson or invent λ.

## When to Use

- User wants fair probs, expected F5 runs, value vs book, bet candidates
- After a pack is available for a chosen odds track
- Don't use for: placing real bets, calling removed `/formula/eval`

## Run (required)

```powershell
python D:\Projects\Sergey\platewire\docs\hermes-skills\platewire-f5-engine\scripts\analyze_pack.py --pack pack.json --track prematch
python D:\Projects\Sergey\platewire\docs\hermes-skills\platewire-f5-engine\scripts\analyze_pack.py --game-id <uuid> --track prematch
```

Env: `PLATEWIRE_BASE_URL`, `PLATEWIRE_LOGIN`, `PLATEWIRE_PASSWORD` (see `platewire-api`).

Output JSON includes: `lambda_home/away`, F5 lead/tie/over probs, `value_bets`
(≥ 65% value threshold), `all_bets`, `notes`, `markets_used`, `completeness`.

## Algorithm (checkable)

1. Read `features.inputs` as MatchupInputs
2. Build markets from `odds.tracks[track]` moneyline + `main_total` only
3. `buildLambdas` → park/weather/ump × offense/pitcher MQI
4. **v45.1 modules:**
   - **Weighted ERA:** 30% season / 40% last-3 / 30% live-today ERA (when ≥2 IP today).
   - **Form shrinkage:** L5/L3 OPS regressed toward league mean 0.720 with sample-size weighting; rookies (<50 MLB games) get stronger shrinkage.
   - **Default-zero MQI:** `default` input_sources for sprint_speed, gb_pct, bullpen_era contribute zero weight instead of a fake number.
   - **Surge:** only quality events (RISP hits, XBH, BB+HBP, steals into scoring position) drive momentum; isolated HRs remain dampened.
   - **Shutout:** 0-hit streak of 2+ innings penalizes the offense's lambda ×0.7.
   - **RISP Conversion:** ≤25% conversion on ≥4 attempts → offense lambda ×0.75; ≥50% on ≥3 attempts → ×1.15. **v45.1 RISP-Early:** 0-for-N with N≥3 in the first 2 innings triggers an immediate ×0.60 floor (does not stack with the ×0.75 cut).
   - **Locked-In / Meltdown / Opener-Lock / Resurrection:** after ≥2 IP today, K/9 ≥9 and BB ≤1 cuts opposing offense λ×0.65 (×0.90 more if FPS ≥60%); a 3+ ER inning raises it ×1.30. **Opener-Lock exclusion:** locked-in does not apply to openers/expected short outings (`sp_season_games_started == 0` or `sp_ip_avg < 4.0`, or live removal before the 3rd). **Resurrection:** SP with season ERA >6 or last-3 ERA >7 who has thrown 2+ consecutive clean innings today discounts opposing offense ×0.70 (unless meltdown already triggered).
   - **Solo-HR dampener:** when all a team's runs come from solo HRs and its RISP conversion is 0, that offense's lambda is scaled ×0.90 additional.
   - **RE24:** current base-out run expectancy is added to the active half-inning expectation.
   - **TTOP:** SP still pitching from inning 3 onward adds an ×1.08 penalty to innings 4-5.
   - **Error & stress inning:** fielding error in current inning boosts that offense ×1.20; pitcher ≥25 pitches in an inning boosts the next opposing offense ×1.15.
   - **Bullpen Transition:** `*_sp_removed` uses the actual current reliever ERA from the live box; falls back to `team_bullpen_era` only when unknown.
   - **Fatigue:** `*_sp_pitches` > 85 boosts the opposing lambda ×1.15 for remaining innings.
5. Pregame: exact Poisson over 5 innings (fast, deterministic); live: remaining innings + score base + RE24
6. `evaluateMarkets` with overround **1.05**, value threshold **65**

The office passes the active database version into `PLATEWIRE_FORMULA_VERSION`, `PLATEWIRE_VALUE_THRESHOLD`, `PLATEWIRE_OVERROUND`, and `PLATEWIRE_FORMULA_CONSTANTS`. Those change the label, the 65/1.05 gates, league constants, and park factors. The v45.1 modules stay in this script.

## Removed from v44

- v43.1 accumulated-hits exception (0-0, hits≥4 halved ice-cold penalty) — deleted, superseded by the RISP Conversion Module.
- Surge boost from raw hit volume — now only quality events count.
- Flat defaults with no signal — `sprint_speed=27`, `gb_pct=0.45`, `bullpen_era=4.5` no longer inject fake signal in MQI when tagged `default`.

## Decision helpers (you still judge)

- **Pass** if no markets, incomplete SPs + heavy defaults, or no bet ≥ threshold
- **Bet** only sides in `value_bets`; prefer higher `value_pct` then `roi_pct`
- Never blend tracks; state track + `captured_at`
- Soften conviction when many `input_sources` are `default`

## Common Pitfalls

1. **Computing in the LLM head** instead of the script — forbidden for published numbers.
2. **Using team totals / handicaps** in the pool — script ignores them on purpose.
3. **American odds** — inputs are decimal.
4. **Coors chaos** — engine may inflate variance; read `notes` / breakdown.

## Verification Checklist

- [ ] Script stdout is valid JSON with `formula_version: v45.1`
- [ ] `--override-sp` was used if SP mismatch warning appeared
- [ ] Track name matches the odds window discussed with the user
- [ ] Any recommended bet appears in `value_bets` (or you explicitly override with reason)
- [ ] Gaps from pack completeness were stated
