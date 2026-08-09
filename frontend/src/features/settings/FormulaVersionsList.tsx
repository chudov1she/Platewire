"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { StatPill } from "@/components/feedback/StatusBadge";
import { backtestFormula, loadFormulaVersion } from "@/lib/api";
import { copy } from "@/lib/copy";
import type { FormulaBacktestResult } from "@/lib/api";
import type { FormulaSpec, FormulaVersionDetail, FormulaVersionListItem } from "@/types";

export function FormulaVersionsList({
  versions,
  isAdmin,
  activatingId,
  pendingActivate,
  onRequestActivate,
  onConfirmActivate,
  onCancelActivate,
  onLoadIntoEditor,
}: {
  versions: FormulaVersionListItem[];
  isAdmin: boolean;
  activatingId: string | null;
  pendingActivate: boolean;
  onRequestActivate: (id: string) => void;
  onConfirmActivate: () => void | Promise<void>;
  onCancelActivate: () => void;
  onLoadIntoEditor?: (spec: FormulaSpec, meta: { versionLabel: string; id: string }) => void;
}) {
  const target = versions.find((v) => v.id === activatingId) ?? null;
  const [detail, setDetail] = useState<FormulaVersionDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<FormulaBacktestResult | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setBacktest(null);
    setBacktestError(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const row = await loadFormulaVersion(id);
      setDetail(row);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : copy.settings.loadFailed);
    } finally {
      setDetailLoading(false);
    }
  }

  async function runBacktest() {
    if (!detail) return;
    setBacktestBusy(true);
    setBacktestError(null);
    try {
      const result = await backtestFormula({ versionId: detail.id, days: 14 });
      setBacktest(result);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : copy.settings.testFailed);
    } finally {
      setBacktestBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {copy.settings.versions} ({versions.length})
      </p>
      <div className="grid gap-1">
        {versions.map((v) => (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
            key={v.id}
          >
            <button
              className="min-w-0 flex-1 text-left hover:opacity-90"
              onClick={() => void openDetail(v.id)}
              type="button"
            >
              <span className="font-mono text-xs sm:text-sm">{v.versionLabel}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {v.createdBy} · {new Date(v.createdAt).toLocaleString("ru-RU")}
              </span>
              {v.notes ? <span className="ml-2 text-xs text-muted-foreground">{v.notes}</span> : null}
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                onClick={() => void openDetail(v.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {copy.settings.openVersion}
              </Button>
              {v.isProduction ? (
                <Badge variant="outline">production</Badge>
              ) : isAdmin ? (
                <Button
                  onClick={() => onRequestActivate(v.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {copy.settings.activate}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <ConfirmApplyDialog
        confirmLabel={copy.settings.activate}
        description={
          target ? (
            <>
              Production будет переключён на версию{" "}
              <span className="font-mono text-foreground">{target.versionLabel}</span>. Текущая
              production-версия перестанет быть активной.
            </>
          ) : (
            "Выберите версию."
          )
        }
        onConfirm={onConfirmActivate}
        onOpenChange={(open) => {
          if (!open) onCancelActivate();
        }}
        open={Boolean(activatingId)}
        pending={pendingActivate}
        title={copy.settings.confirmActivateTitle}
      />

      <Dialog
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setDetail(null);
            setBacktest(null);
            setBacktestError(null);
            setDetailError(null);
          }
        }}
        open={detailOpen}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{copy.settings.versionDetailTitle}</DialogTitle>
            <DialogDescription>
              {detail ? (
                <>
                  <span className="font-mono">{detail.versionLabel}</span>
                  {detail.isProduction ? " · production" : ""}
                </>
              ) : (
                "…"
              )}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? <p className="text-sm text-muted-foreground">{copy.common.loading}</p> : null}
          {detailError ? <p className="text-sm text-destructive">{detailError}</p> : null}

          {detail ? (
            <div className="grid gap-3">
              <pre className="max-h-[40vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
                {JSON.stringify(detail.spec, null, 2)}
              </pre>

              <div className="flex flex-wrap gap-2">
                {onLoadIntoEditor ? (
                  <Button
                    onClick={() => {
                      onLoadIntoEditor(detail.spec, {
                        versionLabel: detail.versionLabel,
                        id: detail.id,
                      });
                      setDetailOpen(false);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {copy.settings.loadVersion}
                  </Button>
                ) : null}
                {isAdmin ? (
                  <Button
                    disabled={backtestBusy}
                    onClick={() => void runBacktest()}
                    size="sm"
                    type="button"
                  >
                    {backtestBusy ? copy.settings.testRunning : copy.settings.testOnLedger}
                  </Button>
                ) : null}
                {!detail.isProduction && isAdmin ? (
                  <Button
                    onClick={() => {
                      setDetailOpen(false);
                      onRequestActivate(detail.id);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {copy.settings.activate}
                  </Button>
                ) : null}
              </div>

              {backtestError ? <p className="text-sm text-destructive">{backtestError}</p> : null}
              {backtest ? (
                <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    vs {backtest.baselineVersionLabel} · sample {backtest.sample}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <StatPill label="ROI now" value={`${backtest.baseline.roiPct.toFixed(1)}%`} />
                    <StatPill label="ROI version" value={`${backtest.proposed.roiPct.toFixed(1)}%`} />
                    <StatPill label="Profit now" value={`${backtest.baseline.profit.toFixed(1)} u`} />
                    <StatPill label="Profit version" value={`${backtest.proposed.profit.toFixed(1)} u`} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
