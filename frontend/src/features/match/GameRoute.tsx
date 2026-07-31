"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { NoticeError, NoticeLoading } from "@/components/ui/feedback";
import { MatchFormula } from "@/features/match/MatchFormula";
import { MatchInsights } from "@/features/match/MatchInsights";
import { MatchMarkets } from "@/features/match/MatchMarkets";
import { MatchScoreboard } from "@/features/match/MatchScoreboard";
import { useLivePoll } from "@/hooks/useLivePoll";
import { loadGame, loadLedger } from "@/lib/api";
import { copy } from "@/lib/copy";
import { deriveStage } from "@/lib/board";
import type { F5OddsStage, NestGame, NestLedgerEntry } from "@/types";

const LIVE_POLL_MS = 10_000;
const LIVE_FORCE_REFRESH_MS = 30_000;

export function GameRoute({ gameId: gameIdProp }: { gameId?: string } = {}) {
  const params = useParams<{ gameId: string }>();
  const gameId = gameIdProp ?? params.gameId ?? "";
  const [game, setGame] = useState<NestGame | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<NestLedgerEntry[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<F5OddsStage>("prematch");
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  const loadLedgerForGame = useCallback(async (id: string) => {
    const rows = await loadLedger({ limit: 200 });
    setLedgerEntries(rows.filter((r) => r.gameId === id));
  }, []);

  const loadAll = useCallback(
    async (id: string, opts?: { refreshGame?: boolean }) => {
      const [g] = await Promise.all([
        loadGame(id, { refresh: opts?.refreshGame }),
        loadLedgerForGame(id),
      ]);
      setGame(g);
      setLastPolledAt(new Date().toISOString());
      return g;
    },
    [loadLedgerForGame],
  );

  useEffect(() => {
    if (!gameId) {
      setError("Некорректный ID матча");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadAll(gameId)
      .then((g) => {
        if (cancelled) return;
        const completed = g.inning
          ? g.inning_half?.toLowerCase().startsWith("top")
            ? g.inning - 1
            : g.inning
          : 0;
        setTrack(completed >= 2 ? "inn2" : completed >= 1 ? "inn1" : "prematch");
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Матч не найден"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [gameId, loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const isLive = Boolean(game && (game.status === "LIVE" || deriveStage(game, Date.now()) === "live"));

  useLivePoll(
    isLive && Boolean(game?.id),
    () => {
      if (!game?.id) return;
      void loadAll(game.id);
    },
    LIVE_POLL_MS,
  );

  useLivePoll(
    isLive && Boolean(game?.id),
    () => {
      if (!game?.id) return;
      void loadAll(game.id, { refreshGame: true });
    },
    LIVE_FORCE_REFRESH_MS,
  );

  return (
    <>
      {error && <NoticeError className="mb-4">{error}</NoticeError>}
      {loading && <NoticeLoading className="mb-4">{copy.common.loading}</NoticeLoading>}
      {!loading && game ? (
        <section className="grid min-w-0 max-w-full gap-3 sm:gap-4">
          <MatchScoreboard
            game={game}
            lastPolledAt={lastPolledAt}
            nowMs={nowMs}
            onRefresh={() => loadAll(game.id, { refreshGame: true }).then(() => undefined)}
          />
          <MatchMarkets
            game={game}
            ledgerEntries={ledgerEntries}
            onLedgerChanged={() => void loadLedgerForGame(game.id)}
            onTrackChange={setTrack}
            track={track}
          />
          <MatchFormula
            gameId={game.id}
            ledgerEntry={ledgerEntries.find((e) => e.track === track) ?? null}
            track={track}
          />
          <MatchInsights
            gameId={game.id}
            ledgerEntries={ledgerEntries}
            onLedgerChanged={() => void loadLedgerForGame(game.id)}
          />
        </section>
      ) : null}
      {!loading && !game && !error && (
        <Card className="ui-card border-border bg-card p-5 text-sm text-muted-foreground">
          Матч не найден.{" "}
          <Link className="text-primary underline" href="/">
            На главную
          </Link>
        </Card>
      )}
    </>
  );
}
