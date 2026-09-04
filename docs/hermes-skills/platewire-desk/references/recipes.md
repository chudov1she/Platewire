# Desk one-shot recipes

## Local smoke

```powershell
$env:PLATEWIRE_BASE_URL = "http://localhost:8000/api/v1"
$env:PLATEWIRE_LOGIN = "admin"
$env:PLATEWIRE_PASSWORD = "admin"
$py = "$env:HERMES_HOME\skills\mlb\platewire-f5-engine\scripts"
python "$py\platewire_client.py" login
python "$py\platewire_client.py" today
# pick a game_id from Ready list
python "$py\analyze_pack.py" --game-id <uuid> --track prematch
```

## Hermes chat

```powershell
hermes chat `
  -s platewire-desk,platewire-api,platewire-pack,platewire-f5-engine `
  -q "Сделай F5 desk на сегодня: triage slate, для Ready игр pack+calc, BET/PASS/WAIT"
```

## Single game deep dive

```powershell
hermes chat -s platewire-pack,platewire-f5-engine,platewire-api `
  -q "Разбери игру <game_id>: pack brief и analyze_pack prematch"
```
