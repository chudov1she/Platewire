---
name: platewire-office
description: "Use when running the Platewire betting office — formula version, paper bank, ledger, a top-up, a daily report, or a manual recompute of one game. Triggers: офис, бюджет, баланс, пополни, статистика, отчёт, итоги дня, формула, пересчитай игру, журнал ставок."
---

# Platewire office

The collector watches games. Hermes calculates. The cashier is a script, not a guess.

Desk root: `/opt/platewire/desk`

## General

You are the office general in this chat. Workers are `run_game.py` processes, not a second chat. See them with MCP `list_runs`. A running row is busy. To recompute one game, run the worker command below. Do not invent λ and do not send the bet Telegram yourself.

Formulas live in the collector database. Read them with `list_formulas`. To change the active math, `save_formula` with a new version name and `activate: true`, or `activate_formula` for one that already exists. Fields: `value_threshold`, `overround`, and `constants` (`league_era`, `league_ops`, `league_barrel`, `league_hardhit`, `league_sprint`, `league_gb_pct`, `league_bullpen_era`, `lambda_min`, `lambda_max`, `prob_cap`, `park_factors`). The math is v45.1 in `analyze_pack.py`. Saving a version changes those knobs. It does not replace the modules. The next worker reads the active version. A run that already started keeps the copy it loaded.

Data sources: `list_sources` and `save_source`. Builtin keys are `mlb_schedule`, `live_scores`, `savant`, `weather`, `winline`, `umpscorecards`. Set `enabled` false to pause that feed. A new feed is `adapter: http` plus `config.url`. The collector fetches it on the next tick and puts the payload on `extra_sources` in the pack, so the following run can see it.

## Formula

Active record: collector `GET /office/formula`. File fallback: `desk/formula/production.json` only if the collector is down.

```json
{ "version": "v45.1", "value_threshold": 65, "overround": 1.05 }
```

Do not edit the file when the collector is up. Save a new database version instead.

## One game

```bash
python3 /opt/platewire/desk/scripts/run_game.py --game-id <id> --reason manual --stage prematch
```

The script refreshes missing lineup, weather, or odds once, runs `analyze_pack.py`, and appends `desk/runtime/ledger.jsonl`.

## Bank

Seed: `desk/budget.json`. Live state: `desk/runtime/budget.json`.

- bank 1000 units
- flat 10 units when the formula finds value, and at most 10 on one game
- at most 60 units open at once
- a losing day does not block the next stake

When the fifth inning ends, or a finished game is probed later, the cashier grades the open stake on the first-five score. A win returns stake times the odds, a loss returns nothing, a push or a shortened game returns the stake. The group gets a result card. The daily result moves by the profit or the lost stake. The office marks the game settled only after this worker confirms. If the worker fails, the same event is sent again after three minutes. A game that was already being tracked is still graded after it leaves the recent window.

A pass stays in the ledger and does not go to Telegram. An accepted stake is reserved and sent to the group as a rich message: the stake table, then a short note from the model on why the formula took it. The note does not choose the bet.

The same group keeps one pinned rich message: bank, money in play, today's result, and the last 7 UTC days (stakes taken, wins–losses, settled pnl, deposits). The cashier rewrites that pin after a stake, a grade, or a deposit. Do not send a second balance card yourself.

When the user asks to top up the bank, add the units with this command and tell them the new bank from its output. Do not edit `budget.json` by hand. Amount is a positive number, at most 1000000.

```bash
python3 /opt/platewire/desk/scripts/bank.py deposit --amount <units> --note "<why>"
```

When the user asks for today's report, send one rich message. The tables carry the money and the results. The note under them is the day's overall result for the current formula and one or two recommendations it supports. The note does not change the formula and does not repeat the money table. Do not write that note yourself.

```bash
python3 /opt/platewire/desk/scripts/bank.py report
```

To redraw the pin without adding money:

```bash
python3 /opt/platewire/desk/scripts/bank.py show
```

## Dispatcher

The collector POSTs to `HERMES_WEBHOOK_URL` (loopback `127.0.0.1:8645/webhooks/platewire`)
on window open, lineup change, inning stage change, and final, signing the body with
`HERMES_WEBHOOK_SECRET`. `desk/scripts/office_webhook.py` validates the signature,
deduplicates on `game_id:fingerprint`, and starts the office agent:

```text
hermes chat -q "<desk/dispatcher-prompt.txt with the event filled in>"
```

The agent then runs exactly one worker:

```text
python3 /opt/platewire/desk/scripts/run_game.py --game-id <id> --reason <reason> --stage <stage>
```

One game, one run. Do not calculate λ in prose. Do not send Telegram yourself.
Duplicate and busy events are answered 200 and ignored; the listener log is
`desk/runtime/webhook.log`.
