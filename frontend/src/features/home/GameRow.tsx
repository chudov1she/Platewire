import Link from "next/link";
import { ledgerResultLabel } from "@/features/match/ledger-labels";
import { countdownLabel, countLabel, inningLabel, stageLabel } from "@/features/match/match-format";
import { deriveStage, teamLabel, type Stage } from "@/lib/board";
import { cn } from "@/lib/utils";
import type { F5OddsStage, NestGame, NestLedgerEntry } from "@/types";
import { LEDGER_TRACKS } from "@/constants/ledger";

function stageTone(stage: Stage) {
  if (stage === "live") return "text-emerald-400";
  if (stage === "final") return "text-muted-foreground";
  return "text-foreground/80";
}

function MiniStageDots({ entries }: { entries: NestLedgerEntry[] }) {
  return (
    <div className="flex items-center gap-1">
      {LEDGER_TRACKS.map((stage) => {
        const entry = entries.find((e) => e.track === stage.id) ?? null;
        const has = Boolean(entry?.pickLabel);
        const result = entry ? ledgerResultLabel(entry.resultStatus) : null;
        return (
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[9px] font-bold uppercase",
              !entry && "bg-muted/40 text-muted-foreground/50",
              entry && !has && "bg-muted/60 text-muted-foreground",
              has && result === "WIN" && "bg-emerald-500/20 text-emerald-300",
              has && result === "LOSE" && "bg-destructive/20 text-red-300",
              has && result === "PENDING" && "bg-amber-500/15 text-amber-200",
              has && result === "PUSH" && "bg-muted text-foreground",
            )}
            key={stage.id}
            title={
              entry
                ? entry.action === "pass"
                  ? `${stage.label}: pass`
                  : `${stage.label}: ${entry.pickLabel ?? entry.pickMarket}`
                : `${stage.label}: нет данных`
            }
          >
            {stage.id === "prematch" ? "P" : stage.id === "inn1" ? "1" : "2"}
          </span>
        );
      })}
    </div>
  );
}

export function GameRow({
  game,
  nowMs,
  href,
  ledgerEntries = [],
}: {
  game: NestGame;
  nowMs: number;
  href: string;
  ledgerEntries?: NestLedgerEntry[];
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

  const bestPick = ledgerEntries.find((e) => e.action === "bet" && e.pickLabel);

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
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <MiniStageDots entries={ledgerEntries} />
          {bestPick ? (
            <span className="max-w-[14rem] truncate text-[11px] text-muted-foreground sm:max-w-xs">
              {bestPick.pickLabel} @ {bestPick.decimalOdds?.toFixed(2)}
            </span>
          ) : null}
        </div>
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

export function groupByTrack(entries: NestLedgerEntry[]): Record<F5OddsStage, NestLedgerEntry | undefined> {
  return {
    prematch: entries.find((e) => e.track === "prematch"),
    inn1: entries.find((e) => e.track === "inn1"),
    inn2: entries.find((e) => e.track === "inn2"),
  };
}
