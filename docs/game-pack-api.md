# Game Pack API

Hermes (or any client) pulls collected MLB knowledge in one request.

## Endpoints

```
POST /api/v1/auth/login
Authorization: Bearer <token>

GET /api/v1/games/today
GET /api/v1/games?date=YYYY-MM-DD
GET /api/v1/games/:id/pack
```

Slate rows include a `completeness` object so you can skip empty games.

## Pack shape (summary)

- `game` — slate/live fields (scores, inning, teams, venue)
- `home` / `away` — lineup + starter + player features (context pack)
- `weather` — Open-Meteo observations + MLB weather strings
- `umpire` — HP + crew + scorecard/Statcast features
- `odds.tracks` — F5 snapshots `prematch` / `inn1` / `inn2`
- `features.inputs` — numeric dossier (former MatchupInputs)
- `completeness` / `as_of` — fullness and layer timestamps

No formula eval, value bets, or paper ledger — facts only.

Hermes agent skills (API + pack + F5 calc + desk): `docs/hermes-skills/`.
