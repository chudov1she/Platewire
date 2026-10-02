"""Single writer for the paper bank, the ledger, and the Telegram alert."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from io import BytesIO
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = Path(os.environ["PLATEWIRE_RUNTIME"]) if os.environ.get("PLATEWIRE_RUNTIME") else ROOT / "runtime"
LEDGER = RUNTIME / "ledger.jsonl"
BUDGET_PATH = RUNTIME / "budget.json"
BOARD_PATH = RUNTIME / "board.json"
SEED_BUDGET = ROOT / "budget.json"
LOCK_PATH = RUNTIME / "cashier.lock"
TELEGRAM_PATH = ROOT / "telegram.json"


def _hermes_env_path() -> Path:
    """Windows keeps Hermes under %LOCALAPPDATA%; Linux under HERMES_HOME."""
    explicit = os.environ.get("PLATEWIRE_HERMES_ENV", "").strip()
    if explicit:
        return Path(explicit)
    home = os.environ.get("HERMES_HOME", "").strip()
    if home:
        return Path(home) / ".env"
    local = os.environ.get("LOCALAPPDATA", "").strip()
    if local:
        return Path(local) / "hermes" / ".env"
    return Path.home() / ".hermes" / ".env"


HERMES_ENV = _hermes_env_path()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(fallback)
    return json.loads(path.read_text(encoding="utf-8"))


def load_budget() -> dict[str, Any]:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    seed = _read_json(SEED_BUDGET, {})
    budget = _read_json(BUDGET_PATH, seed)
    if budget.get("day") != _day():
        budget["day"] = _day()
        budget["day_pnl"] = 0
    budget.setdefault("open", [])
    budget.setdefault("bank_units", seed.get("bank_units", 1000))
    budget.setdefault("max_per_game", seed.get("max_per_game", 10))
    budget.setdefault("max_open_units", seed.get("max_open_units", 60))
    budget.setdefault("unit", seed.get("unit", 10))
    budget.pop("daily_stop", None)
    return budget


def save_budget(budget: dict[str, Any]) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    BUDGET_PATH.write_text(json.dumps(budget, ensure_ascii=False, indent=2), encoding="utf-8")


def append_ledger(row: dict[str, Any]) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


class _Lock:
    def __enter__(self) -> "_Lock":
        RUNTIME.mkdir(parents=True, exist_ok=True)
        for _ in range(50):
            try:
                fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                return self
            except FileExistsError:
                time.sleep(0.1)
        raise TimeoutError("cashier lock busy")

    def __exit__(self, *_) -> None:
        try:
            LOCK_PATH.unlink()
        except OSError:
            pass


def _hermes_env() -> dict[str, str]:
    out: dict[str, str] = {}
    if not HERMES_ENV.exists():
        return out
    for line in HERMES_ENV.read_text(encoding="utf-8").splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"')
    return out


def _telegram_chat() -> str:
    override = (os.environ.get("PLATEWIRE_TELEGRAM_CHAT") or "").strip()
    if override:
        return override
    data = _read_json(TELEGRAM_PATH, {})
    return str(data.get("chat_id") or "").strip()


def _post_telegram(token: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raw = json.dumps(data).encode("utf-8")
        raise urllib.error.HTTPError(
            req.full_url, 400, str(data.get("description") or "telegram"), hdrs=None, fp=BytesIO(raw)
        )
    return data


def send_telegram(message: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("PLATEWIRE_SKIP_TELEGRAM") == "1":
        return {"ok": False, "skipped": True, "reason": "skipped"}
    token = _hermes_env().get("TELEGRAM_BOT_TOKEN", "")
    chat_id = _telegram_chat()
    if not token or not chat_id:
        return {"ok": False, "skipped": True, "reason": "telegram_not_configured"}
    rich = {"chat_id": chat_id, "rich_message": {"blocks": message["blocks"]}}
    try:
        _post_telegram(token, "sendRichMessage", rich)
        return {"ok": True, "skipped": False}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        try:
            _post_telegram(token, "sendMessage", {"chat_id": chat_id, "text": message["plain"]})
            return {"ok": True, "skipped": False, "fallback": "plain", "rich_error": detail}
        except urllib.error.HTTPError as plain_exc:
            plain_detail = plain_exc.read().decode("utf-8", errors="replace")[:200]
            return {"ok": False, "skipped": False, "reason": detail, "plain_error": plain_detail}


def _open_units(budget: dict[str, Any]) -> float:
    return sum(float(item.get("stake") or 0) for item in budget.get("open") or [])


def _num(value: float) -> str:
    text = f"{float(value):.4f}".rstrip("0").rstrip(".")
    return text or "0"


def _signed(value: float) -> str:
    text = _num(value)
    if value > 0:
        return f"+{text}"
    return text


def load_ledger() -> list[dict[str, Any]]:
    if not LEDGER.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def week_stats(rows: list[dict[str, Any]], today: date | None = None) -> list[dict[str, Any]]:
    """Last 7 UTC days, oldest first. Stakes count on the day they were taken; pnl on the day they were graded."""
    anchor = today or datetime.now(timezone.utc).date()
    days = [(anchor - timedelta(days=6 - offset)).isoformat() for offset in range(7)]
    out = {
        day: {
            "day": day,
            "bets": 0,
            "wins": 0,
            "losses": 0,
            "pushes": 0,
            "voids": 0,
            "pnl": 0.0,
            "deposits": 0.0,
        }
        for day in days
    }
    for row in rows:
        bucket = out.get(str(row.get("ts") or "")[:10])
        if bucket is None:
            continue
        kind = row.get("kind")
        if kind == "card" and row.get("decision") == "bet":
            bucket["bets"] += 1
        elif kind == "settle" and row.get("result") in {"win", "loss", "push", "void"}:
            bucket[f"{row['result']}s"] += 1
            bucket["pnl"] = round(bucket["pnl"] + float(row.get("pnl") or 0), 4)
        elif kind == "deposit":
            bucket["deposits"] = round(bucket["deposits"] + float(row.get("amount") or 0), 4)
    return [out[day] for day in days]


def day_summary(rows: list[dict[str, Any]], today: str | None = None) -> dict[str, Any]:
    """Settled paper results for one UTC day."""
    day = today or _day()
    won = lost = 0.0
    bets = wins = losses = pushes = voids = 0
    settled: list[dict[str, Any]] = []
    for row in rows:
        if str(row.get("ts") or "")[:10] != day:
            continue
        if row.get("kind") == "card" and row.get("decision") == "bet":
            bets += 1
        if row.get("kind") != "settle" or row.get("result") not in {"win", "loss", "push", "void"}:
            continue
        pnl = float(row.get("pnl") or 0)
        if pnl > 0:
            won = round(won + pnl, 4)
        elif pnl < 0:
            lost = round(lost + abs(pnl), 4)
        result = str(row.get("result"))
        if result == "win":
            wins += 1
        elif result == "loss":
            losses += 1
        elif result == "push":
            pushes += 1
        else:
            voids += 1
        settled.append(
            {
                "game_id": row.get("game_id"),
                "matchup": row.get("matchup"),
                "market": row.get("market"),
                "side": row.get("side"),
                "line": row.get("line"),
                "decimal_odds": row.get("decimal_odds"),
                "result": result,
                "pnl": pnl,
                "stake": row.get("stake"),
                "f5": row.get("f5"),
            }
        )
    return {
        "day": day,
        "bets": bets,
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "voids": voids,
        "won_units": won,
        "lost_units": lost,
        "net_units": round(won - lost, 4),
        "settled": settled,
    }


def _day_report_message(summary: dict[str, Any], why: str) -> dict[str, Any]:
    titles = {"win": "выигрыш", "loss": "проигрыш", "push": "возврат", "void": "возврат"}
    rows = [
        [_cell("Отчёт за день", header=True), _cell(str(summary["day"]), header=True, align="right")],
        _row("Ставок", str(summary["bets"])),
        _row("Счёт", f"{summary['wins']}–{summary['losses']}"),
        _row("Подняли", _signed(float(summary["won_units"]))),
        _row("Потеряли", _signed(-float(summary["lost_units"])) if summary["lost_units"] else "0"),
        _row("Итог", _signed(float(summary["net_units"]))),
    ]
    blocks: list[dict[str, Any]] = [
        {
            "type": "table",
            "is_bordered": True,
            "is_striped": True,
            "is_compact": True,
            "caption": "Итоги дня",
            "cells": rows,
        }
    ]
    settled = summary.get("settled") or []
    if settled:
        game_rows = [
            [
                _cell("Игра", header=True),
                _cell("Результат", header=True),
                _cell("Итог", header=True, align="right"),
            ]
        ]
        for item in settled[:8]:
            line = item.get("line")
            line_bit = f" {line:g}" if isinstance(line, (int, float)) else ""
            market = "тотал" if item.get("market") == "total" else "исход"
            game_rows.append(
                [
                    _cell(str(item.get("matchup") or "")),
                    _cell(f"{titles.get(item.get('result'), '')} · {market}{line_bit} {_side_label(item.get('side'))}".strip()),
                    _cell(_signed(float(item.get("pnl") or 0)), align="right"),
                ]
            )
        blocks.append(
            {
                "type": "table",
                "is_bordered": True,
                "is_striped": True,
                "is_compact": True,
                "caption": "Игры",
                "cells": game_rows,
            }
        )
    if why:
        blocks.append({"type": "heading", "text": "Итог", "size": 5})
        blocks.append({"type": "paragraph", "text": why})
    plain = (
        f"Отчёт {summary['day']}: подняли {summary['won_units']}, "
        f"потеряли {summary['lost_units']}, итог {summary['net_units']}. {why}"
    )
    return {"plain": plain, "blocks": blocks}


def send_day_report(today: str | None = None) -> dict[str, Any]:
    """Rich message for one UTC day: won, lost, and a short model note."""
    rows = load_ledger()
    summary = day_summary(rows, today)
    why = ""
    if summary["settled"]:
        from explain import compose_argument, day_cases, explain_day

        cases = day_cases(rows, str(summary["day"]))
        has_model = any(item.get("есть_снимок") for item in cases)
        if has_model:
            why = explain_day(cases) or compose_argument(cases)
        else:
            why = "По этим ставкам не сохранён снимок модели, поэтому разобрать день по ожиданию и линии нельзя."
    else:
        why = "За этот день рассчитанных ставок нет."
    message = _day_report_message(summary, why)
    token = _hermes_env().get("TELEGRAM_BOT_TOKEN", "")
    chat_id = _telegram_chat()
    if not token or not chat_id:
        return {"ok": False, "skipped": True, "reason": "telegram_not_configured", "summary": summary, "why": why}
    try:
        _post_telegram(token, "sendRichMessage", {"chat_id": chat_id, "rich_message": {"blocks": message["blocks"]}})
        sent = {"ok": True, "skipped": False}
    except urllib.error.HTTPError as exc:
        sent = {"ok": False, "skipped": False, "reason": _telegram_error(exc)}
    return {"telegram": sent, "summary": summary, "why": why}


def _side_label(side: Any) -> str:
    return {"home": "П1", "away": "П2", "draw": "Х", "over": "больше", "under": "меньше"}.get(
        str(side), str(side or "")
    )


def _board_message(budget: dict[str, Any], rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    stats = week_stats(rows if rows is not None else load_ledger())
    bank = float(budget.get("bank_units") or 0)
    open_items = list(budget.get("open") or [])
    open_units = _open_units(budget)
    day_pnl = float(budget.get("day_pnl") or 0)
    state_rows = [
        [_cell("Банк", header=True), _cell(_num(bank), header=True, align="right")],
        _row("В игре", f"{_num(open_units)} · {len(open_items)}"),
        _row("Сегодня", _signed(day_pnl)),
        _row("Ставка", _num(float(budget.get("unit") or 0))),
    ]
    trend = [
        [
            _cell("День", header=True),
            _cell("Ставки", header=True, align="right"),
            _cell("W–L", header=True, align="right"),
            _cell("Итог", header=True, align="right"),
            _cell("Внесено", header=True, align="right"),
        ]
    ]
    for item in stats:
        label = item["day"][8:10] + "." + item["day"][5:7]
        record = f"{item['wins']}–{item['losses']}"
        if item["pushes"] or item["voids"]:
            record = f"{record} / {item['pushes'] + item['voids']}"
        trend.append(
            [
                _cell(label),
                _cell(str(item["bets"]), align="right"),
                _cell(record, align="right"),
                _cell(_signed(item["pnl"]), align="right"),
                _cell(_signed(item["deposits"]) if item["deposits"] else "0", align="right"),
            ]
        )
    bets = sum(item["bets"] for item in stats)
    wins = sum(item["wins"] for item in stats)
    losses = sum(item["losses"] for item in stats)
    pnl = round(sum(item["pnl"] for item in stats), 4)
    deposits = round(sum(item["deposits"] for item in stats), 4)
    trend.append(
        [
            _cell("7 дней", header=True),
            _cell(str(bets), header=True, align="right"),
            _cell(f"{wins}–{losses}", header=True, align="right"),
            _cell(_signed(pnl), header=True, align="right"),
            _cell(_signed(deposits) if deposits else "0", header=True, align="right"),
        ]
    )
    blocks: list[dict[str, Any]] = [
        {
            "type": "table",
            "is_bordered": True,
            "is_striped": True,
            "is_compact": True,
            "caption": "Банк",
            "cells": state_rows,
        },
        {
            "type": "table",
            "is_bordered": True,
            "is_striped": True,
            "is_compact": True,
            "caption": "Последние 7 дней",
            "cells": trend,
        },
    ]
    if open_items:
        open_rows = [
            [
                _cell("Открыто", header=True),
                _cell("Рынок", header=True),
                _cell("Сумма", header=True, align="right"),
            ]
        ]
        for item in open_items[:8]:
            line = item.get("line")
            line_bit = f" {line:g}" if isinstance(line, (int, float)) else ""
            market = "тотал" if item.get("market") == "total" else "исход"
            open_rows.append(
                [
                    _cell(str(item.get("matchup") or "")),
                    _cell(f"{market}{line_bit} {_side_label(item.get('side'))}".strip()),
                    _cell(_num(float(item.get("stake") or 0)), align="right"),
                ]
            )
        blocks.append(
            {
                "type": "table",
                "is_bordered": True,
                "is_striped": True,
                "is_compact": True,
                "caption": "В игре",
                "cells": open_rows,
            }
        )
    plain = (
        f"Банк {_num(bank)} · в игре {_num(open_units)} · сегодня {_signed(day_pnl)} · "
        f"7 дней {wins}–{losses} {_signed(pnl)}"
    )
    return {"plain": plain, "blocks": blocks}


def _load_board() -> dict[str, Any]:
    if not BOARD_PATH.exists():
        return {}
    try:
        data = json.loads(BOARD_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _save_board(chat_id: str, message_id: int) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    BOARD_PATH.write_text(
        json.dumps({"chat_id": chat_id, "message_id": message_id}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _telegram_error(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read().decode("utf-8", errors="replace")[:300]
    except Exception:
        return str(exc)[:300]


def _message_gone(detail: str) -> bool:
    text = detail.lower()
    return "message to edit not found" in text or "message can't be edited" in text or "message_id_invalid" in text


def _telegram_call(token: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Call Telegram, backing off when the chat is rate-limited."""
    delay = 1.0
    last_detail = "telegram"
    for _ in range(4):
        try:
            return _post_telegram(token, method, payload)
        except urllib.error.HTTPError as exc:
            detail = _telegram_error(exc)
            setattr(exc, "telegram_detail", detail)
            last_detail = detail
            lowered = detail.lower()
            if "too many requests" in lowered or "retry after" in lowered:
                time.sleep(delay)
                delay = min(delay * 2, 8)
                continue
            raise
        except urllib.error.URLError:
            time.sleep(delay)
            delay = min(delay * 2, 8)
    raise TimeoutError(last_detail)


