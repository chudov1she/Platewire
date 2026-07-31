"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/EmptyState";
import { StatusBadge, StatusPill } from "@/components/feedback/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { NoticeError, NoticeLoading } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LEDGER_TRACKS } from "@/constants/ledger";
import { loadLedger, loadLedgerEquity, loadLedgerStats, patchLedgerEntry } from "@/lib/api";
import { copy } from "@/lib/copy";
import { exportLedgerAllTracksXlsx, exportLedgerTrackXlsx } from "@/lib/ledger-export";
import { gameUrl } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { F5OddsStage, NestLedgerEntry, NestLedgerEquity, NestLedgerStats } from "@/types";

function CountedSwitch({
  row,
  pending,
  onToggle,
}: {
  row: NestLedgerEntry;
  pending: boolean;
  onToggle: (id: string, excludedFromStats: boolean) => void;
}) {
  const counted = !row.excludedFromStats;
  return (
    <div className="flex items-center gap-2">
      <Switch
        aria-label={counted ? copy.ledger.excludeFromStats : copy.ledger.includeInStats}
        checked={counted}
        disabled={pending}
        onCheckedChange={(next) => onToggle(row.id, !next)}
        size="sm"
        title={counted ? copy.ledger.excludeFromStats : copy.ledger.includeInStats}
      />
      <span className="text-[11px] text-muted-foreground">{copy.ledger.counted}</span>
    </div>
  );
}

