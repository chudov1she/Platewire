"use client";

import { useState } from "react";
import { StatPill } from "@/components/feedback/StatusBadge";
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
import { formatDateTime } from "@/features/match/match-format";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { NestAgentProposal } from "@/types";

function proposalBadgeClass(status: string) {
  if (status === "applied") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-400";
  if (status === "rejected") return "border-destructive/40 bg-destructive/15 text-destructive";
  return "border-amber-500/40 bg-amber-500/15 text-amber-300";
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
  onApply: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [patchOpen, setPatchOpen] = useState(false);
  const base = proposal.baselineMetrics;
  const prop = proposal.proposedMetrics;
  const deltaRoi = (prop?.roiPct ?? 0) - (base?.roiPct ?? 0);
  const deltaProfit = (prop?.profit ?? 0) - (base?.profit ?? 0);
  const pending = proposal.status === "proposed";
  const busy = actionId === proposal.id;

  return (
    <Card className="border-border/80 bg-card shadow-none">
      <CardHeader className="gap-3 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold leading-snug">{proposal.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{formatDateTime(proposal.createdAt)}</p>
          </div>
          <Badge className={cn("rounded-md uppercase", proposalBadgeClass(proposal.status))} variant="outline">
            {proposal.status}
          </Badge>
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
          baseline n={base?.n ?? 0} · W{base?.wins ?? 0}/L{base?.losses ?? 0}/P{base?.pushes ?? 0}
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
              <Button disabled={busy} onClick={() => onApply(proposal.id)} size="sm">
                {busy ? "…" : copy.common.apply}
              </Button>
              <Button disabled={busy} onClick={() => onReject(proposal.id)} size="sm" variant="outline">
                {copy.common.reject}
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