def _unpin_message(token: str, chat_id: str, message_id: int) -> None:
    try:
        _telegram_call(
            token,
            "unpinChatMessage",
            {"chat_id": chat_id, "message_id": message_id},
        )
    except Exception:
        pass


def _publish_board(budget: dict[str, Any]) -> dict[str, Any]:
    """Rewrite the pinned bank card. Caller holds the cashier lock."""
    if os.environ.get("PLATEWIRE_SKIP_TELEGRAM") == "1":
        return {"ok": False, "skipped": True, "reason": "skipped"}
    token = _hermes_env().get("TELEGRAM_BOT_TOKEN", "")
    chat_id = _telegram_chat()
    if not token or not chat_id:
        return {"ok": False, "skipped": True, "reason": "telegram_not_configured"}
    message = _board_message(budget)
    rich = {"blocks": message["blocks"]}
    state = _load_board()
    message_id = state.get("message_id") if str(state.get("chat_id") or "") == chat_id else None
    previous_id = int(message_id) if message_id else None
    action = "edited"
    if message_id:
        try:
            _telegram_call(
                token,
                "editMessageText",
                {"chat_id": chat_id, "message_id": message_id, "rich_message": rich},
            )
        except urllib.error.HTTPError as exc:
            detail = str(getattr(exc, "telegram_detail", "") or _telegram_error(exc))
            if "not modified" in detail.lower():
                action = "unchanged"
            elif _message_gone(detail):
                message_id = None
            else:
                return {"ok": False, "skipped": False, "reason": detail, "message_id": previous_id}
        except TimeoutError as exc:
            return {"ok": False, "skipped": False, "reason": str(exc), "message_id": previous_id}
    if not message_id:
        try:
            data = _telegram_call(token, "sendRichMessage", {"chat_id": chat_id, "rich_message": rich})
        except urllib.error.HTTPError as exc:
            return {"ok": False, "skipped": False, "reason": _telegram_error(exc)}
        except TimeoutError as exc:
            return {"ok": False, "skipped": False, "reason": str(exc)}
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        message_id = result.get("message_id")
        action = "created"
        if not message_id:
            return {"ok": False, "skipped": False, "reason": "no_message_id"}
        _save_board(chat_id, int(message_id))
        if previous_id and previous_id != int(message_id):
            _unpin_message(token, chat_id, previous_id)
    pinned = False
    pin_error = ""
    try:
        _post_telegram(
            token,
            "pinChatMessage",
            {"chat_id": chat_id, "message_id": message_id, "disable_notification": True},
        )
        pinned = True
    except urllib.error.HTTPError as exc:
        pin_error = _telegram_error(exc)
    return {
        "ok": True,
        "skipped": False,
        "action": action,
        "message_id": message_id,
        "pinned": pinned,
        "pin_error": pin_error,
    }


