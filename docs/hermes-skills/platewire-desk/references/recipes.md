# Desk one-shot recipes

Runs on the office server, as the `platewire` user, with the office env loaded:

```bash
set -a; . /opt/platewire/desk/.env.office; set +a
PY=/home/platewire/.hermes/skills/mlb/platewire-f5-engine/scripts
```

## Local smoke

```bash
python3 "$PY/platewire_client.py" login
python3 "$PY/platewire_client.py" today
# pick a game_id from the Ready list
python3 "$PY/analyze_pack.py" --game-id <uuid> --track prematch
```

## Hermes chat

```bash
hermes chat \
  -s platewire-desk,platewire-api,platewire-pack,platewire-f5-engine \
  -q "Сделай F5 desk на сегодня: triage slate, для Ready игр pack+calc, BET/PASS/WAIT"
```

## Single game deep dive

```bash
hermes chat -s platewire-pack,platewire-f5-engine,platewire-api \
  -q "Разбери игру <game_id>: pack brief и analyze_pack prematch"
```

## One game through the office

The office owns the money; do not compute a stake by hand.

```bash
python3 /opt/platewire/desk/scripts/run_game.py --game-id <uuid> --reason manual --stage prematch
python3 /opt/platewire/desk/scripts/bank.py report
```
