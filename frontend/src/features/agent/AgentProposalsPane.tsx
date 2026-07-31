"use client";

import { EmptyState } from "@/components/feedback/EmptyState";
import { AgentProposalCard } from "@/features/agent/AgentProposalCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageLoader } from "@/components/ui/page-loader";
import { copy } from "@/lib/copy";
import type { NestAgentProposal } from "@/types";

export function AgentProposalsPane({
  proposals,
  loading,
  error,
  isAdmin,
  actionId,
  onApply,
  onReject,
}: {
  proposals: NestAgentProposal[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  actionId: string | null;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
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
