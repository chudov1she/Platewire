"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/page-loader";
import { loadGameContext, refreshGameContext } from "@/lib/api";
import { officialUrl, playerUrl } from "@/lib/routes";
import type { NestContextLineupRow, NestContextStarter, NestGameContext } from "@/types";

function StatChip({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 rounded border border-border/60 bg-background/50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </span>
  );
}

function FeatureChips({ feature }: { feature: NestContextLineupRow["feature"] }) {
  if (!feature) return <span className="text-xs text-muted-foreground">нет данных</span>;
  if (feature.role === "pitcher") {
    return (
      <div className="flex flex-wrap gap-1">
        <StatChip label="ERA" value={feature.season_era} />
        <StatChip label="WHIP" value={feature.season_whip} />
        <StatChip label="L5" value={feature.l5_era} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      <StatChip label="OPS" value={feature.season_ops} />
      <StatChip label="L5" value={feature.l5_ops} />
      <StatChip label="L10" value={feature.l10_ops} />
    </div>
  );
}

function LineupList({ side, rows }: { side: string; rows: NestContextLineupRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Состав {side} пока не объявлен.</p>;

  return (
    <>
      {/* Mobile: stacked player cards */}
      <ul className="grid gap-2 md:hidden">
        {rows.map((row) => (
          <li className="rounded-lg border border-border bg-muted/15 px-3 py-2" key={`${row.batting_order}-${row.mlb_player_id}`}>
            <div className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{row.batting_order}</span>
              {row.mlb_player_id ? (
                <Link className="min-w-0 truncate font-semibold text-primary underline" href={playerUrl(row.mlb_player_id)}>
                  {row.full_name ?? row.mlb_player_id}
                </Link>
              ) : (
                <span className="min-w-0 truncate font-semibold">{row.full_name ?? "—"}</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <StatChip label="xwOBA" value={row.xwoba} />
              <StatChip label="xSLG" value={row.xslg} />
              <StatChip label="xBA" value={row.xba} />
              <StatChip label="Barrel%" value={row.barrel_batted_rate} />
              <StatChip label="HardHit%" value={row.hard_hit_percent} />
            </div>
            <div className="mt-1.5">
              <FeatureChips feature={row.feature} />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: table with horizontal scroll fallback */}
      <div className="hidden min-w-0 overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full min-w-[44rem] text-left text-xs">
          <thead className="bg-muted/40">
            <tr>
              {["#", "Игрок", "xwOBA", "xSLG", "xBA", "Barrel%", "HardHit%", "Season/L5/L10"].map((h) => (
                <th className="whitespace-nowrap px-2 py-1.5 font-semibold uppercase text-muted-foreground" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-border" key={`${row.batting_order}-${row.mlb_player_id}`}>
                <td className="px-2 py-1.5">{row.batting_order}</td>
                <td className="max-w-[10rem] truncate px-2 py-1.5">
                  {row.mlb_player_id ? (
                    <Link className="text-primary underline" href={playerUrl(row.mlb_player_id)}>
                      {row.full_name ?? row.mlb_player_id}
                    </Link>
                  ) : (
                    row.full_name ?? "—"
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono">{row.xwoba ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{row.xslg ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{row.xba ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{row.barrel_batted_rate ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono">{row.hard_hit_percent ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <FeatureChips feature={row.feature} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StarterCard({ label, starter }: { label: string; starter: NestContextStarter }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label} SP</p>
      {starter ? (
        <>
          <p className="mt-1 truncate font-semibold">
            {starter.mlb_player_id ? (
              <Link className="text-primary underline" href={playerUrl(starter.mlb_player_id)}>
                {starter.full_name ?? starter.mlb_player_id}
              </Link>
            ) : (
              starter.full_name ?? "TBD"
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <StatChip label="ERA" value={starter.savant.era} />
            <StatChip label="WHIP" value={starter.savant.whip} />
            <StatChip label="xwOBA" value={starter.savant.xwoba} />
            <StatChip label="GS" value={starter.savant.games_started} />
            <StatChip label="FF" value={starter.savant.ff_avg_speed != null ? `${starter.savant.ff_avg_speed} mph` : null} />
          </div>
          {starter.feature ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <StatChip label="season ERA" value={starter.feature.season_era} />
              <StatChip label="L5" value={starter.feature.l5_era} />
              <StatChip label="L10" value={starter.feature.l10_era} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">TBD</p>
      )}
    </div>
  );
}

export function MatchContext({ gameId }: { gameId: string }) {
  const [ctx, setCtx] = useState<NestGameContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadGameContext(gameId)
      .then((c) => !cancelled && setCtx(c))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Не удалось загрузить составы"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const c = await refreshGameContext(gameId);
      setCtx(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить составы");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <InlineLoader label="Составы" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!ctx) return null;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-2 text-xs">
          <Badge variant={ctx.has_lineup ? "outline" : "secondary"}>{ctx.has_lineup ? "составы объявлены" : "составы не объявлены"}</Badge>
          <Badge variant={ctx.has_probable ? "outline" : "secondary"}>{ctx.has_probable ? "старты SP известны" : "SP не известны"}</Badge>
        </div>
        <Button className="shrink-0" disabled={refreshing} onClick={() => void onRefresh()} size="sm" type="button" variant="outline">
          {refreshing ? "…" : "Синхронизировать"}
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <StarterCard label="Away" starter={ctx.away.starter} />
        <StarterCard label="Home" starter={ctx.home.starter} />
      </div>

      <div className="grid min-w-0 gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Away lineup</p>
          <LineupList rows={ctx.away.lineup} side="away" />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Home lineup</p>
          <LineupList rows={ctx.home.lineup} side="home" />
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Судьи</p>
        {ctx.home_plate_umpire ? (
          <div className="mt-2 grid gap-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Home plate · </span>
              <Link className="font-semibold text-primary underline" href={officialUrl(ctx.home_plate_umpire.mlb_official_id)}>
                {ctx.home_plate_umpire.full_name}
              </Link>
            </p>
            {ctx.home_plate_umpire.feature ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Called strike%</p>
                  <p className="font-mono text-sm">
                    {ctx.home_plate_umpire.feature.called_strike_rate != null
                      ? `${(ctx.home_plate_umpire.feature.called_strike_rate * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-muted-foreground">Called ball%</p>
                  <p className="font-mono text-sm">
                    {ctx.home_plate_umpire.feature.called_ball_rate != null
                      ? `${(ctx.home_plate_umpire.feature.called_ball_rate * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-muted-foreground">K rate%</p>
                  <p className="font-mono text-sm">
                    {ctx.home_plate_umpire.feature.k_rate != null
                      ? `${(ctx.home_plate_umpire.feature.k_rate * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
                <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                  <p className="text-[10px] uppercase text-muted-foreground">BB rate%</p>
                  <p className="font-mono text-sm">
                    {ctx.home_plate_umpire.feature.bb_rate != null
                      ? `${(ctx.home_plate_umpire.feature.bb_rate * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Профиль HP ещё не собран — нажмите «Синхронизировать».</p>
            )}
            {ctx.home_plate_umpire.feature?.scorecard ? (
              <div className="grid gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  UmpScorecards
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                    <p className="text-[10px] uppercase text-muted-foreground">Accuracy</p>
                    <p className="font-mono text-sm">
                      {ctx.home_plate_umpire.feature.scorecard.overall_accuracy != null
                        ? `${ctx.home_plate_umpire.feature.scorecard.overall_accuracy.toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                    <p className="text-[10px] uppercase text-muted-foreground">vs expected</p>
                    <p className="font-mono text-sm">
                      {ctx.home_plate_umpire.feature.scorecard.accuracy_above_x != null
                        ? `${ctx.home_plate_umpire.feature.scorecard.accuracy_above_x >= 0 ? "+" : ""}${ctx.home_plate_umpire.feature.scorecard.accuracy_above_x.toFixed(2)}`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                    <p className="text-[10px] uppercase text-muted-foreground">Consistency</p>
                    <p className="font-mono text-sm">
                      {ctx.home_plate_umpire.feature.scorecard.consistency != null
                        ? `${ctx.home_plate_umpire.feature.scorecard.consistency.toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded border border-border/70 bg-background/40 px-2 py-1.5">
                    <p className="text-[10px] uppercase text-muted-foreground">Run impact</p>
                    <p className="font-mono text-sm">
                      {ctx.home_plate_umpire.feature.scorecard.total_run_impact_mean != null
                        ? ctx.home_plate_umpire.feature.scorecard.total_run_impact_mean.toFixed(2)
                        : "—"}
                    </p>
                  </div>
                </div>
                <a
                  className="text-[11px] text-primary underline"
                  href={ctx.home_plate_umpire.feature.scorecard.profile_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {ctx.home_plate_umpire.feature.scorecard.umpire_name} · n=
                  {ctx.home_plate_umpire.feature.scorecard.games_sample}
                </a>
              </div>
            ) : null}
            {ctx.home_plate_umpire.feature ? (
              <p className="text-[11px] text-muted-foreground">
                {ctx.home_plate_umpire.feature.ready ? "ready" : "not ready"} · sample{" "}
                {ctx.home_plate_umpire.feature.games_sample} · {ctx.home_plate_umpire.feature.source}
                {ctx.home_plate_umpire.feature.games_sample === 0
                  ? " · в базе нет его прошлых FINAL игр за HP (нужен более широкий архив)"
                  : null}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Home plate ещё не назначен / не подтянут.</p>
        )}
        {ctx.officials.length ? (
          <ul className="mt-3 grid gap-1.5 border-t border-border/60 pt-3 text-xs sm:grid-cols-2">
            {ctx.officials.map((o) => (
              <li className="flex min-w-0 items-baseline gap-2" key={`${o.role}-${o.mlb_official_id}`}>
                <span className="w-24 shrink-0 text-muted-foreground">{o.role}</span>
                <Link className="min-w-0 truncate text-primary underline" href={officialUrl(o.mlb_official_id)}>
                  {o.full_name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Состав бригады пуст.</p>
        )}
      </div>
    </div>
  );
}