def _touch_board(budget: dict[str, Any]) -> None:
    for attempt in range(3):
        try:
            result = _publish_board(budget)
        except Exception:
            result = {"ok": False}
        if result.get("ok") or result.get("skipped"):
            return
        if attempt < 2:
            time.sleep(1.5)


def show_board() -> dict[str, Any]:
    with _Lock():
        budget = load_budget()
        save_budget(budget)
        return _publish_board(budget)


def deposit(amount: float, note: str = "") -> dict[str, Any]:
    """Add units to the paper bank and refresh the pinned card."""
    value = round(float(amount), 4)
    if not value > 0 or value > 1_000_000:
        raise ValueError("amount must be greater than 0 and at most 1000000")
    text = str(note or "").strip()[:200]
    with _Lock():
        budget = load_budget()
        budget["bank_units"] = round(float(budget["bank_units"]) + value, 4)
        save_budget(budget)
        row = {
            "ts": _now(),
            "kind": "deposit",
            "amount": value,
            "note": text,
            "bank_units": budget["bank_units"],
        }
        append_ledger(row)
        row["board"] = _publish_board(budget)
        return row


def post_card(card: dict[str, Any]) -> dict[str, Any]:
    """Record a pseudo-bet. Send Telegram only when the bank accepts a stake."""
    with _Lock():
        budget = load_budget()
        bet = card.get("bet") if isinstance(card.get("bet"), dict) else None
        stake = 0.0
        sent = False
        telegram: dict[str, Any] = {"ok": False, "skipped": True, "reason": "pass"}
        decision = "pass"
        reason = card.get("pass_reason") or "no_value"

        if card.get("reason") in {"final", "f5_settled"}:
            return _settle_locked(budget, card)

        if bet:
            want = min(float(budget["unit"]), float(budget["max_per_game"]))
            room = float(budget["max_open_units"]) - _open_units(budget)
            already = any(item.get("game_id") == card.get("game_id") for item in budget["open"])
            if already:
                reason = "already_open"
            elif want > float(budget["bank_units"]):
                reason = "bank_empty"
            elif want > room:
                reason = "open_limit"
            else:
                stake = want
                decision = "bet"
                reason = "accepted"
                budget["bank_units"] = round(float(budget["bank_units"]) - stake, 4)
                budget["open"].append(
                    {
                        "game_id": card.get("game_id"),
                        "matchup": card.get("matchup"),
                        "stage": card.get("stage"),
                        "stake": stake,
                        "market": bet.get("market"),
                        "side": bet.get("side"),
                        "line": bet.get("line"),
                        "decimal_odds": bet.get("decimal_odds"),
                        "opened_at": _now(),
                    }
                )
                save_budget(budget)
                message = _alert(card, bet, stake, budget)
                telegram = send_telegram(message)
                sent = bool(telegram.get("ok"))
                _touch_board(budget)

        row = {
            "ts": _now(),
            "kind": "card",
            "game_id": card.get("game_id"),
            "matchup": card.get("matchup"),
            "stage": card.get("stage"),
            "trigger": card.get("trigger"),
            "formula_version": card.get("formula_version"),
            "decision": decision,
            "reason": reason,
            "stake": stake,
            "bet": bet,
            "sent": sent,
            "telegram": telegram,
            "bank_units": budget.get("bank_units"),
            "gaps": card.get("gaps") or [],
            "why": card.get("why"),
            "pass_why": card.get("pass_why"),
            "line_age_s": card.get("line_age_s"),
            "line_fresh": card.get("line_fresh"),
            "read": card.get("read") if isinstance(card.get("read"), dict) else None,
        }
        append_ledger(row)
        if decision == "bet":
            save_budget(budget)
        else:
            save_budget(budget)
        return row


