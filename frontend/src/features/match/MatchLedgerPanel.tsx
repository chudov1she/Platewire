"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/feedback/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { settleGameLedger } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { NestLedgerEntry } from "@/types";

function EntryCard({ entry }: { entry: NestLedgerEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{entry.track}</Badge>
          <span className="font-semibold">
            {entry.action === "pass"
              ? entry.captureReason && ["no_odds", "odds_not_locked", "not_ready"].includes(entry.captureReason)
                ? `SKIP (${entry.captureReason})`
                : "PASS"
              : entry.pickLabel ?? `${entry.pickMarket}/${entry.pickSide}`}
          </span>
          {entry.decimalOdds != null ? <span className="font-mono text-xs text-muted-foreground">@{entry.decimalOdds.toFixed(2)}</span> : null}
          {entry.confidenceTier ? <Badge variant="secondary">{entry.confidenceTier}</Badge> : null}
        </div>
        <StatusBadge status={entry.resultStatus} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {entry.stakeUnits != null ? <span>Ставка {entry.stakeUnits}u</span> : null}
        {entry.valuePct != null ? <span>Value {entry.valuePct.toFixed(1)}%</span> : null}
        {entry.roiPct != null ? <span>ROI {entry.roiPct.toFixed(1)}%</span> : null}
        {entry.profitUnits != null ? (
          <span className={cn(entry.profitUnits >= 0 ? "text-emerald-400" : "text-destructive")}>
            P/L {entry.profitUnits >= 0 ? "+" : ""}
            {entry.profitUnits.toFixed(1)}u
          </span>
        ) : null}
        {entry.f5HomeRuns != null && entry.f5AwayRuns != null ? (
          <span>
            F5 счёт {entry.f5AwayRuns}-{entry.f5HomeRuns}
          </span>
        ) : null}
        <span>версия {entry.versionLabel}</span>
        <span>захват {new Date(entry.capturedAt).toLocaleString("ru-RU")}</span>
        {entry.settledAt ? <span>settled {new Date(entry.settledAt).toLocaleString("ru-RU")}</span> : null}
      </div>
      {entry.riskFlags.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {entry.riskFlags.map((f) => (
            <Badge className="border-amber-500/40 text-amber-400" key={f} variant="outline">
              {f}
            </Badge>
          ))}
        </div>
      ) : null}
      {(entry.rationale || entry.notifyBrief) ? (
        <div className="mt-1.5">
          <button className="text-xs text-primary underline" onClick={() => setExpanded((v) => !v)} type="button">
            {expanded ? "Скрыть" : "Показать"} rationale
          </button>
          {expanded ? (
            <div className="mt-1 grid gap-1 text-xs text-muted-foreground">
              {entry.notifyBrief ? <p><strong>Brief:</strong> {entry.notifyBrief}</p> : null}
              {entry.rationale ? <p>{entry.rationale}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MatchLedgerPanel({ gameId, entries, onSettled }: { gameId: string; entries: NestLedgerEntry[]; onSettled?: () => void }) {
  const { isAdmin } = useAuth();
  const [settling, setSettling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSettle() {
    setSettling(true);
    setNotice(null);
    try {
      const res = await settleGameLedger(gameId);
      setNotice(`Расчитано: ${res.settled}, пропущено: ${res.skipped}`);
      onSettled?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не удалось рассчитать");
    } finally {
      setSettling(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{entries.length} записей журнала по этому матчу</p>
        {isAdmin ? (
          <Button disabled={settling} onClick={() => void onSettle()} size="sm" type="button" variant="outline">
            {settling ? "…" : "Рассчитать pending"}
          </Button>
        ) : null}
      </div>
      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {entries.length ? (
        <div className="grid gap-2">
          {entries.map((e) => (
            <EntryCard entry={e} key={e.id} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Записей журнала пока нет для этого матча.</p>
      )}
    </div>
  );
}
