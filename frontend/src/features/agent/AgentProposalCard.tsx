"use client";

import { useState } from "react";
import { StatPill } from "@/components/feedback/StatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { formatDateTime } from "@/features/match/match-format";
import { previewAgentProposal } from "@/lib/api";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { AgentProposalPreview, NestAgentProposal } from "@/types";

function proposalBadgeClass(status: string) {
  if (status === "applied") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-400";
  if (status === "rejected") return "border-destructive/40 bg-destructive/15 text-destructive";
  return "border-amber-500/40 bg-amber-500/15 text-amber-300";
}

function MetricsRow({
  label,
  metrics,
}: {
  label: string;
  metrics: { roiPct: number; winrate: number; profit: number; n: number; wins: number; losses: number; pushes: number };
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="ROI" value={`${metrics.roiPct.toFixed(1)}%`} />
        <StatPill label="WR" value={`${(metrics.winrate * 100).toFixed(1)}%`} />
        <StatPill label="Profit" value={`${metrics.profit.toFixed(1)} u`} />
        <StatPill label="Sample" value={`n=${metrics.n} W${metrics.wins}/L${metrics.losses}/P${metrics.pushes}`} />
      </div>
    </div>
  );
}

export function AgentProposalCard({
  proposal,
  isAdmin,
  actionId,
  onApply,
  onReject,
}: {
  proposal: NestAgentProposal;
  isAdmin: boolean;
  actionId: string | null;
  onApply: (id: string) => Promise<void> | void;
  onReject: (id: string) => void;
}) {
  const [patchOpen, setPatchOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<AgentProposalPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [resolvedOpen, setResolvedOpen] = useState(false);

  const base = proposal.baselineMetrics;
  const prop = proposal.proposedMetrics;
  const deltaRoi = (prop?.roiPct ?? 0) - (base?.roiPct ?? 0);
  const deltaProfit = (prop?.profit ?? 0) - (base?.profit ?? 0);
  const pending = proposal.status === "proposed";
  const busy = actionId === proposal.id;
  const blocked = Boolean(preview?.validationErrors.length);

  async function openApplyConfirm() {
    setConfirmOpen(true);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const next = await previewAgentProposal(proposal.id, { days: 14 });
      setPreview(next);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : copy.agent.previewFailed);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmApply() {
    if (preview?.validationErrors.length) return;
    await onApply(proposal.id);
    setConfirmOpen(false);
  }

  return (
    <Card className="border-border/80 bg-card shadow-none">
      <CardHeader className="gap-3 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold leading-snug">{proposal.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{formatDateTime(proposal.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {proposal.baselineStale ? (
              <Badge className="rounded-md uppercase border-amber-500/40 bg-amber-500/15 text-amber-300" variant="outline">
                stale baseline
              </Badge>
            ) : null}
            <Badge className={cn("rounded-md uppercase", proposalBadgeClass(proposal.status))} variant="outline">
              {proposal.status}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4 pt-4">
        <p className="text-sm leading-relaxed text-foreground/90">{proposal.rationale}</p>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatPill label="ROI baseline" value={`${(base?.roiPct ?? 0).toFixed(1)}%`} />
          <StatPill label="ROI proposed" value={`${(prop?.roiPct ?? 0).toFixed(1)}%`} />
          <StatPill
            className={deltaRoi >= 0 ? "border-emerald-500/30" : "border-destructive/30"}
            label="Δ ROI"
            value={`${deltaRoi >= 0 ? "+" : ""}${deltaRoi.toFixed(1)} pp`}
          />
          <StatPill
            className={deltaProfit >= 0 ? "border-emerald-500/30" : "border-destructive/30"}
            label="Δ Profit"
            value={`${deltaProfit >= 0 ? "+" : ""}${deltaProfit.toFixed(1)} u`}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          snapshot n={base?.n ?? 0} · W{base?.wins ?? 0}/L{base?.losses ?? 0}/P{base?.pushes ?? 0}
          <span className="mx-2 text-border">|</span>
          proposed n={prop?.n ?? 0} · W{prop?.wins ?? 0}/L{prop?.losses ?? 0}/P{prop?.pushes ?? 0}
        </p>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setPatchOpen(true)} size="sm" type="button" variant="outline">
            Показать patch
          </Button>

          <Dialog onOpenChange={setPatchOpen} open={patchOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Patch JSON</DialogTitle>
                <DialogDescription>{proposal.title}</DialogDescription>
              </DialogHeader>
              <pre className="max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
                {JSON.stringify(proposal.patch, null, 2)}
              </pre>
            </DialogContent>
          </Dialog>

          {pending && isAdmin ? (
            <>
              <Button disabled={busy} onClick={() => void openApplyConfirm()} size="sm">
                {busy ? "…" : copy.common.apply}
              </Button>
              <Button disabled={busy} onClick={() => onReject(proposal.id)} size="sm" variant="outline">
                {copy.common.reject}
              </Button>
            </>
          ) : null}
        </div>

        <ConfirmApplyDialog
          confirmLabel={copy.common.apply}
          description={
            <div className="grid gap-3 text-left">
              <p>
                Патч наложится на текущую production{" "}
                <span className="font-mono text-foreground">
                  {preview?.productionVersionLabel ?? "…"}
                </span>{" "}
                и сразу станет активной версией.
              </p>
              {previewLoading ? <p>{copy.agent.previewLoading}</p> : null}
              {previewError ? (
                <Alert variant="destructive">
                  <AlertTitle>{copy.agent.previewFailed}</AlertTitle>
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              ) : null}
              {preview?.baselineStale ? (
                <Alert>
                  <AlertTitle>Stale baseline</AlertTitle>
                  <AlertDescription>{copy.agent.baselineStale}</AlertDescription>
                </Alert>
              ) : null}
              {preview?.validationErrors.length ? (
                <Alert variant="destructive">
                  <AlertTitle>{copy.agent.validationBlocked}</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-1 list-inside list-disc">
                      {preview.validationErrors.map((err) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              {preview?.liveBacktest ? (
                <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">
                    Live replay vs {preview.liveBacktest.baselineVersionLabel} · sample{" "}
                    {preview.liveBacktest.sample}
                  </p>
                  <MetricsRow label="Production сейчас" metrics={preview.liveBacktest.baseline} />
                  <MetricsRow label="После патча" metrics={preview.liveBacktest.proposed} />
                </div>
              ) : null}
              {preview ? (
                <Button
                  className="justify-start px-0"
                  onClick={() => setResolvedOpen(true)}
                  size="sm"
                  type="button"
                  variant="link"
                >
                  {copy.agent.showResolved}
                </Button>
              ) : null}
            </div>
          }
          onConfirm={confirmApply}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open) {
              setPreview(null);
              setPreviewError(null);
            }
          }}
          open={confirmOpen}
          pending={busy || previewLoading}
          confirmDisabled={blocked || Boolean(previewError) || !preview}
          title={copy.agent.previewTitle}
        />

        <Dialog onOpenChange={setResolvedOpen} open={resolvedOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{copy.agent.showResolved}</DialogTitle>
              <DialogDescription>
                {preview?.productionVersionLabel} + patch → итоговая спека
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-[50vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
              {JSON.stringify(preview?.resolvedSpec ?? {}, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