def grade_position(item: dict[str, Any], home: int, away: int) -> dict[str, Any]:
    """Grade one open F5 stake. Payout is what comes back to the bank."""
    stake = float(item.get("stake") or 0)
    odds = float(item.get("decimal_odds") or 0)
    market = str(item.get("market") or "")
    side = str(item.get("side") or "")
    line = item.get("line")
    total = home + away

    def win() -> dict[str, Any]:
        payout = round(stake * odds, 4)
        return {"result": "win", "payout": payout, "pnl": round(payout - stake, 4)}

    def loss() -> dict[str, Any]:
        return {"result": "loss", "payout": 0.0, "pnl": round(-stake, 4)}

    def push() -> dict[str, Any]:
        return {"result": "push", "payout": stake, "pnl": 0.0}

    if market == "total" and isinstance(line, (int, float)):
        if side == "over":
            if total > line:
                return win()
            if total < line:
                return loss()
            return push()
        if side == "under":
            if total < line:
                return win()
            if total > line:
                return loss()
            return push()
    if market == "moneyline":
        if home == away:
            return win() if side == "draw" else push()
        winner = "home" if home > away else "away"
        if side == winner:
            return win()
        return loss()
    return push()


def _read_for_game(game_id: Any) -> dict[str, Any] | None:
    """The model snapshot of the accepted stake, used to explain the outcome."""
    for row in reversed(load_ledger()):
        if row.get("game_id") != game_id:
            continue
        if row.get("kind") == "card" and row.get("decision") == "bet" and isinstance(row.get("read"), dict):
            return row["read"]
    return None


