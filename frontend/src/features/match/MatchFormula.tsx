"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { evalFormula } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { F5OddsStage, NestFormulaEval, NestLedgerEntry } from "@/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 text-center">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function MatchFormula({
  gameId,
  track,
  ledgerEntry = null,
}: {
  gameId: string;
  track: F5OddsStage;
  ledgerEntry?: NestLedgerEntry | null;
}) {
  const [result, setResult] = useState<NestFormulaEval | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await evalFormula(gameId, { track });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось просчитать формулу");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load for current track — if a bet already exists, the model was already
  // run at capture time; show a live eval without forcing a manual click.
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setLoading(true);
    void evalFormula(gameId, { track })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось просчитать формулу");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, track]);

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const hasDecision = Boolean(ledgerEntry);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold sm:text-lg">Формула (Monte Carlo λ)</CardTitle>
        <Button disabled={loading} onClick={() => void run()} size="sm" type="button" variant="outline">
          {loading ? "…" : result || hasDecision ? "Пересчитать" : "Просчитать"}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {hasDecision ? (
          <p className="rounded-md border border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Этап {track} уже в журнале
            {ledgerEntry!.action === "bet" && ledgerEntry!.pickLabel
              ? `: ${ledgerEntry!.pickLabel}${ledgerEntry!.decimalOdds != null ? ` @ ${ledgerEntry!.decimalOdds.toFixed(2)}` : ""} · ${ledgerEntry!.confidenceTier ?? "—"} · ${ledgerEntry!.stakeUnits ?? "—"}u`
              : ledgerEntry!.action === "pass"
                ? ": pass"
                : ""}
            . Ниже — актуальный пересчёт модели (не обязательно совпадает 1:1 с моментом захвата).
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {loading && !result ? <p className="text-sm text-muted-foreground">Считаем модель для {track}…</p> : null}
        {!loading && !result && !error ? (
          <p className="text-sm text-muted-foreground">Нет оценки модели для этапа {track}.</p>
        ) : null}

        {result ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">версия {result.versionLabel}</Badge>
              <Badge variant="outline">{result.simulation_mode}</Badge>
              {result.marketsUsed ? <Badge variant="outline">рынки учтены</Badge> : <Badge variant="secondary">только модель</Badge>}
              {result.locked ? <Badge variant="outline">locked</Badge> : null}
              <Badge variant={result.readiness.ready ? "outline" : "secondary"} className={cn(result.readiness.ready && "border-emerald-500/40 text-emerald-400")}>
                readiness {result.readiness.score}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="λ away" value={result.lambda_away.toFixed(2)} />
              <Stat label="λ home" value={result.lambda_home.toFixed(2)} />
              <Stat label="E[total]" value={result.expected_total.toFixed(2)} />
              <Stat label="Avg total" value={result.avg_total.toFixed(2)} />
              <Stat label="P(away lead)" value={pct(result.p_away_lead)} />
              <Stat label="P(tie)" value={pct(result.p_tie)} />
              <Stat label="P(home lead)" value={pct(result.p_home_lead)} />
              <Stat label="P(over 4.5)" value={pct(result.p_over_4_5)} />
            </div>

            {result.value_bets.length ? (
              <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {["Рынок", "Сторона", "Линия", "Кэф", "Модель%", "Implied%", "Value%", "ROI%"].map((h) => (
                        <th className="whitespace-nowrap px-2 py-1.5 font-semibold uppercase text-muted-foreground" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.value_bets.map((v, i) => (
                      <tr className="border-t border-border" key={`${v.market}-${v.side}-${i}`}>
                        <td className="px-2 py-1.5">{v.market}</td>
                        <td className="px-2 py-1.5">{v.side}</td>
                        <td className="px-2 py-1.5">{v.line ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{v.decimal_odds.toFixed(2)}</td>
                        <td className="px-2 py-1.5 font-mono">{v.model_prob.toFixed(1)}</td>
                        <td className="px-2 py-1.5 font-mono">{v.implied_pct.toFixed(1)}</td>
                        <td className={cn("px-2 py-1.5 font-mono", v.value_pct > 0 ? "text-emerald-400" : "text-destructive")}>{v.value_pct.toFixed(1)}</td>
                        <td className={cn("px-2 py-1.5 font-mono", v.roi_pct > 0 ? "text-emerald-400" : "text-destructive")}>{v.roi_pct.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Нет value-ставок выше порога.</p>
            )}

            {result.signals.length ? (
              <p className="text-xs text-emerald-400">
                Сигналы (для журнала): {result.signals.map((s) => `${s.market}/${s.side}`).join(", ")}
              </p>
            ) : null}

            {result.notes.length ? (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}

            <div>
              <button className="text-xs text-primary underline" onClick={() => setShowRaw((v) => !v)} type="button">
                {showRaw ? "Скрыть" : "Показать"} input_sources / breakdown
              </button>
              {showRaw ? (
                <div className="mt-2 grid gap-2">
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40">
                        <tr>
                          {["Параметр", "Значение", "Источник", "Ready"].map((h) => (
                            <th className="px-2 py-1.5 font-semibold uppercase text-muted-foreground" key={h}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.input_sources).map(([key, src]) => (
                          <tr className="border-t border-border" key={key}>
                            <td className="px-2 py-1.5 font-mono">{key}</td>
                            <td className="px-2 py-1.5 font-mono">{String(src.value ?? "—")}</td>
                            <td className="px-2 py-1.5">{src.source}</td>
                            <td className="px-2 py-1.5">{src.ready === false ? "нет" : "да"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[11px]">
                    {JSON.stringify(result.breakdown, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
