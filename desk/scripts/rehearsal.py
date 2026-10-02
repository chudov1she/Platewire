#!/usr/bin/env python3
"""Rebuild the real game as a synthetic one and drive it through the whole office.

Clones the lineup and F5 odds snapshots of a real game under a new Game row
(status/inning/scores are then rewritten stage by stage), and runs the real
run_game.py at every stage: prematch -> inn1 -> inn2 -> final. That way the data
the office sees has exactly the shape production data has.

    python3 /opt/platewire/desk/scripts/rehearsal.py --source-pk 849844

Everything it creates is deletable with --cleanup.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

BASE = os.environ.get("PLATEWIRE_BASE_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")
LOGIN = os.environ.get("PLATEWIRE_LOGIN", "admin")
PASSWORD = os.environ.get("PLATEWIRE_PASSWORD", "")
DESK = Path("/opt/platewire/desk")
RUN_GAME = DESK / "scripts" / "run_game.py"
BANK = DESK / "scripts" / "bank.py"
RUNTIME = Path(os.environ.get("PLATEWIRE_RUNTIME", str(DESK / "runtime")))
FAKE_PK = 990001


def psql(sql: str) -> str:
    proc = subprocess.run(
        ["docker", "exec", "-i", "platewire-db-1", "psql", "-U", "postgres", "-d", "platewire", "-tA", "-c", sql],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql failed")
    return proc.stdout.strip()


def api(method: str, path: str, body=None, token=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw else None


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ), timeout=900)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def step(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}", flush=True)


def build(source_pk: int) -> str:
    psql(f'delete from "Game" where "mlbGamePk" = {FAKE_PK};')
    psql(
        f"""
        insert into "Game" (id, "mlbGamePk", season, "gameDateUtc", "officialDate", status, "statusDetail",
                            "homeTeamId", "awayTeamId", "venueId", "homeProbableMlbId", "awayProbableMlbId",
                            "weatherTemp", "weatherCondition", "scheduledInnings", "createdAt", "updatedAt", "fetchedAt")
        select gen_random_uuid()::text, {FAKE_PK}, season, now() + interval '40 minutes', current_date,
               'PREVIEW', 'Synthetic', "homeTeamId", "awayTeamId", "venueId",
               "homeProbableMlbId", "awayProbableMlbId", '72', 'Clear', 9, now(), now(), now()
        from "Game" where "mlbGamePk" = {source_pk};
        """
    )
    gid = psql(f'select id from "Game" where "mlbGamePk" = {FAKE_PK};')
    # real lineup, real names and Savant numbers
    psql(
        f"""
        insert into "GameLineupPlayer" (id, "gameId", side, "battingOrder", "playerId", "mlbPlayerId",
                                        "fullName", xwoba, xslg, xba, "barrelRate", "hardHitPct")
        select gen_random_uuid()::text, '{gid}', l.side, l."battingOrder", l."playerId", l."mlbPlayerId",
               l."fullName", l.xwoba, l.xslg, l.xba, l."barrelRate", l."hardHitPct"
        from "GameLineupPlayer" l
        join "Game" g on g.id = l."gameId" where g."mlbGamePk" = {source_pk};
        """
    )
    # real odds snapshots, re-stamped to this game
    psql(
        f"""
        insert into "F5OddsSnapshot" (id, "gameId", stage, locked, "winlineEventId", flipped,
                                      "moneylineJson", "totalsJson", "handicapsJson", "mainTotalJson",
                                      "mainHandicapJson", "marketsJson", ok, "rawMarketCount", "missingJson",
                                      "fetchedAt", "createdAt")
        select gen_random_uuid()::text, '{gid}', s.stage, false, s."winlineEventId", s.flipped,
               s."moneylineJson", s."totalsJson", s."handicapsJson", s."mainTotalJson",
               s."mainHandicapJson", s."marketsJson", s.ok, s."rawMarketCount", s."missingJson",
               now(), now()
        from "F5OddsSnapshot" s
        join "Game" g on g.id = s."gameId"
        where g."mlbGamePk" = {source_pk} and s.ok and s.stage = 'prematch';
        """
    )
    return gid


def restamp(gid: str, source_pk: int, stage: str) -> None:
    psql(
        f"""
        insert into "F5OddsSnapshot" (id, "gameId", stage, locked, "winlineEventId", flipped,
                                      "moneylineJson", "totalsJson", "handicapsJson", "mainTotalJson",
                                      "mainHandicapJson", "marketsJson", ok, "rawMarketCount", "missingJson",
                                      "fetchedAt", "createdAt")
        select gen_random_uuid()::text, '{gid}', s.stage, false, s."winlineEventId", s.flipped,
               s."moneylineJson", s."totalsJson", s."handicapsJson", s."mainTotalJson",
               s."mainHandicapJson", s."marketsJson", s.ok, s."rawMarketCount", s."missingJson",
               now(), now()
        from "F5OddsSnapshot" s join "Game" g on g.id = s."gameId"
        where g."mlbGamePk" = {source_pk} and s.ok and s.stage = '{stage}';
        """
    )


def live(gid: str, status: str, inning: int, half: str, home: int, away: int) -> None:
    psql(
        f'update "Game" set status = \'{status}\', inning = {inning}, "inningHalf" = \'{half}\', '
        f'"homeScore" = {home}, "awayScore" = {away}, "statusDetail" = \'{status} {inning}\' '
        f'where id = \'{gid}\';'
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-pk", type=int, default=849844)
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--skip-explain", action="store_true", help="set PLATEWIRE_SKIP_TELEGRAM")
    args = parser.parse_args()

    if args.cleanup:
        psql(f'delete from "Game" where "mlbGamePk" = {FAKE_PK};')
        print(f"removed the synthetic game (pk {FAKE_PK})")
        return 0

    print(f"SOURCE GAME pk={args.source_pk} -> SYNTHETIC pk={FAKE_PK}")
    gid = build(args.source_pk)
    print(f"synthetic game id: {gid}")

    tok = api("POST", "/auth/login", {"login": LOGIN, "password": PASSWORD})["accessToken"]

    step("БАНК ДО ПРОГОНА")
    print(run([sys.executable, str(BANK), "show"])[1][-800:])

    stages = [
        ("prematch", "PREVIEW", 0, "top", 0, 0),
        ("inn1", "LIVE", 1, "top", 0, 0),
        ("inn2", "LIVE", 3, "top", 3, 0),
    ]
    for stage, status, inning, half, home, away in stages:
        step(f"СТАДИЯ {stage.upper()}  (status={status} inning={inning} score {away}:{home})")
        if stage != "prematch":
            restamp(gid, args.source_pk, stage)
            live(gid, status, inning, half, home, away)
        else:
            live(gid, status, 0, half, home, away)
        rc, out = run([sys.executable, str(RUN_GAME), "--game-id", gid, "--reason", "stage_changed", "--stage", stage])
        print(f"--- run_game rc={rc} ---")
        print(out[-2600:])

    step("ИТОГ: СЧЁТ ПОСЛЕ 5 ИННИНГОВ + РАСЧЁТ")
    restamp(gid, args.source_pk, "inn2")
    live(gid, "FINAL", 5, "bottom", 4, 1)
    rc, out = run([sys.executable, str(RUN_GAME), "--game-id", gid, "--reason", "final", "--stage", "inn2"])
    print(f"--- run_game rc={rc} ---")
    print(out[-2600:])

    step("ОТЧЁТ ДНЯ (комментарий ИИ)")
    print(run([sys.executable, str(BANK), "report"])[1][-2000:])

    step("ЛЕДЖЕР: последние записи по этой игре")
    lines = [json.loads(l) for l in (RUNTIME / "ledger.jsonl").read_text(encoding="utf-8-sig").splitlines() if l.strip()]
    for row in [r for r in lines if r.get("game_id") == gid]:
        print(json.dumps(row, ensure_ascii=False)[:900])

    print(f"\nГотово. Убери псевдо-игру: python3 {__file__} --cleanup")
    return 0


if __name__ == "__main__":
    sys.exit(main())