def _settle_locked(budget: dict[str, Any], card: dict[str, Any]) -> dict[str, Any]:
    game_id = card.get("game_id")
    open_items = [item for item in budget.get("open") or [] if item.get("game_id") == game_id]
    budget["open"] = [item for item in budget.get("open") or [] if item.get("game_id") != game_id]
    f5 = card.get("f5") if isinstance(card.get("f5"), dict) else None
    void = bool(card.get("void")) or f5 is None
    graded: list[dict[str, Any]] = []
    for item in open_items:
        if void:
            outcome = {"result": "void", "payout": float(item.get("stake") or 0), "pnl": 0.0}
            home = away = None
        else:
            home = int(f5.get("home") or 0)
            away = int(f5.get("away") or 0)
            outcome = grade_position(item, home, away)
        budget["bank_units"] = round(float(budget["bank_units"]) + outcome["payout"], 4)
        budget["day_pnl"] = round(float(budget.get("day_pnl") or 0) + outcome["pnl"], 4)
        row = {
            "ts": _now(),
            "kind": "settle",
            "game_id": game_id,
            "matchup": card.get("matchup") or item.get("matchup"),
            "stage": item.get("stage"),
            "result": outcome["result"],
            "stake": item.get("stake"),
            "payout": outcome["payout"],
            "pnl": outcome["pnl"],
            "market": item.get("market"),
            "side": item.get("side"),
            "line": item.get("line"),
            "decimal_odds": item.get("decimal_odds"),
            "f5": None if void else {"home": home, "away": away},
            "bank_units": budget["bank_units"],
            "day_pnl": budget["day_pnl"],
        }
        why = ""
        try:
            from explain import explain_result

            why = explain_result(row, _read_for_game(game_id)) or ""
        except Exception:
            why = ""
        row["why_result"] = why or None
        append_ledger(row)
        graded.append(row)
        save_budget(budget)
        try:
            send_telegram(_settle_alert(row, why))
        except Exception:
            pass
    if graded:
        _touch_board(budget)
        return graded[-1]
    row = {
        "ts": _now(),
        "kind": "settle",
        "game_id": game_id,
        "matchup": card.get("matchup"),
        "result": "none",
        "bank_units": budget.get("bank_units"),
    }
    append_ledger(row)
    return row


