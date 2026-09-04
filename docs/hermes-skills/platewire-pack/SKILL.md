---
name: platewire-pack
description: "Use when reading or explaining a Platewire game pack (GET /games/:id/pack) — lineups, SP features, weather, umpire, F5 odds tracks, features.inputs provenance, completeness. Not for HTTP auth map (platewire-api) or λ/value computation (platewire-f5-engine)."
version: 1.0.0
author: Platewire
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [platewire, mlb, pack, dossier, savant, weather, umpire]
    related_skills: [platewire-api, platewire-f5-engine, platewire-desk]
---

# Platewire Game Pack

## Overview

One authenticated call returns everything Hermes needs to reason about an MLB
F5 matchup. Prefer pack over stitching `/context` + `/weather` + `/odds/f5`
unless debugging a single layer.

## When to Use

- User asks what is known about a game, matchup, ump, weather, or book lines
- You must decide if a game is ready to calculate
- Don't use to invent missing Statcast — report `input_sources` / completeness gaps

## Fetch

```bash
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" pack <game_id>
```

Or curl with Bearer token (see `platewire-api`).

## How to read (order)

1. **Identity** — `game` status, scores, inning, `home`/`away` names, `venue`
2. **Completeness** — if SPs or odds track missing, say so before any bet talk
3. **features.inputs** — numeric dossier for the engine (former `MatchupInputs`)
4. **features.input_sources** — which fields are real features vs defaults
5. **odds.tracks** — pick `prematch` / `inn1` / `inn2` for the bet window
6. **Narrative layers** — weather, umpire, lineup players (explain, don't invent)

Detail schema: `references/pack-schema.md`.

## Completeness → action

| Flag | If false |
|---|---|
| `has_home_sp` / `has_away_sp` | Wait or sync; λ will lean on defaults |
| `has_lineup` | Note default offense; confidence down |
| `has_odds.<track>` | Cannot price value for that track |
| `weather_ready` | Weather WIF ≈ 1; mention uncertainty |
| pack `ump_ready` | Ump factor ≈ 1 / pitcher_bias fallback |

## Odds tracks

Each track is an independent F5 snapshot:

- `moneyline`: `{ home, away, draw? }` decimal
- `main_total`: `{ line, over, under }`
- Also may include `totals`, `handicaps`, team totals — **engine bet pool uses only moneyline + main_total**

`locked` / `ok` / `captured_at` matter: stale or `ok:false` → do not force a pick.

## Presenting to the user

Keep one short briefing:

- Matchup + SP names if present
- Weather / park one-liner
- HP ump + any zone bias signal
- Which odds track + main line
- Gaps from completeness / `input_sources` marked `default`

Then hand off to `platewire-f5-engine` for numbers.

## Common Pitfalls

1. **Mixing tracks** — never price inn2 with prematch λ without saying so.
2. **Treating defaults as Savant** — check `input_sources`.
3. **Reading American odds** — Platewire F5 stores **decimal**.
4. **Expecting value_bets in pack** — pack is facts only.

## Verification Checklist

- [ ] Pack JSON has `features.inputs.home` and `.away`
- [ ] Named the odds track used
- [ ] Stated completeness gaps explicitly
- [ ] Did not claim formula output came from the API
