---
name: platewire-f5-engine
description: "Use when computing MLB F5 lambdas, probabilities, or value bets from a Platewire pack — run the bundled Python analyzer (v42 port). Hermes calculates; Platewire API never returns value_bets. Triggers: edge, λ, over 4.5, moneyline fair price, signals."
version: 1.0.0
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

Port of archived After-5 **v42** math (`docs/extracted-formula` in Platewire).
You **must run the script** for numbers — do not hand-wave Poisson or invent λ.

## When to Use

- User wants fair probs, expected F5 runs, value vs book, bet candidates
- After a pack is available for a chosen odds track
- Don't use for: placing real bets, calling removed `/formula/eval`

## Run (required)

```bash
# From pack file
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/analyze_pack.py" \
  --pack pack.json --track prematch

# Fetch + analyze in one shot
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/analyze_pack.py" \
  --game-id <uuid> --track prematch
```

Env: `PLATEWIRE_BASE_URL`, `PLATEWIRE_LOGIN`, `PLATEWIRE_PASSWORD` (see `platewire-api`).

Output JSON includes: `lambda_home/away`, F5 lead/tie/over probs, `value_bets`
(≥ 65% value threshold), `all_bets`, `notes`, `markets_used`, `completeness`.

## Algorithm (checkable)

1. Read `features.inputs` as MatchupInputs
2. Build markets from `odds.tracks[track]` moneyline + `main_total` only
3. `buildLambdas` → park/weather/ump × offense/pitcher MQI
4. Pregame: exact Poisson over 5 innings (fast, deterministic); live: remaining innings + score base
5. `evaluateMarkets` with overround **1.05**, value threshold **65**

Reference TS: Platewire `docs/extracted-formula/engines/v42/`.

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

- [ ] Script stdout is valid JSON with `formula_version: v42`
- [ ] Track name matches the odds window discussed with the user
- [ ] Any recommended bet appears in `value_bets` (or you explicitly override with reason)
- [ ] Gaps from pack completeness were stated
