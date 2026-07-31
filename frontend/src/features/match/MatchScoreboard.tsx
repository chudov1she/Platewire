"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { countdownLabel, countLabel, formatDateTime, inningLabel, stageLabel, weatherOneLiner } from "@/features/match/match-format";
import { deriveStage, teamLabel } from "@/lib/board";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { NestGame } from "@/types";

export function MatchScoreboard({
  game,
  nowMs,
  lastPolledAt,
  onRefresh,
}: {
  game: NestGame;
  nowMs: number;
  lastPolledAt?: string | null;
  onRefresh?: () => Promise<void>;
}) {
  const stage = deriveStage(game, nowMs);
  const isLive = stage === "live";
  const showCountdown = stage === "future";
  const [refreshing, setRefreshing] = useState(false);
  const fetchedClock = game.fetched_at
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(game.fetched_at))
    : null;
  const polledClock = lastPolledAt
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(lastPolledAt))
    : null;

  return (
    <section className="overflow-hidden rounded-lg border border-border/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
            ← {copy.nav.backToList}
          </Link>
          <span className={cn("font-mono text-[10px] font-bold uppercase tracking-wide", isLive ? "text-emerald-400" : "text-muted-foreground")}>
            {isLive ? "Live" : stageLabel(stage)}
          </span>
          {game.status_detail ? <span className="text-[11px] text-muted-foreground">{game.status_detail}</span> : null}
          {isLive && (polledClock || fetchedClock) ? (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              · обновлено {polledClock ?? fetchedClock}
              {fetchedClock && polledClock && fetchedClock !== polledClock ? ` · mlb ${fetchedClock}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-xs text-muted-foreground">
            {showCountdown ? (
              <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {countdownLabel(game.game_date_utc, nowMs, stage)}
              </span>
            ) : (
              formatDateTime(game.game_date_utc)
            )}
          </div>
          {onRefresh ? (
            <Button
              className="h-7 px-2 text-[11px]"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                onRefresh().finally(() => setRefreshing(false));
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {refreshing ? "…" : "Обновить"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 px-3 py-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4 sm:px-4">
        <div className="min-w-0 sm:text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Away</p>
          <p className="truncate text-lg font-semibold tracking-tight sm:text-xl">{teamLabel(game.away_team)}</p>
        </div>

        <div className="flex items-baseline justify-center gap-2 font-mono">
          <span className={cn("text-3xl font-bold tabular-nums sm:text-4xl", isLive ? "text-emerald-300" : "text-foreground")}>
            {game.away_score ?? "–"}
          </span>
          <span className="text-xl text-muted-foreground">:</span>
          <span className={cn("text-3xl font-bold tabular-nums sm:text-4xl", isLive ? "text-emerald-300" : "text-foreground")}>
            {game.home_score ?? "–"}
          </span>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Home</p>
          <p className="truncate text-lg font-semibold tracking-tight sm:text-xl">{teamLabel(game.home_team)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground sm:px-4">
        <span>{inningLabel(game)}</span>
        {isLive ? (
          <>
            <span aria-hidden>·</span>
            <span>{countLabel(game)}</span>
          </>
        ) : null}
        {game.venue ? (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">
              {game.venue.name}
              {game.venue.city ? `, ${game.venue.city}` : ""}
            </span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span className="truncate">Погода: {weatherOneLiner(game)}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">mlb_pk {game.mlb_game_pk}</span>
      </div>
    </section>
  );
}
