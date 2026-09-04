import Link from "next/link";
import { countdownLabel, countLabel, inningLabel, stageLabel } from "@/features/match/match-format";
import { deriveStage, teamLabel, type Stage } from "@/lib/board";
import { cn } from "@/lib/utils";
import type { NestGame } from "@/types";

function stageTone(stage: Stage) {
  if (stage === "live") return "text-emerald-400";
  if (stage === "final") return "text-muted-foreground";
  return "text-foreground/80";
}

export function GameRow({
  game,
  nowMs,
  href,
}: {
  game: NestGame;
  nowMs: number;
  href: string;
}) {
  const stage = deriveStage(game, nowMs);
  const live = stage === "live";
  const final = stage === "final";
  const showCountdown = stage === "future";
  const scoreReady = game.away_score != null || game.home_score != null;
  const rightValue =
    live || final || (scoreReady && !showCountdown)
      ? `${game.away_score ?? "–"}:${game.home_score ?? "–"}`
      : showCountdown
        ? countdownLabel(game.game_date_utc, nowMs, stage)
        : inningLabel(game);

  const c = game.completeness;

  return (
    <Link
      className={cn(
        "group relative grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border-b border-border/70 px-3 py-3 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-4",
        live && "bg-emerald-500/[0.04]",
      )}
      href={href}
    >
      {live ? <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-emerald-400" /> : null}

      <div className="w-[4.5rem] shrink-0 sm:w-20">
        <span className={cn("font-mono text-[10px] font-bold uppercase tracking-wide", stageTone(stage))}>
          {live ? "Live" : stageLabel(stage)}
        </span>
        {live ? (
          <>
            <span className="mt-0.5 block font-mono text-[11px] font-semibold tabular-nums text-emerald-300">
              {inningLabel(game)}
            </span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">{countLabel(game)}</span>
          </>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold leading-snug tracking-tight text-foreground sm:text-base">
          <span>{teamLabel(game.away_team)}</span>
          <span className="mx-1.5 text-muted-foreground/60">@</span>
          <span>{teamLabel(game.home_team)}</span>
        </div>
        {c ? (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            {c.has_lineup ? <span>lineup</span> : null}
            {c.has_odds?.prematch ? <span>odds·P</span> : null}
            {c.has_odds?.inn1 ? <span>odds·1</span> : null}
            {c.has_odds?.inn2 ? <span>odds·2</span> : null}
            {c.weather_ready ? <span>wx</span> : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            "font-mono text-base font-bold tabular-nums leading-none sm:text-lg",
            live ? "text-emerald-300" : "text-foreground",
          )}
        >
          {rightValue}
        </div>
        {!live && showCountdown ? <span className="mt-1 block text-[10px] text-muted-foreground">до старта</span> : null}
      </div>
    </Link>
  );
}
