# Extracted After-5 formula (archived)

This folder is a **snapshot** of the Platewire formula engine that used to live
under `backend/src/formula`. The runtime app no longer imports or runs it.

Platewire is now a **data collector**: it gathers MLB / Savant / weather /
umpire / Winline facts and exposes them via `GET /api/v1/games/:id/pack`.
Betting logic (lambda, value bets, signals, Decision/Curation agents, paper
ledger) belongs outside this repo — e.g. a Hermes agent that consumes the pack.
Ready-made Hermes skills + Python v42 runner: `docs/hermes-skills/`.

## Inputs (from Game Pack)

Hermes should read:

| Pack field | Former formula type |
|---|---|
| `features.inputs` | `MatchupInputs` (home/away TeamInputs, weather, ump, live F5, seed) |
| `features.input_sources` | provenance per field (`feature` / `default` / `open_meteo` / …) |
| `odds.tracks.{prematch,inn1,inn2}` | market lines → former `MarketLine[]` |
| `completeness` | readiness-style flags (no betting score) |

Assemble `MarketLine[]` from a track’s `moneyline`, `totals`, `handicaps`,
`main_total`, `main_team_totals`, `main_handicap` the same way
`market-loader.service.ts` used to (not copied here — reconstruct from odds
JSON or from git history).

## Outputs (former `After5Analysis`)

- `lambda_home` / `lambda_away`, expected runs, F5 probabilities
- `value_bets` / `signals` (edge vs book odds)
- `breakdown`, `simulation_mode`, `formula_version`

## Files in this snapshot

| File | Role |
|---|---|
| `formula.types.ts` | FormulaSpec, MatchupInputs, ValueBet, After5Analysis |
| `formula-spec.ts` | defaults, normalize, patch |
| `formula-eval.ts` / `formula-registry.ts` | expression env for derived / lambda mults |
| `formula-runner.service.ts` | Nest wrapper over v42 (strip Nest when porting) |
| `engines/v42/*` | lambda → simulate → markets |

## FormulaSpec patch rules (for a future Hermes curation loop)

- Patch is partial: `parameters` / `derived` / `lambda_*_mult` / `notes`
- Derived expressions: env keys + `clamp` / `min` / `max` / `abs` + arithmetic
- Never activate production from AI alone — human apply was required in Platewire

## Auth for Pack API

```
POST /api/v1/auth/login   → Bearer token
GET  /api/v1/games/today
GET  /api/v1/games/:id/pack
```

USER or ADMIN status required (same JWT as the web app).
