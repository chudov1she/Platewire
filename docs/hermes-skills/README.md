# Platewire Hermes skills

Skills for a [Hermes Agent](https://github.com/NousResearch/hermes-agent) that
treats Platewire as an **MLB F5 data collector** and runs After-5 math itself.

## Install (server: the office agent owns the desk)

The office runs on the same box as the collector, as the `platewire` user.

```bash
src=/opt/platewire/docs/hermes-skills
dst=/home/platewire/.hermes/skills/mlb

for name in platewire-office platewire-api platewire-pack platewire-f5-engine platewire-desk; do
  rm -rf "$dst/$name"
  cp -r "$src/$name" "$dst/$name"
done
chown -R platewire:platewire "$dst"
```

Restart the gateway (`systemctl restart platewire-gateway`) or start a **new**
chat so the skills are discovered. `hermes skills list` shows what is loaded.

## Collector settings

`/home/platewire/.hermes/.env`:

```
PLATEWIRE_BASE_URL=http://127.0.0.1:8000/api/v1
PLATEWIRE_LOGIN=admin
PLATEWIRE_PASSWORD=<from /root/PLATEWIRE-ACCESS.txt>
```

MCP (same collector, no login). Put this in `/home/platewire/.hermes/config.yaml`;
the token is the last path segment of the MCP route and lives in
`/opt/platewire/.env.docker`:

```yaml
mcp_servers:
  platewire:
    url: "http://127.0.0.1:8000/mcp/$MCP_SERVICE_TOKEN"
```

Restart the gateway after editing the config — Hermes loads it at startup.

Tools: `list_slate`, `get_game`, `get_pack`, `search`, `get_player`,
`get_official`, `get_odds`, `sync_slate`, `refresh_game`, `refresh_odds`,
`refresh_context`, `refresh_player`, `pipeline_status`, `list_formulas`,
`save_formula`, `activate_formula`, `list_sources`, `save_source`, `list_runs`.

The Python client in `platewire-f5-engine` logs in over HTTP. `execute_code`
cannot call MCP tools — use the terminal or the MCP tools directly.

## Skill map

| Skill | Job |
|---|---|
| `platewire-office` | The betting office: formula version, paper bank, ledger, daily report |
| `platewire-api` | Auth + every collector endpoint Hermes may call |
| `platewire-pack` | Read / interpret `GET .../pack` dossiers |
| `platewire-f5-engine` | Compute λ, F5 probs, value bets from a pack (Python) |
| `platewire-desk` | Manual analyst loop: slate → pack → calc → bet/pass |
| `platewire-office` | The office: formula, paper bank, ledger, daily report |

Formula source of truth in-repo: `docs/extracted-formula/`.
Runtime Platewire does **not** evaluate bets — Hermes does.
