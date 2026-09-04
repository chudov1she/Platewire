# Platewire `/api/v1` endpoints (collector)

All routes below are under `PLATEWIRE_BASE_URL` (e.g. `http://localhost:8000/api/v1`).
Unless noted, require `Authorization: Bearer <token>`.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ login, password, rememberMe? }` → `accessToken` |
| POST | `/auth/telegram` | Telegram Login Widget |
| POST | `/auth/telegram/webapp` | Telegram Mini App |
| GET | `/auth/me` | Current user |

## Games / slate

| Method | Path | Notes |
|---|---|---|
| GET | `/games/today` | Today's slate; each game has `completeness` |
| GET | `/games?date=YYYY-MM-DD` | Dated slate |
| GET | `/games/:id` | Single game row |
| POST | `/games/sync` | Pull MLB schedule (ADMIN) |
| GET | `/games/:id/pack` | **Primary Hermes payload** — full dossier |

## Pack

`GET /games/:id/pack` →

- `game`, `home`, `away`, `venue`, `weather`, `umpire`
- `odds.tracks.{prematch,inn1,inn2}`
- `features.{inputs,input_sources,notes,context}`
- `completeness`, `as_of`

## Context / features

| Method | Path |
|---|---|
| GET | `/games/:id/context` |
| POST | `/games/:id/context/refresh` |
| GET | `/players/:mlbPlayerId/features` |
| GET | `/officials/:mlbOfficialId/features` |

## Weather

| Method | Path |
|---|---|
| GET | `/games/:id/weather` |
| POST | `/games/:id/weather/refresh` |

## Savant

| Method | Path |
|---|---|
| GET | `/games/:id/savant` |
| GET | `/games/:id/savant/statcast` |
| POST | `/games/:id/savant/refresh` |
| GET | `/players/:mlbPlayerId` |

## Odds (Winline F5)

| Method | Path |
|---|---|
| GET | `/odds/winline/matches` |
| POST | `/odds/winline/resolve` |
| POST | `/games/:id/odds` |
| POST | `/games/:id/odds/f5` |
| GET | `/games/:id/odds/f5` | Latest tracks (also inside pack) |

Tracks: `prematch`, `inn1`, `inn2` — independent bets; never borrow another track's line.

## Pipeline / ops

| Method | Path |
|---|---|
| GET | `/ops/pipeline` |
| POST | `/ops/pipeline/tick` |
| POST | `/ops/pipeline/run` |

Collect-only: live → weather → F5 odds → context. No ledger capture / Decision agent.

## Users (ADMIN)

| Method | Path |
|---|---|
| GET/POST | `/users` |
| GET | `/users/:id` |

## Health

| Method | Path | Auth |
|---|---|---|
| GET | `/health` (often outside `/api/v1` — check deploy) | public |

## Removed from runtime (do not call)

- `/formula/*`, `/games/:id/formula/eval`, `/games/:id/readiness`
- `/ledger/*`, `/games/:id/ledger/*`
- `/agent/*`, `/agent/chat`

Use `platewire-f5-engine` instead.
