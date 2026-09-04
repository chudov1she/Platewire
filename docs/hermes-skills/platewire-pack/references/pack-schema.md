# Game Pack schema (Hermes)

Top-level keys from `GET /api/v1/games/:id/pack`:

```json
{
  "game": { "...slate/live fields..." },
  "home": { "team": {}, "lineup": [], "starter": {}, "features": {} },
  "away": { "...same..." },
  "venue": {},
  "weather": {},
  "umpire": { "hp": {}, "crew": [], "features": {} },
  "odds": {
    "tracks": {
      "prematch": { "ok": true, "locked": false, "captured_at": "...", "moneyline": {}, "main_total": {}, "...": {} },
      "inn1": null,
      "inn2": null
    }
  },
  "features": {
    "inputs": { "home": {}, "away": {}, "venue": "", "live": null, "...weather/ump...": null },
    "input_sources": { "home.ops": { "source": "feature|default|...", "..." : "" } },
    "notes": [],
    "context": { "hasLineup": false, "hasHomeSp": true, "hasAwaySp": true }
  },
  "completeness": {
    "has_lineup": false,
    "has_home_sp": true,
    "has_away_sp": true,
    "has_odds": true,
    "weather_ready": false,
    "ump_ready": false
  },
  "as_of": { "game_fetched_at": "", "savant_preview_at": null, "weather_captured_at": null, "odds": {} }
}
```

## `features.inputs` → MatchupInputs

Used by `platewire-f5-engine` as-is:

- `home` / `away`: TeamInputs (`ops`, `sp_era`, `barrel_pct`, `hardhit_pct`, `gb_pct`, `sp_fip`, …)
- Venue / weather: `venue`, `temperature_f`, `humidity`, `wind_*`, `day_night`
- Ump: `ump_hp_name`, `ump_strike_zone_pct`, `ump_accuracy_above_x`, `ump_pitcher_bias`, …
- Live F5: `live.{completed_innings,home_score,away_score,sp_pitches,...}`
- `seed` for reproducible MC (engine may use exact Poisson instead)

## Market lines from a track

Bet pool (former `MarketLoaderService`):

```
moneyline.home → { market: moneyline, side: home, decimal_odds }
moneyline.away → away
moneyline.draw → draw (optional)
main_total → over/under with line
```

Sane odds filter historically: decimal in `[1.15, 5.5]` (draw ≤ 15).

## Provenance

Prefer fields with `input_sources.*.source == "feature"` (or open_meteo / ump scorecards).
`default` means league/template fill — lower confidence in the desk brief.
