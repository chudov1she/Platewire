import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { FormulaStoreService } from '../formula/formula-store.service.js';
import type { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import type { LedgerBacktestService } from '../ledger/ledger-backtest.service.js';
import type { AgentProposalService } from './agent-proposal.service.js';

export function buildCurationTools(deps: {
  store: FormulaStoreService;
  analytics: LedgerAnalyticsService;
  backtest: LedgerBacktestService;
  proposals: AgentProposalService;
}) {
  const getProductionFormula = tool(
    async () => JSON.stringify(await deps.store.getProduction()),
    {
      name: 'get_production_formula',
      description: 'Current production FormulaSpec, its version id/label, and available env keys for derived/lambda expressions.',
      schema: z.object({}),
    },
  );

  const getLedgerAnalytics = tool(
    async ({ days }) => JSON.stringify(await deps.analytics.stats(days ?? 14)),
    {
      name: 'get_ledger_analytics',
      description: 'Ledger performance over the last N days: winrate, ROI, breakdown by track/confidence tier, worst losses.',
      schema: z.object({ days: z.number().optional() }),
    },
  );

  const backtestPatch = tool(
    async ({ patch, days, track }) =>
      JSON.stringify(await deps.backtest.comparePatch(patch, { days, track })),
    {
      name: 'backtest_patch',
      description:
        'Replays settled ledger games with (a) the CURRENT PRODUCTION FormulaSpec and (b) the same spec with your patch applied, and returns wins/losses/ROI/winrate for both. Always call this before proposing a patch.',
      schema: z.object({
        patch: z.record(z.string(), z.any()),
        days: z.number().optional(),
        track: z.string().optional(),
      }),
    },
  );

  const proposeFormulaPatch = tool(
    async ({ title, rationale, patch, days, track }) =>
      JSON.stringify(await deps.proposals.create({ title, rationale, patch, days, track })),
    {
      name: 'propose_formula_patch',
      description:
        'Creates an AgentProposal with a fresh backtest snapshot. Does NOT touch production — a human must separately apply it. Only call this after backtest_patch confirms a real, mechanism-explainable improvement.',
      schema: z.object({
        title: z.string(),
        rationale: z.string(),
        patch: z.record(z.string(), z.any()),
        days: z.number().optional(),
        track: z.string().optional(),
      }),
    },
  );

  const listProposals = tool(
    async ({ limit }) => JSON.stringify(await deps.proposals.list(limit ?? 10)),
    {
      name: 'list_proposals',
      description: 'List recent formula proposals and their status (proposed/applied/rejected).',
      schema: z.object({ limit: z.number().optional() }),
    },
  );

  return [getProductionFormula, getLedgerAnalytics, backtestPatch, proposeFormulaPatch, listProposals];
}
