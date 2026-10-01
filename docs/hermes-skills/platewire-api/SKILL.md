---
name: platewire-api
description: "Use when calling Platewire (local or remote) MLB collector APIs — login, slate, game pack, context, weather, Savant, odds, pipeline. Auth + endpoint map only; for pack interpretation load platewire-pack; for λ/value math load platewire-f5-engine."
version: 1.0.0
author: Platewire
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [platewire, mlb, api, f5, baseball]
    related_skills: [platewire-pack, platewire-f5-engine, platewire-desk]
---

# Platewire API

## Overview

Platewire collects MLB facts (schedule, lineups, Statcast/Savant, weather, HP
umpire, Winline F5 odds). It exposes a JWT API. It does **not** run the betting
formula — that is Hermes (`platewire-f5-engine`).

## When to Use

- User mentions Platewire, local collector, F5 pack, MLB slate API
- You need to login / refresh token / hit any `/api/v1/*` route
- Don't use for: Polymarket, generic sportsbooks, or inventing odds

## Config

Read from environment (preferred) or ask once and cache in-session:

| Env | Default |
|---|---|
| `PLATEWIRE_BASE_URL` | `http://127.0.0.1:8000/api/v1` |
| `PLATEWIRE_LOGIN` | `admin` |
| `PLATEWIRE_PASSWORD` | `admin` |

Base URL must include `/api/v1`. Frontend (`:3000`) is UI-only — always call the API.

## Auth (every protected call)

```bash
curl -s -X POST "$PLATEWIRE_BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"login\":\"$PLATEWIRE_LOGIN\",\"password\":\"$PLATEWIRE_PASSWORD\"}"
```

Response: `{ "accessToken": "...", "expiresIn": "12h", "user": {...} }`.

Then: `Authorization: Bearer <accessToken>`.

`GET /auth/me` — verify token. Prefer USER/ADMIN accounts.

Helper script (same skill tree as f5-engine once installed):

```bash
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" login
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" today
python "$HERMES_HOME/skills/mlb/platewire-f5-engine/scripts/platewire_client.py" pack <game_id>
```

## Endpoint map

See `references/endpoints.md` for full list. Core read path:

1. `GET /games/today` or `GET /games?date=YYYY-MM-DD` → slate + `completeness`
2. `GET /games/:id/pack` → full dossier (preferred single call)
3. Optional deep dives: `/games/:id/context`, `/weather`, `/savant`, `/odds/f5`

Write / ops (ADMIN): `POST /games/sync`, `POST /ops/pipeline/tick`, layered `*/refresh`.

## Completeness gates (slate)

Skip or flag games missing what you need:

- `has_home_sp` / `has_away_sp` — probable pitchers
- `has_lineup` — batting order
- `has_odds.prematch|inn1|inn2` — F5 book track present
- `weather_ready` — Open-Meteo or MLB weather string

## Common Pitfalls

1. **Hitting `:3000` instead of `:8000/api/v1`.** Pack is backend-only.
2. **Forgetting Bearer.** 401 → re-login.
3. **Calling removed formula/ledger/agent routes.** Expect 404; compute locally.
4. **Assuming slate is a bare array.** Shape is `{ ok, date, count, games: [...] }`.

## Verification Checklist

- [ ] Login returns `accessToken`
- [ ] `/games/today` returns `games` with `completeness`
- [ ] `/games/:id/pack` returns `features.inputs` + `odds.tracks`
- [ ] No dependency on `/formula/*` or `/ledger/*`
