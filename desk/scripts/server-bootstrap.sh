#!/usr/bin/env bash
# One-shot install/upgrade of the Platewire service on the VPS supervisor.
# Run ON the server as root:
#   ssh SuperAgent 'bash /opt/platewire/desk/scripts/server-bootstrap.sh'
# Idempotent: safe to re-run after a git pull.
set -euo pipefail

REPO="${PLATEWIRE_REPO:-/opt/platewire}"
DESK="$REPO/desk"
HERMES_HOME="${HERMES_HOME:-/home/platewire/.hermes}"
OFFICE_ENV="$DESK/.env.office"
SERVICE=/etc/systemd/system/platewire-webhook.service

log() { printf '\n== %s\n' "$*"; }

log "repo present"
test -d "$REPO/.git" || { echo "no git repo at $REPO"; exit 1; }
cd "$REPO"

if [[ ! -f "$OFFICE_ENV" ]]; then
  echo "missing $OFFICE_ENV — create it from desk/.env.office.example first" >&2
  exit 1
fi

log "python check"
command -v python3 >/dev/null || { echo "python3 missing" >&2; exit 1; }

log "office smoke test (no Telegram)"
PLATEWIRE_SKIP_TELEGRAM=1 python3 "$DESK/scripts/run_game.py" --help >/dev/null
PLATEWIRE_SKIP_TELEGRAM=1 python3 "$DESK/scripts/bank.py" --help >/dev/null

log "systemd webhook unit"
install -m 0644 /dev/stdin "$SERVICE" <<UNIT
# Platewire office webhook: the collector POSTs here, this run reaches the
# platewire Hermes agent (HERMES_HOME=/home/platewire/.hermes).
[Unit]
Description=Platewire office webhook (dispatcher -> Hermes agent)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=platewire
Group=platewire
WorkingDirectory=$DESK
EnvironmentFile=$OFFICE_ENV
Environment="HOME=/home/platewire"
Environment="HERMES_HOME=$HERMES_HOME"
ExecStart=/usr/bin/python3 $DESK/scripts/office_webhook.py --port 8645
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

log "enable + start"
systemctl daemon-reload
systemctl enable --now platewire-webhook.service
sleep 1
systemctl --no-pager --full status platewire-webhook.service | head -12

log "health"
curl -fsS -m 5 http://127.0.0.1:8645/health && echo

log "done"