#!/usr/bin/env python3
"""Minimal Platewire HTTP client for Hermes skills."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v


def base_url() -> str:
    return (env("PLATEWIRE_BASE_URL", "http://localhost:8000/api/v1") or "").rstrip("/")


class PlatewireClient:
    def __init__(
        self,
        base: str | None = None,
        login: str | None = None,
        password: str | None = None,
        token: str | None = None,
    ) -> None:
        self.base = (base or base_url()).rstrip("/")
        self.login_name = login or env("PLATEWIRE_LOGIN", "admin") or "admin"
        self.password = password or env("PLATEWIRE_PASSWORD", "admin") or "admin"
        self.token = token or env("PLATEWIRE_TOKEN")

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        auth: bool = True,
    ) -> Any:
        url = f"{self.base}{path if path.startswith('/') else '/' + path}"
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if auth:
            if not self.token:
                self.ensure_token()
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise SystemExit(f"HTTP {e.code} {method} {url}: {detail}") from e

    def ensure_token(self) -> str:
        if self.token:
            return self.token
        payload = self._request(
            "POST",
            "/auth/login",
            {"login": self.login_name, "password": self.password},
            auth=False,
        )
        self.token = payload["accessToken"]
        return self.token

    def today(self) -> Any:
        return self._request("GET", "/games/today")

    def games(self, date: str) -> Any:
        return self._request("GET", f"/games?date={date}")

    def pack(self, game_id: str) -> Any:
        return self._request("GET", f"/games/{game_id}/pack")

    def game(self, game_id: str) -> Any:
        return self._request("GET", f"/games/{game_id}")

    def context(self, game_id: str) -> Any:
        return self._request("GET", f"/games/{game_id}/context")

    def weather(self, game_id: str) -> Any:
        return self._request("GET", f"/games/{game_id}/weather")

    def odds_f5(self, game_id: str) -> Any:
        return self._request("GET", f"/games/{game_id}/odds/f5")

    def pipeline(self) -> Any:
        return self._request("GET", "/ops/pipeline")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Platewire API helper")
    p.add_argument(
        "command",
        choices=[
            "login",
            "today",
            "games",
            "game",
            "pack",
            "context",
            "weather",
            "odds",
            "pipeline",
        ],
    )
    p.add_argument("game_id", nargs="?")
    p.add_argument("--date", help="YYYY-MM-DD for `games` command")
    args = p.parse_args(argv)
    client = PlatewireClient()

    if args.command == "login":
        token = client.ensure_token()
        print(json.dumps({"accessToken": token, "base": client.base}, indent=2))
        return 0
    if args.command == "today":
        print(json.dumps(client.today(), indent=2))
        return 0
    if args.command == "pipeline":
        print(json.dumps(client.pipeline(), indent=2))
        return 0
    if args.command == "games":
        if not args.date:
            p.error("games requires --date YYYY-MM-DD")
        print(json.dumps(client.games(args.date), indent=2))
        return 0
    if not args.game_id:
        p.error(f"{args.command} requires game_id")
    mapping = {
        "game": client.game,
        "pack": client.pack,
        "context": client.context,
        "weather": client.weather,
        "odds": client.odds_f5,
    }
    print(json.dumps(mapping[args.command](args.game_id), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
