"use client";

import { EmptyState } from "@/components/feedback/EmptyState";
import { AgentProposalCard } from "@/features/agent/AgentProposalCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { copy } from "@/lib/copy";
import type { NestAgentProposal } from "@/types";

export function AgentProposalsPane({
  proposals,
  loading,
  error,
  isAdmin,
  actionId,
  productionLabel,
  onApply,
  onReject,
  onOpenFormula,
}: {
  proposals: NestAgentProposal[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  actionId: string | null;
  productionLabel: string | null;
  onApply: (id: string) => Promise<void> | void;
  onReject: (id: string) => void;
  onOpenFormula: () => void;
}) {
  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-border/80 bg-card">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card">
      <div className="shrink-0 border-b border-border/70 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{copy.agent.proposalsHint}</p>
            {productionLabel ? (
              <p className="text-xs text-muted-foreground">
                {copy.agent.productionNow}:{" "}
                <button
                  className="font-mono text-foreground underline-offset-2 hover:underline"
                  onClick={onOpenFormula}
                  type="button"
                >
                  {productionLabel}
                </button>
              </p>
            ) : null}
          </div>
          <Button onClick={onOpenFormula} size="sm" type="button" variant="outline">
            {copy.agent.formula}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="grid gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!proposals.length ? (
            <EmptyState
              className="border-0 bg-transparent py-10"
              description={copy.agent.emptyProposals}
              title={copy.agent.proposals}
            />
          ) : (
            proposals.map((proposal) => (
              <AgentProposalCard
                actionId={actionId}
                isAdmin={isAdmin}
                key={proposal.id}
                onApply={onApply}
                onReject={onReject}
                proposal={proposal}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
