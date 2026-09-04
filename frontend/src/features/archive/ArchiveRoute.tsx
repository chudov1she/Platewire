"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EmptyState } from "@/components/feedback/EmptyState";
import { NoticeError, NoticeLoading } from "@/components/ui/feedback";
import { GameRow } from "@/features/home/GameRow";
import { loadGamesByDate } from "@/lib/api";
import { copy } from "@/lib/copy";
import { isDisplayableGame } from "@/lib/board";
import { archiveUrl, defaultArchiveDate, gameUrl, slateDate } from "@/lib/routes";
import type { NestGame } from "@/types";

function ArchivePage({
  archiveDate,
  games,
  nowMs,
  onArchiveDateChange,
}: {
  archiveDate: string;
  games: NestGame[];
  nowMs: number;
  onArchiveDateChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{copy.archive.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {games.length} матчей · {archiveDate}
          </p>
        </div>
        <label className="grid min-w-[10rem] gap-1">
          <span className="text-[11px] text-muted-foreground">Дата (NY slate)</span>
          <input
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground/40"
            max={slateDate()}
            onChange={(event) => onArchiveDateChange(event.target.value)}
            type="date"
            value={archiveDate}
          />
        </label>
      </div>

      {games.length ? (
        <section className="overflow-hidden rounded-lg border border-border/80">
          {games.map((game) => (
            <GameRow game={game} href={gameUrl(game.id)} key={game.id} nowMs={nowMs} />
          ))}
        </section>
      ) : (
        <EmptyState description={copy.archive.empty} title={copy.archive.title} />
      )}
    </div>
  );
}

export function ArchiveRoute({ date: dateProp }: { date?: string } = {}) {
  const params = useParams<{ date: string }>();
  const date = dateProp ?? params.date ?? defaultArchiveDate();
  const router = useRouter();
  const [games, setGames] = useState<NestGame[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadGamesByDate(date)
      .then((slate) => {
        setGames(slate.games.filter(isDisplayableGame));
      })
      .catch((err) => setError(err instanceof Error ? err.message : copy.archive.loadFailed))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      {error && <NoticeError className="mb-4">{error}</NoticeError>}
      {loading && <NoticeLoading className="mb-4">{copy.common.loading}</NoticeLoading>}
      {!loading && (
        <ArchivePage
          archiveDate={date}
          games={games}
          nowMs={nowMs}
          onArchiveDateChange={(value) => router.push(archiveUrl(value))}
        />
      )}
    </>
  );
}
