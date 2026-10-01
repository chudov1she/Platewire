#!/usr/bin/env python3
"""Office dispatcher: the collector POSTs a game event, this wakes the Hermes agent.

The collector (`office-events.service.ts`) signs the body with HMAC-SHA256 and
sends it to HERMES_WEBHOOK_URL. Hermes' dynamic webhook subscriptions are not
reachable from the box (they listen on 8644 and match on their own routes), so
the office keeps its own tiny listener on 127.0.0.1:8645 and starts the office
agent itself:

    hermes chat -q "<dispatcher prompt>"   (HERMES_HOME=/home/platewire/.hermes)

One event -> one agent run -> one `run_game.py` worker. Nothing else.

Env (see desk/.env.office.example):
    PLATEWIRE_WEBHOOK_SECRET   shared secret, must match HERMES_WEBHOOK_SECRET
    HERMES_HOME                Hermes home of the office agent
    PLATEWIRE_HERMES_BIN       optional, defaults to `hermes` on PATH
    PLATEWIRE_AGENT_TIMEOUT    seconds per agent run, default 900
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PROMPT_PATH = ROOT / "dispatcher-prompt.txt"
RUNTIME = Path(os.environ.get("PLATEWIRE_RUNTIME") or (ROOT / "runtime"))
LOG = RUNTIME / "webhook.log"
RUNS = RUNTIME / "runs"

# (game_id, fingerprint) seen recently — the collector retries and re-emits.
SEEN: dict[str, float] = {}
SEEN_LOCK = threading.Lock()
SEEN_TTL = 120.0

# The office must never run two workers on the same game at the same time.
BUSY: set[str] = set()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(line: str) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(f"{now()} {line}\n")


def _secret() -> str:
    return os.environ.get("PLATEWIRE_WEBHOOK_SECRET", "").strip()


def _signature_ok(body: bytes, header: str) -> bool:
    secret = _secret().encode("utf-8")
    if not secret:
        return False
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.strip())


def _seen(key: str) -> bool:
    with SEEN_LOCK:
        cutoff = time.time() - SEEN_TTL
        for stale in [k for k, ts in SEEN.items() if ts < cutoff]:
            SEEN.pop(stale, None)
        if key in SEEN:
            return True
        SEEN[key] = time.time()
        return False


def render_prompt(payload: dict[str, Any]) -> str:
    template = PROMPT_PATH.read_text(encoding="utf-8")
    fields = {
        "game_id": payload.get("game_id", ""),
        "reason": payload.get("reason", ""),
        "stage": payload.get("stage", ""),
        "matchup": payload.get("matchup", ""),
        "mlb_game_pk": payload.get("mlb_game_pk", ""),
    }
    for key, value in fields.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _agent_command(prompt: str) -> list[str]:
    binary = os.environ.get("PLATEWIRE_HERMES_BIN", "").strip() or "hermes"
    return [binary, "chat", "-q", prompt]


def run_agent(payload: dict[str, Any]) -> None:
    game_id = str(payload.get("game_id", ""))
    matchup = str(payload.get("matchup", game_id))
    reason = str(payload.get("reason", ""))
    stage = str(payload.get("stage", ""))
    prompt = render_prompt(payload)

    RUNS.mkdir(parents=True, exist_ok=True)
    out_path = RUNS / f"{int(time.time())}-{game_id[:8]}.log"
    log(f"spawn {matchup} {reason} {stage} game={game_id}")

    env = dict(os.environ)
    timeout = int(os.environ.get("PLATEWIRE_AGENT_TIMEOUT", "900") or 900)
    try:
        proc = subprocess.run(
            _agent_command(prompt),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=str(ROOT.parent if ROOT.name == "desk" else ROOT),
        )
        out_path.write_text(
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}\n",
            encoding="utf-8",
        )
        log(f"done {matchup} rc={proc.returncode} log={out_path}")
    except subprocess.TimeoutExpired:
        out_path.write_text(f"timeout after {timeout}s\n", encoding="utf-8")
        log(f"timeout {matchup} after {timeout}s log={out_path}")
    except Exception as exc:  # noqa: BLE001 - the listener must not die
        log(f"agent failed {matchup}: {exc}")
    finally:
        BUSY.discard(game_id)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802 - stdlib interface
        if self.path.rstrip("/") in ("/health", ""):
            self._send(200, {"status": "ok", "busy": sorted(BUSY)})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib interface
        if not self.path.rstrip("/").endswith("/webhooks/platewire"):
            self._send(404, {"ok": False, "error": "unknown route"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        signature = self.headers.get("X-Hub-Signature-256", "")
        if not _signature_ok(body, signature):
            log(f"reject bad signature from {self.client_address[0]}")
            self._send(401, {"ok": False, "error": "bad signature"})
            return
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": f"bad json: {exc}"})
            return

        game_id = str(payload.get("game_id", ""))
        fingerprint = str(payload.get("fingerprint", ""))
        key = f"{game_id}:{fingerprint}"
        if not game_id:
            self._send(400, {"ok": False, "error": "game_id missing"})
            return
        if _seen(key):
            log(f"duplicate ignored game={game_id} fingerprint={fingerprint}")
            self._send(200, {"ok": True, "duplicate": True})
            return
        if game_id in BUSY:
            log(f"busy ignored game={game_id}")
            self._send(200, {"ok": True, "busy": True})
            return

        BUSY.add(game_id)
        threading.Thread(target=run_agent, args=(payload,), daemon=True).start()
        self._send(202, {"ok": True, "started": True, "game_id": game_id})

    def log_message(self, fmt: str, *args: Any) -> None:
        log("http " + fmt % args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Platewire office webhook")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8645)
    args = parser.parse_args()

    if not _secret():
        raise SystemExit("PLATEWIRE_WEBHOOK_SECRET is empty — refusing to start")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    log(f"listening on {args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
