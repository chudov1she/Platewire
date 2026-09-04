# Platewire Hermes skills

Skills for a local [Hermes Agent](https://github.com/NousResearch/hermes-agent) that
treats Platewire as an **MLB F5 data collector** and runs After-5 math itself.

## Install (Windows / this machine)

```powershell
$src = "D:\Projects\Sergey\platewire\docs\hermes-skills"
$dst = "$env:HERMES_HOME\skills\mlb"
# or: $dst = "C:\Users\nike_\AppData\Local\hermes\skills\mlb"

foreach ($name in @("platewire-api","platewire-pack","platewire-f5-engine","platewire-desk")) {
  New-Item -ItemType Directory -Force -Path "$dst\$name" | Out-Null
  Copy-Item -Recurse -Force "$src\$name\*" "$dst\$name\"
}
```

Add to `$HERMES_HOME/.env`:

```
PLATEWIRE_BASE_URL=http://localhost:8000/api/v1
PLATEWIRE_LOGIN=admin
PLATEWIRE_PASSWORD=admin
```

Restart Hermes (or start a **new** chat) so skills are discovered.

Preload:

```powershell
hermes chat -s platewire-desk,platewire-api,platewire-pack,platewire-f5-engine -q "Покажи сегодняшний MLB slate и completeness"
```

## Skill map

| Skill | Job |
|---|---|
| `platewire-api` | Auth + every collector endpoint Hermes may call |
| `platewire-pack` | Read / interpret `GET .../pack` dossiers |
| `platewire-f5-engine` | Compute λ, F5 probs, value bets from a pack (Python) |
| `platewire-desk` | End-to-end analyst loop: slate → pack → calc → bet/pass |

Formula source of truth in-repo: `docs/extracted-formula/`.
Runtime Platewire does **not** evaluate bets — Hermes does.
