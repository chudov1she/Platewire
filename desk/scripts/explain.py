"""Ask the office model to explain a bet the formula already accepted."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

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
MODEL = os.environ.get("PLATEWIRE_EXPLAIN_MODEL", "").strip() or "deepseek-v4.1-flash"
# Hermes keeps the key in .env but not the address; Ollama Cloud is the default.
DEFAULT_BASE = "https://ollama.com"


def _env() -> dict[str, str]:
    out: dict[str, str] = {}
    if not HERMES_ENV.exists():
        return out
    for line in HERMES_ENV.read_text(encoding="utf-8").splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"')
    return out


def _facts(card: dict[str, Any], bet: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    def num(value: Any) -> Any:
        if isinstance(value, float):
            return round(value, 2)
        return value

    return {
        "matchup": card.get("matchup"),
        "stage": card.get("stage"),
        "formula": card.get("formula_version"),
        "market": bet.get("market"),
        "side": bet.get("side"),
        "line": bet.get("line"),
        "decimal_odds": bet.get("decimal_odds"),
        "model_prob_pct": num(bet.get("model_prob")),
        "book_implied_pct": num(bet.get("implied_pct")),
        "value_pct": num(bet.get("value_pct")),
        "roi_pct": num(bet.get("roi_pct")),
        "value_threshold_pct": analysis.get("value_threshold_pct"),
        "lambda_home": num(analysis.get("lambda_home")),
        "lambda_away": num(analysis.get("lambda_away")),
        "expected_total": num(analysis.get("expected_total")),
        "simulation": analysis.get("simulation_mode"),
        "notes": analysis.get("notes") or [],
    }


def _chat(system: str, user: str, model: str | None = None) -> str | None:
    env = _env()
    base = (env.get("OLLAMA_BASE_URL") or os.environ.get("OLLAMA_BASE_URL") or DEFAULT_BASE).rstrip("/")
    key = env.get("OLLAMA_API_KEY") or os.environ.get("OLLAMA_API_KEY") or ""
    if not base or not key:
        return None
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    payload = {
        "model": model or MODEL,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    text = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    return text or None


def explain_bet(card: dict[str, Any], bet: dict[str, Any], analysis: dict[str, Any]) -> str | None:
    system = (
        "Ты аналитик офиса Platewire и пишешь в общий чат. Ставку уже выбрала формула, "
        "ты её не меняешь и не предлагаешь другую сторону. Напиши по-русски 3–5 живых "
        "предложений: сначала почему модель видит перевес, потом почему на это стоит "
        "поставить. Сторону называй по-русски: больше, меньше, победа хозяев, победа гостей. "
        "Не используй английские имена полей и слова lambda, over, under, value, ROI. "
        "Цифры из сообщения можно и нужно называть. Не выдумывай травмы, новости и составы. "
        "Без списков и без таблицы."
    )
    return _chat(system, json.dumps(_facts(card, bet, analysis), ensure_ascii=False))


def explain_pass(card: dict[str, Any], analysis: dict[str, Any], reason: str) -> str | None:
    """Why the formula did not take this game. Read by the office, never sent to the group."""
    facts = {
        "matchup": card.get("matchup"),
        "stage": card.get("stage"),
        "formula": analysis.get("formula_version") or card.get("formula_version"),
        "reason": reason,
        "gaps": card.get("gaps") or [],
        "threshold_pct": analysis.get("value_threshold_pct"),
        "expected_total": _round(analysis.get("expected_total"), 2),
        "lambda_home": _round(analysis.get("lambda_home"), 3),
        "lambda_away": _round(analysis.get("lambda_away"), 3),
        "markets_used": analysis.get("markets_used"),
        "best_value_pct": _round(analysis.get("best_value_pct"), 2),
        "data_problems": analysis.get("data_problems") or [],
        "notes": analysis.get("notes") or [],
    }
    system = (
        "Ты аналитик офиса Platewire. Формула не взяла эту игру. Объясни по-русски "
        "в 2–3 предложениях, почему ставки нет: чего не хватило — данных, рынка или перевеса. "
        "Если данных не хватало, скажи каких. Если рынок был, но перевес не дотянул до порога, "
        "скажи это прямо и назови цифры из данных. Сторону называй по-русски. "
        "Не используй слова lambda, value, ROI, over, under и английские имена полей. "
        "Не выдумывай травмы, новости и составы. Без списков и без таблицы."
    )
    return _chat(system, json.dumps(facts, ensure_ascii=False))


def explain_result(row: dict[str, Any], read: dict[str, Any] | None) -> str | None:
    """Why an accepted stake won or lost. Goes to the group with the result card."""
    f5 = row.get("f5") if isinstance(row.get("f5"), dict) else {}
    facts = {
        "matchup": row.get("matchup"),
        "result": row.get("result"),
        "market": row.get("market") or (read or {}).get("market"),
        "side": row.get("side") or (read or {}).get("side"),
        "line": row.get("line") if row.get("line") is not None else (read or {}).get("line"),
        "decimal_odds": row.get("decimal_odds"),
        "f5_score": f5 or None,
        "forecast_total": (read or {}).get("expected_total"),
        "forecast_home": (read or {}).get("expected_home"),
        "forecast_away": (read or {}).get("expected_away"),
        "threshold_pct": (read or {}).get("value_threshold"),
        "data_problems": (read or {}).get("data_problems") or [],
        "snapshot": bool(read),
    }
    system = (
        "Ты аналитик офиса Platewire. Ставка рассчитана. Объясни по-русски в 2–3 предложениях, "
        "почему она зашла или не зашла: что показал прогноз и что случилось на поле. "
        "Сторону называй по-русски: победа хозяев, победа гостей, больше, меньше. "
        "Если прогноз смотрел верно, а результат совпал — скажи это прямо. "
        "Если прогноз ошибся, назови причину: тонкий запас, дыры в данных или игра ушла в другую сторону. "
        "Не используй слова lambda, value, ROI и английские имена полей. "
        "Не выдумывай травмы, новости и составы. Без списков и без таблицы."
    )
    return _chat(system, json.dumps(facts, ensure_ascii=False))


def _round(value: Any, digits: int) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return round(float(value), digits)


def model_read(analysis: dict[str, Any], bet: dict[str, Any]) -> dict[str, Any]:
    """What the day note needs: the forecast, and which inputs were missing."""
    problems = analysis.get("data_problems")
    return {
        "expected_total": _round(analysis.get("expected_total"), 2),
        "expected_home": _round(analysis.get("expected_home_runs"), 2),
        "expected_away": _round(analysis.get("expected_away_runs"), 2),
        "formula": analysis.get("formula_version"),
        "value_threshold": _round(analysis.get("value_threshold_pct"), 1),
        "data_problems": [str(item) for item in problems] if isinstance(problems, list) else [],
        "market": bet.get("market"),
        "side": bet.get("side"),
        "line": bet.get("line"),
    }


def _same_direction(market: str, side: str, line: Any, actual: int | None, home: int | None, away: int | None) -> bool | None:
    if market == "total":
        if not isinstance(line, (int, float)) or actual is None:
            return None
        if side == "over":
            return actual > float(line)
        if side == "under":
            return actual < float(line)
        return None
    if market == "moneyline":
        if home is None or away is None:
            return None
        if side == "draw":
            return home == away
        if side == "home":
            return home > away
        if side == "away":
            return away > home
    return None


def _why(missed: bool | None, line: Any, expected: Any, problems: list[str], void: bool) -> str:
    if void:
        return "игру не доиграли до пяти иннингов, это не ошибка расчёта"
    if missed is None:
        return "счёта первых пяти нет, проверить ошибку нельзя"
    thin = isinstance(line, (int, float)) and isinstance(expected, (int, float)) and abs(float(expected) - float(line)) < 0.4
    if not missed and not problems:
        return "ошибки не было: данные на месте, и игра пошла в ту же сторону, куда смотрела формула"
    if not missed and problems:
        return "сторона совпала, но часть цифр была подставлена по среднему лиги, так что запас надёжности меньше"
    if missed and problems and thin:
        return "формула ошиблась на тонком месте и при дырах в данных: ожидание почти лежало на линии, а игра ушла в другую сторону"
    if missed and problems:
        return "формула ошиблась, и в данных были дыры: не хватало своих цифр, вместо них стояло среднее лиги"
    if missed and thin:
        return "формула ошиблась сама: данные были, но ожидание почти лежало на линии и запаса не было, игра ушла в другую сторону"
    return "формула ошиблась при полных данных: прогноз смотрел не в ту сторону"


def day_cases(rows: list[dict[str, Any]], today: str) -> list[dict[str, Any]]:
    """One plain diagnosis per settled stake. No prices and no probabilities."""
    reads: dict[str, dict[str, Any]] = {}
    for row in rows:
        if str(row.get("ts") or "")[:10] != today:
            continue
        if row.get("kind") == "card" and row.get("decision") == "bet" and isinstance(row.get("read"), dict):
            reads[str(row.get("game_id") or row.get("matchup") or "")] = row["read"]
    sides = {"home": "победа хозяев", "away": "победа гостей", "draw": "ничья", "over": "больше", "under": "меньше"}
    cases: list[dict[str, Any]] = []
    for row in rows:
        if str(row.get("ts") or "")[:10] != today:
            continue
        if row.get("kind") != "settle" or row.get("result") not in {"win", "loss", "push", "void"}:
            continue
        key = str(row.get("game_id") or row.get("matchup") or "")
        read = reads.get(key) or {}
        f5 = row.get("f5") if isinstance(row.get("f5"), dict) else {}
        home = away = actual = None
        if isinstance(f5.get("home"), (int, float)) and isinstance(f5.get("away"), (int, float)):
            home = int(f5["home"])
            away = int(f5["away"])
            actual = home + away
        market = str(row.get("market") or read.get("market") or "")
        side = str(row.get("side") or read.get("side") or "")
        line = row.get("line") if row.get("line") is not None else read.get("line")
        expected = read.get("expected_total")
        problems = [str(item) for item in read.get("data_problems") or []]
        void = row.get("result") == "void"
        thin = (
            isinstance(line, (int, float))
            and isinstance(expected, (int, float))
            and abs(float(expected) - float(line)) < 0.4
        )
        held = _same_direction(market, side, line, actual, home, away)
        missed = None if held is None else not held
        label = sides.get(side, side)
        market_label = "тотал" if market == "total" else "исход"
        line_bit = f" {line:g}" if isinstance(line, (int, float)) else ""
        cases.append(
            {
                "есть_снимок": bool(read),
                "матч": row.get("matchup"),
                "ставка": f"{market_label} {label}{line_bit}".strip(),
                "формула": read.get("formula"),
                "порог": read.get("value_threshold"),
                "ошиблась": missed,
                "тонко": thin,
                "почему": _why(missed, line, expected, problems, void) if read else "снимка модели нет, причину по данным не разобрать",
                "дыры_в_данных": problems,
            }
        )
    return cases


def day_rollup(cases: list[dict[str, Any]]) -> dict[str, Any]:
    """Overall result and the formula changes the day actually supports."""
    misses = [item for item in cases if item.get("ошиблась") is True]
    clear = [item for item in cases if item.get("ошиблась") is False]
    thin = [item for item in misses if item.get("тонко")]
    hole_misses = [item for item in misses if item.get("дыры_в_данных")]
    holes: list[str] = []
    for item in cases:
        for problem in item.get("дыры_в_данных") or []:
            if problem not in holes:
                holes.append(problem)
    advice: list[str] = []
    if thin:
        advice.append("не брать сторону, когда ожидание почти лежит на линии, и не опускать порог перевеса")
    if hole_misses or (holes and misses):
        advice.append("пропускать ставку, если вместо своих цифр стоит среднее лиги")
    if misses and not thin and not hole_misses:
        advice.append("порог не снижать: при полных данных формула смотрела не в ту сторону")
    if not misses and holes:
        advice.append("день сошёлся, но ставку на средних цифрах лиги лучше по-прежнему не брать")
    if not misses and not holes:
        advice.append("формулу сегодня не трогать")
    versions = []
    thresholds = []
    for item in cases:
        if item.get("формула") and item["формула"] not in versions:
            versions.append(item["формула"])
        if item.get("порог") is not None and item["порог"] not in thresholds:
            thresholds.append(item["порог"])
    lowered = any(isinstance(item, (int, float)) and float(item) < 65 for item in thresholds)
    return {
        "формула": ", ".join(str(item) for item in versions) or "текущая",
        "порог_опущен": lowered,
        "игр": len(cases),
        "без_ошибки": len(clear),
        "ошибок": len(misses),
        "главная_причина": thin and "прогноз стоял слишком близко к линии" or hole_misses and "не хватало своих данных" or misses and "прогноз смотрел не в ту сторону" or "ошибок не было",
        "дыры": holes,
        "рекомендации": advice,
        "где_ошиблась": [item.get("матч") for item in misses],
    }


def explain_day(cases: list[dict[str, Any]]) -> str | None:
    system = (
        "Ты аналитик офиса Platewire. Напиши общий итог дня и возможные рекомендации "
        "по текущей формуле. Сначала 2–3 предложения: сколько игр формула прочитала верно, "
        "где ошиблась и какая причина была главной. Затем 1–2 рекомендации строго из списка "
        "в данных. Свои правки не выдумывай и формулу сам не меняй. "
        "Не приводи проценты, коэффициенты и деньги. Не используй слова юнит, выигрыш, проигрыш, подняли, потеряли. "
        "Не выдумывай травмы и дыры, которых нет в списке. Без списков и без таблицы."
    )
    payload = json.dumps(day_rollup(cases), ensure_ascii=False)
    text = _chat(system, payload)
    if text and any(word in text.lower() for word in ("подняли", "потеряли", "юнит", "процент")):
        text = _chat(system + " Без денег и без процентов. Только итог и рекомендация по формуле.", payload)
    return text


def compose_argument(cases: list[dict[str, Any]]) -> str:
    """Overall result and formula advice used when the model call fails."""
    rollup = day_rollup(cases)
    if not rollup["игр"]:
        return "По этим ставкам не сохранён снимок модели, поэтому итог по формуле не собрать."
    where = ""
    if rollup["где_ошиблась"]:
        where = " Ошибки: " + ", ".join(str(item) for item in rollup["где_ошиблась"]) + "."
    advice = " ".join(f"Можно {item}." for item in rollup["рекомендации"])
    return (
        f"Формула {rollup['формула']}: без ошибки {rollup['без_ошибки']} из {rollup['игр']}. "
        f"Главное — {rollup['главная_причина']}.{where} {advice}"
    )