function LedgerTiles({
  entries,
  startingBankroll,
  pendingId,
  onToggle,
}: {
  entries: NestLedgerEntry[];
  startingBankroll: number;
  pendingId: string | null;
  onToggle: (id: string, excludedFromStats: boolean) => void;
}) {
  const chronological = useMemo(() => [...entries].reverse(), [entries]);

  const tiles = useMemo(() => {
    let runningBank = startingBankroll;
    return chronological.map((row, index) => {
      const excluded = row.excludedFromStats;
      const profit = excluded ? null : (row.profitUnits ?? null);
      if (profit !== null) runningBank += profit;
      return {
        index: index + 1,
        row,
        profit,
        bank: profit !== null ? runningBank : null,
      };
    });
  }, [chronological, startingBankroll]);

  return (
    <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {tiles.map(({ index, row, profit, bank }) => (
        <article
          className={cn(
            "rounded-xl border border-border bg-muted/25 p-3 text-sm",
            row.excludedFromStats && "opacity-55",
          )}
          key={row.id}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                #{index} · {row.gameDateUtc?.slice(0, 10) ?? row.capturedAt.slice(0, 10)} · {row.track}
              </p>
              <Link
                className="mt-0.5 block font-semibold leading-snug text-foreground underline underline-offset-2"
                href={gameUrl(row.gameId)}
              >
                {row.matchup}
              </Link>
            </div>
            <CountedSwitch onToggle={onToggle} pending={pendingId === row.id} row={row} />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/80 bg-background/50 px-2.5 py-2">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Ставка
              </span>
              <strong className="text-sm text-foreground">
                {row.action === "pass"
                  ? "pass"
                  : (row.pickLabel ?? `${row.pickMarket}/${row.pickSide}`)}
              </strong>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-primary">
                @{row.decimalOdds?.toFixed(2) ?? "—"}
                {row.stakeUnits != null ? ` · ${row.stakeUnits}u` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-border/80 bg-background/50 px-2.5 py-2">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Исход
              </span>
              <StatusBadge status={row.resultStatus} />
              <p
                className={cn(
                  "mt-0.5 font-mono text-xs tabular-nums",
                  profit !== null && profit >= 0 ? "text-emerald-400" : "text-destructive",
                )}
              >
                {profit !== null ? `${profit >= 0 ? "+" : ""}${profit.toFixed(1)} u` : "—"}
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {bank !== null ? <span>Банк {bank.toFixed(0)}</span> : null}
            {row.f5AwayRuns != null && row.f5HomeRuns != null ? (
              <span>
                F5 {row.f5AwayRuns}-{row.f5HomeRuns}
              </span>
            ) : null}
            {row.confidenceTier ? <span>{row.confidenceTier}</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function LedgerRoute() {
  const [track, setTrack] = useState<F5OddsStage | "all">("all");
  const [entries, setEntries] = useState<NestLedgerEntry[]>([]);
  const [stats, setStats] = useState<NestLedgerStats | null>(null);
  const [equity, setEquity] = useState<NestLedgerEquity | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const startingBankroll = stats?.startingBankroll ?? 1000;

  const reload = useCallback(async () => {
    const [rows, s, eq] = await Promise.all([
      loadLedger({ track: track === "all" ? undefined : track, limit: 200 }),
      loadLedgerStats(days),
      loadLedgerEquity(2000),
    ]);
    setEntries(rows);
    setStats(s);
    setEquity(eq);
  }, [track, days]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : copy.ledger.loadFailed))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function onToggleExclude(id: string, excludedFromStats: boolean) {
    setPendingId(id);
    setEntries((prev) =>
      prev.map((row) => (row.id === id ? { ...row, excludedFromStats } : row)),
    );
    try {
      await patchLedgerEntry(id, excludedFromStats);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить учёт");
      await reload().catch(() => undefined);
    } finally {
      setPendingId(null);
    }
  }

  function onExportCurrent() {
    if (!entries.length) return;
    setExporting(true);
    try {
      exportLedgerTrackXlsx(track, entries, startingBankroll);
    } finally {
      setExporting(false);
    }
  }

  async function onExportAll() {
    setExporting(true);
    setError(null);
    try {
      const responses = await Promise.all(
        LEDGER_TRACKS.map((item) => loadLedger({ track: item.id, limit: 200 })),
      );
      const byTrack: Partial<Record<F5OddsStage, NestLedgerEntry[]>> = {};
      for (const [index, item] of LEDGER_TRACKS.entries()) {
        const rows = responses[index] ?? [];
        if (!rows.length) continue;
        byTrack[item.id] = rows;
      }
      exportLedgerAllTracksXlsx(byTrack, startingBankroll);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выгрузить Excel");
    } finally {
      setExporting(false);
    }
  }

  const trackLabel =
    track === "all" ? "Все" : (LEDGER_TRACKS.find((item) => item.id === track)?.label ?? track);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{copy.ledger.title}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            Фиксированная ставка 50u · банк {startingBankroll}.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            <span>Окно статистики (дней)</span>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              onChange={(e) => setDays(Number(e.target.value))}
              value={days}
            >
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={exporting || loading || !entries.length}
            onClick={onExportCurrent}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.ledger.exportExcel}
          </Button>
          <Button
            disabled={exporting || loading}
            onClick={() => void onExportAll()}
            size="sm"
            type="button"
            variant="outline"
          >
            {exporting ? "Готовлю…" : copy.ledger.exportAll}
          </Button>
        </div>
      </div>

      <Tabs className="gap-2" onValueChange={(next) => setTrack(next as F5OddsStage | "all")} value={track}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1">
          <TabsTrigger className="px-3 py-1.5 text-xs sm:text-sm" value="all">
            Все
          </TabsTrigger>
          {LEDGER_TRACKS.map((item) => (
            <TabsTrigger className="px-3 py-1.5 text-xs sm:text-sm" key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && <NoticeError>{error}</NoticeError>}
      {loading && <NoticeLoading>{copy.common.loading}</NoticeLoading>}

      {!loading && stats ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <StatusPill label="Ставок" value={String(stats.total)} />
          <StatusPill label="Pass" value={String(stats.passed)} />
          <StatusPill label="WIN / LOSE / PUSH" value={`${stats.wins} / ${stats.losses} / ${stats.pushes}`} />
          <StatusPill label="Pending" value={String(stats.pending)} />
          <StatusPill label="Winrate" value={stats.winrate != null ? `${(stats.winrate * 100).toFixed(1)}%` : "—"} />
          <StatusPill label="Профит" value={`${stats.profitUnits.toFixed(1)}u`} />
          <StatusPill label="ROI" value={`${stats.roiPct.toFixed(1)}%`} />
          <StatusPill label="Банк" value={`${(stats.startingBankroll + stats.profitUnits).toFixed(0)}`} />
        </div>
      ) : null}

      {!loading && stats ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-sm">По треку</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {Object.entries(stats.byTrack).map(([t, v]) => (
                <div className="flex justify-between" key={t}>
                  <span className="text-muted-foreground">{t}</span>
                  <span className="font-mono">
                    {v.n} ставок · {v.profit.toFixed(1)}u
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-sm">По уверенности</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {Object.entries(stats.byConfidence).map(([t, v]) => (
                <div className="flex justify-between" key={t}>
                  <span className="text-muted-foreground">{t}</span>
                  <span className="font-mono">
                    {v.n} ставок · {v.profit.toFixed(1)}u
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!loading && equity?.points.length ? (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Кривая банка</CardTitle>
            <CardDescription>
              {equity.points.length} ставок · старт {equity.startingBankroll}
              {equity.points.length
                ? ` · сейчас ${equity.points[equity.points.length - 1]?.bank.toFixed(0)}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <EquityChart equity={equity} />
          </CardContent>
        </Card>
      ) : null}

      {!loading && stats?.worstLosses.length ? (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Худшие проигрыши</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {stats.worstLosses.map((l, i) => (
              <div className="flex justify-between" key={i}>
                <Link className="text-primary underline" href={gameUrl(l.gameId)}>
                  {l.pickMarket}/{l.pickSide} · {l.track}
                </Link>
                <span className="font-mono text-destructive">{l.profitUnits?.toFixed(1)}u</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!loading && (
        <Card className="ui-card overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base font-semibold text-foreground sm:text-lg">
              {trackLabel} · {entries.length} записей
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {entries.length ? (
              <LedgerTiles
                entries={entries}
                onToggle={onToggleExclude}
                pendingId={pendingId}
                startingBankroll={startingBankroll}
              />
            ) : (
              <EmptyState
                action={
                  <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/">
                    {copy.nav.home}
                  </Link>
                }
                className="m-4 border-0 bg-transparent"
                description={copy.ledger.empty}
                title="Записей пока нет"
              />
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

const equityChartConfig = {
  bank: {
    label: "Банк",
    color: "#34d399",
  },
} satisfies ChartConfig;

function EquityChart({ equity }: { equity: NestLedgerEquity }) {
  const data = useMemo(() => {
    return [
      {
        n: 0,
        label: "0",
        bank: equity.startingBankroll,
        matchup: "Старт",
        track: "",
        pickLabel: "",
        profitUnits: 0,
        resultStatus: "",
        settledAt: null as string | null,
      },
      ...equity.points.map((p) => ({
        n: p.n,
        label: String(p.n),
        bank: p.bank,
        matchup: p.matchup,
        track: p.track,
        pickLabel: p.pickLabel ?? "",
        profitUnits: p.profitUnits,
        resultStatus: p.resultStatus,
        settledAt: p.settledAt,
      })),
    ];
  }, [equity]);

  if (data.length < 2) return null;

  return (
    <ChartContainer className="aspect-auto h-[240px] w-full" config={equityChartConfig}>
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillEquityBank" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-bank)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-bank)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" minTickGap={16} tickLine={false} tickMargin={8} />
        <YAxis
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(v) => `${Math.round(Number(v))}`}
          tickLine={false}
          tickMargin={8}
          width={44}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as
                  | {
                      n: number;
                      matchup: string;
                      track: string;
                      pickLabel: string;
                      settledAt: string | null;
                    }
                  | undefined;
                if (!row) return null;
                if (row.n === 0) return "Старт";
                const when = row.settledAt
                  ? new Date(row.settledAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                return `#${row.n} · ${row.matchup}${row.track ? ` · ${row.track}` : ""}${
                  row.pickLabel ? ` · ${row.pickLabel}` : ""
                }${when ? ` · ${when}` : ""}`;
              }}
              formatter={(value, _name, item) => {
                const profit = Number(item?.payload?.profitUnits ?? 0);
                const profitLabel =
                  item?.payload?.n === 0
                    ? null
                    : `${profit >= 0 ? "+" : ""}${profit.toFixed(1)}u`;
                return (
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">Банк</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {Number(value).toFixed(1)}
                      {profitLabel ? (
                        <span className="ml-2 text-muted-foreground">({profitLabel})</span>
                      ) : null}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Area
          activeDot={{ r: 5 }}
          dataKey="bank"
          dot={{ r: 3, fill: "var(--color-bank)", strokeWidth: 0 }}
          fill="url(#fillEquityBank)"
          stroke="var(--color-bank)"
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}