def _settle_alert(row: dict[str, Any], why: str = "") -> dict[str, Any]:
    titles = {"win": "Выигрыш", "loss": "Проигрыш", "push": "Возврат", "void": "Возврат"}
    title = titles.get(str(row.get("result")), "Расчёт")
    f5 = row.get("f5") or {}
    score = ""
    if f5:
        score = f"{f5.get('away')}:{f5.get('home')}"
    line = row.get("line")
    line_bit = f" {line:g}" if isinstance(line, (int, float)) else ""
    side = {"home": "П1", "away": "П2", "draw": "Х", "over": "больше", "under": "меньше"}.get(
        str(row.get("side")), str(row.get("side") or "")
    )
    market = "тотал" if row.get("market") == "total" else "исход"
    note = "Первые пять иннингов не доиграны, ставка возвращена." if row.get("result") == "void" else ""
    rows = [
        [_cell(title, header=True), _cell(str(row.get("matchup") or ""), header=True, align="right")],
        _row("Счёт 5 иннингов", score or "—"),
        _row("Рынок", f"{market}{line_bit} {side}".strip()),
        _row("Выплата", f"{float(row.get('payout') or 0):g}"),
        _row("Итог дня", f"{float(row.get('day_pnl') or 0):g}"),
        _row("Банк", f"{float(row.get('bank_units') or 0):g}"),
    ]
    blocks: list[dict[str, Any]] = [
        {
            "type": "table",
            "is_bordered": True,
            "is_striped": True,
            "is_compact": True,
            "cells": rows,
        }
    ]
    if note:
        blocks.append({"type": "paragraph", "text": note})
    if why:
        blocks.append({"type": "heading", "text": "Почему так", "size": 5})
        blocks.append({"type": "paragraph", "text": why})
    plain = f"{title} {row.get('matchup')} {score} выплата {row.get('payout')} банк {row.get('bank_units')}"
    if why:
        plain = f"{plain}\n\n{why}"
    return {"plain": plain, "blocks": blocks}


