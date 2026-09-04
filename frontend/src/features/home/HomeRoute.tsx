"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/button";
import { NoticeError, NoticeLoading } from "@/components/ui/feedback";
import { GameRow } from "@/features/home/GameRow";
import { useLivePoll } from "@/hooks/useLivePoll";
import { loadGamesByDate, syncGamesForDate } from "@/lib/api";
import { copy } from "@/lib/copy";
import { groupGamesByStage, isDisplayableGame } from "@/lib/board";
import { gameUrl, slateDate } from "@/lib/routes";
import type { NestGame } from "@/types";

const LIVE_POLL_MS = 10_000;

function BoardSection({
  title,
  games,
  nowMs,
}: {
  title: string;
  games: NestGame[];
  nowMs: number;
}) {
  if (!games.length) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border/80">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-2 sm:px-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{games.length}</span>
      </div>
      <div>
        {games.map((game) => (
          <GameRow game={game} href={gameUrl(game.id)} key={game.id} nowMs={nowMs} />
        ))}
      </div>
    </section>
  );
}

function formatClock(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function HomeRoute({ date }: { date?: string } = {}) {
  const boardDate = date ?? slateDate();
  const [games, setGames] = useState<NestGame[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setError(null);
    const slate = await loadGamesByDate(boardDate);
    setGames(slate.games);
    setGeneratedAt(new Date().toISOString());
  }, [boardDate]);

  useEffect(() => {
    setLoading(true);
    loadBoard()
      .catch((err) => setError(err instanceof Error ? err.message : copy.home.loadFailed))
      .finally(() => setLoading(false));
  }, [loadBoard]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const hasLive = games.some((g) => g.status === "LIVE");
  useLivePoll(hasLive, loadBoard, LIVE_POLL_MS);

  async function runRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.home.loadFailed);
    } finally {
      setRefreshing(false);
    }
  }

  async function runSync() {
    setSyncing(true);
    setError(null);
    try {
      await syncGamesForDate(boardDate);
      await loadBoard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось синхронизировать слайт");
    } finally {
      setSyncing(false);
    }
  }

  const displayable = games.filter(isDisplayableGame);
  const { live, upcoming, final } = groupGamesByStage(displayable, nowMs);
  const updatedClock = formatClock(generatedAt);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{copy.home.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {displayable.length} матчей · {boardDate}
            {updatedClock ? ` · обновлено ${updatedClock}` : ""}
            {hasLive ? " · auto 10с" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button className="h-9" disabled={syncing} onClick={() => void runSync()} size="sm" variant="outline">
            {syncing ? "Синхр…" : "Синхронизировать слайт"}
          </Button>
          <Button className="h-9" disabled={refreshing} onClick={() => void runRefresh()} size="sm" variant="outline">
            {refreshing ? copy.home.refreshing : copy.home.refresh}
          </Button>
        </div>
      </div>

      {error && <NoticeError>{error}</NoticeError>}
      {loading && <NoticeLoading>{copy.common.loading}</NoticeLoading>}

      {!loading && displayable.length ? (
        <div className="grid gap-3">
          <BoardSection games={live} nowMs={nowMs} title="Live" />
          <BoardSection games={upcoming} nowMs={nowMs} title="Ожидаются" />
          <BoardSection games={final} nowMs={nowMs} title="Завершены" />
        </div>
      ) : !loading ? (
        <EmptyState description={copy.home.empty} title={copy.home.title} />
      ) : null}
    </div>
  );
}
