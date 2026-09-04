---
name: platewire-desk
description: "Use when running a full Platewire F5 desk session — today's slate triage, pack brief, Hermes-side calc, bet/pass calls. Orchestrates platewire-api + platewire-pack + platewire-f5-engine. Triggers: desk, slate review, what should we bet, F5 card."
version: 1.0.0
author: Platewire
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [platewire, mlb, desk, workflow, betting-analysis]
    related_skills: [platewire-api, platewire-pack, platewire-f5-engine]
---

# Platewire Analyst Desk

## Overview

End-to-end loop for Hermes as the betting brain on top of Platewire data.
Platewire = facts. You = slate triage + calculation + explicit bet/pass.

## When to Use

- "Что ставить сегодня?", "разбери slate", "F5 desk", "карточка по игре"
- Don't use for UI bugs in the Next app (unless asked) or real-money execution

## Tight loop

### 1. Auth + slate

```bash
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" today
```

Completion: JSON with `games[]` and per-game `completeness`.

### 2. Triage

Partition games:

- **Ready**: both SPs + `has_odds` for the target track (usually `prematch`)
- **Watch**: SPs yes, odds/weather/lineup pending
- **Skip**: missing both SPs or postponed/final without a live track ask

Completion: short table of Ready / Watch / Skip with game ids.

### 3. Pack brief (Ready first)

For each Ready game (or user-picked id):

```bash
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" pack <game_id>
```

Apply `platewire-pack` reading order. One paragraph brief + gaps.

### 4. Calculate (mandatory script)

```bash
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/analyze_pack.py" \
  --game-id <game_id> --track prematch
```

Completion: pasted key fields — λ, expected total, top `value_bets` / `all_bets`.

### 5. Call

For each game output exactly one of:

- **BET** — market, side, line, decimal odds, model_prob, value_pct, track, one-line why
- **PASS** — reason (no edge / incomplete / locked / defaults-heavy)
- **WAIT** — what layer is missing (odds refresh, lineup, weather)

Never invent a BET that is not in script `value_bets` unless user asks to override;
if overriding, label **OVERRIDE** and show model vs book.

### 6. Optional ops

If slate empty or stale: ADMIN may `POST /games/sync` or pipeline tick
(see `platewire-api` references). Confirm before writes.

## Output template

```
## Slate YYYY-MM-DD
Ready: …
Watch: …
Skip: …

## Cards
### AWAY @ HOME (id)
Brief: …
Calc: λh=… λa=… E[tot]=… | track=prematch
Call: BET/PASS/WAIT — …
```

## Common Pitfalls

1. **Stopping after slate** without packs/calc when user asked for picks.
2. **LLM math** instead of `analyze_pack.py`.
3. **Prematch lines on a live ask** — switch track to `inn1`/`inn2`.
4. **Silent gaps** — always mention completeness / default inputs.

## Verification Checklist

- [ ] Used API slate (not memory of yesterday)
- [ ] Every BET/PASS backed by a script run or explicit WAIT
- [ ] Track named per card
- [ ] No call to removed formula/ledger endpoints
