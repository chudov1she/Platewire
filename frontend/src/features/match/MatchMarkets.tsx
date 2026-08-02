"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineLoader } from "@/components/ui/page-loader";
import { useAuth } from "@/hooks/useAuth";
import { LEDGER_TRACKS } from "@/constants/ledger";
import { ledgerResultLabel } from "@/features/match/ledger-labels";
import { abbr } from "@/features/match/match-format";
import { ApiError, captureLedger, loadGameF5Track, loadReadiness, refreshGameF5 } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { F5OddsStage, NestF5Snapshot, NestGame, NestLedgerEntry, NestReadinessResponse } from "@/types";

function Odds({ value }: { value: number | null | undefined }) {
  return <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{value != null ? value.toFixed(2) : "—"}</span>;
}

function MarketBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-background/40">
      <div className="border-b border-border px-3 py-2">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary sm:text-[11px]">{title}</p>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 text-center">
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function MatchMarkets({
  game,
  track,
  onTrackChange,
  ledgerEntries,
  onLedgerChanged,
}: {
  game: NestGame;
  track: F5OddsStage;
  onTrackChange: (track: F5OddsStage) => void;
  ledgerEntries: NestLedgerEntry[];
  onLedgerChanged?: () => void;
}) {
  const { isAdmin } = useAuth();
  const [snapshot, setSnapshot] = useState<NestF5Snapshot | null>(null);
  const [readiness, setReadiness] = useState<NestReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [snap, rd] = await Promise.all([
        loadGameF5Track(game.id, track).catch((e) => (e instanceof ApiError ? null : Promise.reject(e))),
        loadReadiness(game.id, track).catch(() => null),
      ]);
      setSnapshot(snap);
      setReadiness(rd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить линии");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, track]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const snap = await refreshGameF5(game.id, { stage: track });
      setSnapshot(snap);
      setNotice(snap.ok ? "Линии обновлены" : `Не обновлено: ${snap.skip_reason ?? "нет рынков"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить линии");
    } finally {
      setRefreshing(false);
    }
  }

  async function onCapture(force: boolean) {
    setCapturing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await captureLedger(game.id, track, { force });
      setNotice(res.captured ? `Записано в журнал: ${res.reason}` : `Не записано: ${res.reason}`);
      onLedgerChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось захватить в журнал");
    } finally {
      setCapturing(false);
    }
  }

  const entry = ledgerEntries.find((e) => e.track === track) ?? null;
  const awayAbbr = abbr(game.away_team.abbreviation);
  const homeAbbr = abbr(game.home_team.abbreviation);

  return (
    <Card className="w-full min-w-0 overflow-hidden border-border bg-card text-card-foreground">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold sm:text-lg">Рынки F5 (Winline, автоматически)</CardTitle>
          <div className="flex gap-2">
            <Button disabled={refreshing} onClick={() => void onRefresh()} size="sm" type="button" variant="outline">
              {refreshing ? "…" : "Обновить линии"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/80 bg-muted/30 p-1" role="tablist">
          {LEDGER_TRACKS.map((t) => (
            <button
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
                track === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              key={t.id}
              onClick={() => onTrackChange(t.id)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {loading ? <InlineLoader /> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}

        {readiness ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={readiness.ready ? "outline" : "secondary"} className={cn(readiness.ready && "border-emerald-500/40 text-emerald-400")}>
              {readiness.ready ? `Готов · score ${readiness.score}` : `Не готов · score ${readiness.score}`}
            </Badge>
            {readiness.marketsUsed ? <Badge variant="outline">рынки учтены</Badge> : null}
            {readiness.locked ? <Badge variant="outline">locked</Badge> : null}
            {readiness.hardGaps.map((g) => (
              <Badge key={g} variant="outline" className="border-destructive/40 text-destructive">
                {g}
              </Badge>
            ))}
            {readiness.softGaps.map((g) => (
              <Badge key={g} variant="outline" className="text-amber-400">
                {g}
              </Badge>
            ))}
          </div>
        ) : null}

        {!loading && snapshot ? (
          <>
            <p className="text-xs text-muted-foreground">
              captured {snapshot.captured_at ? new Date(snapshot.captured_at).toLocaleString("ru-RU") : "—"} · stage {snapshot.stage}
              {snapshot.locked ? " · locked" : ""}
              {snapshot.missing.length ? ` · нет: ${snapshot.missing.join(", ")}` : ""}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <MarketBlock title="Исход F5">
                <div className="grid grid-cols-2 gap-3">
                  <Cell label={`П1 · ${awayAbbr}`}>
                    <Odds value={snapshot.moneyline?.away} />
                  </Cell>
                  <Cell label={`П2 · ${homeAbbr}`}>
                    <Odds value={snapshot.moneyline?.home} />
                  </Cell>
                </div>
              </MarketBlock>
              <MarketBlock title="Тотал F5">
                <div className="grid grid-cols-3 gap-3">
                  <Cell label="Меньше">
                    <Odds value={snapshot.main_total?.under} />
                  </Cell>
                  <Cell label={`Линия ${snapshot.main_total?.line ?? "—"}`}>
                    <span className="font-mono text-sm">{snapshot.main_total?.line ?? "—"}</span>
                  </Cell>
                  <Cell label="Больше">
                    <Odds value={snapshot.main_total?.over} />
                  </Cell>
                </div>
                {snapshot.totals.length > 1 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">+{snapshot.totals.length - 1} доп. линий тотала</p>
                ) : null}
              </MarketBlock>
              <MarketBlock title="Фора F5">
                <div className="grid grid-cols-3 gap-3">
                  <Cell label={awayAbbr}>
                    <Odds value={snapshot.main_handicap?.away} />
                  </Cell>
                  <Cell label={`Линия ${snapshot.main_handicap?.line ?? "—"}`}>
                    <span className="font-mono text-sm">{snapshot.main_handicap?.line ?? "—"}</span>
                  </Cell>
                  <Cell label={homeAbbr}>
                    <Odds value={snapshot.main_handicap?.home} />
                  </Cell>
                </div>
              </MarketBlock>
            </div>
          </>
        ) : null}
        {!loading && !snapshot ? <p className="text-sm text-muted-foreground">Нет снимка линий для этого этапа.</p> : null}

        {entry ? (
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Запись в журнале</p>
            {entry.action === "pass" ? (
              <p className="mt-1 text-muted-foreground">
                {entry.captureReason && ["no_odds", "odds_not_locked", "not_ready"].includes(entry.captureReason)
                  ? `Пропуск (${entry.captureReason}) — ${entry.notifyBrief ?? entry.rationale ?? "стадия без ставки."}`
                  : `Pass — модель не увидела ценности. ${entry.rationale ?? ""}`}
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="font-semibold">{entry.pickLabel}</span>
                <span className="font-mono">@{entry.decimalOdds?.toFixed(2)}</span>
                <span>V {entry.valuePct?.toFixed(1)}% · ROI {entry.roiPct?.toFixed(1)}%</span>
                <Badge variant="outline">{ledgerResultLabel(entry.resultStatus)}</Badge>
                {entry.profitUnits != null ? <span className={entry.profitUnits >= 0 ? "text-emerald-400" : "text-destructive"}>{entry.profitUnits >= 0 ? "+" : ""}{entry.profitUnits.toFixed(1)}u</span> : null}
              </div>
            )}
          </div>
        ) : isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={capturing} onClick={() => void onCapture(false)} size="sm" type="button" variant="outline">
              {capturing ? "…" : "Захватить в журнал"}
            </Button>
            <Button disabled={capturing} onClick={() => void onCapture(true)} size="sm" type="button" variant="outline">
              Форсировать захват
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
