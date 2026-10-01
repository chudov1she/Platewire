"""Redraw the pinned bank card, or add units when the general is asked to top up."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cashier import deposit, send_day_report, show_board  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    add = sub.add_parser("deposit")
    add.add_argument("--amount", type=float, required=True)
    add.add_argument("--note", default="")
    report = sub.add_parser("report")
    report.add_argument("--day", default="", help="UTC day YYYY-MM-DD, default today")
    args = parser.parse_args()
    if args.cmd == "show":
        result = show_board()
    elif args.cmd == "report":
        result = send_day_report(args.day or None)
    else:
        result = deposit(args.amount, args.note)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