def _cell(text: str, header: bool = False, align: str = "left") -> dict[str, Any]:
    return {"text": text, "is_header": header, "align": align}


def _row(label: str, value: str) -> list[dict[str, Any]]:
    return [_cell(label), _cell(value, align="right")]


def _alert(
    card: dict[str, Any],
    bet: dict[str, Any],
    stake: float,
    budget: dict[str, Any],
) -> dict[str, Any]:
    line = bet.get("line")
    line_bit = f" {line:g}" if isinstance(line, (int, float)) else (f" {line}" if line else "")
    side = {"home": "П1", "away": "П2", "draw": "Х", "over": "больше", "under": "меньше"}.get(
        str(bet.get("side")), str(bet.get("side"))
    )
    market = "тотал" if bet.get("market") == "total" else "исход"
    stage = {"prematch": "до старта", "inn1": "после 1-го", "inn2": "после 2-го"}.get(
        str(card.get("stage")), str(card.get("stage") or "")
    )
    odds = bet.get("decimal_odds")
    odds_text = f"{odds:g}" if isinstance(odds, (int, float)) else str(odds)
    value = round(float(bet.get("value_pct") or 0), 1)
    rows = [
        [_cell("Ставка", header=True), _cell(str(card.get("matchup") or ""), header=True, align="right")],
        _row("Стадия", stage),
        _row("Рынок", f"{market}{line_bit} {side}"),
        _row("Коэффициент", odds_text),
        _row("Сумма", f"{stake:g} ед."),
        _row("Value", f"{value:g}%"),
        _row("Формула", str(card.get("formula_version") or "")),
        _row("Банк", f"{float(budget.get('bank_units') or 0):g}"),
    ]
    plain = (
        f"{card.get('matchup')} · {stage}\n"
        f"{market}{line_bit} {side} @ {odds_text}\n"
        f"{stake:g} ед. · value {value:g}% · банк {float(budget.get('bank_units') or 0):g}"
    )
    blocks: list[dict[str, Any]] = [
        {
            "type": "table",
            "is_bordered": True,
            "is_striped": True,
            "is_compact": True,
            "cells": rows,
        }
    ]
    why = str(card.get("why") or "").strip()
    if why:
        blocks.append({"type": "heading", "text": "Почему ставим", "size": 5})
        blocks.append({"type": "paragraph", "text": why})
        plain = f"{plain}\n\n{why}"
    return {"plain": plain, "blocks": blocks}
