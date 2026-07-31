import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { FormulaRunnerService } from '../formula/formula-runner.service.js';
import type { MatchupInputsService } from '../formula/matchup-inputs.service.js';
import type { MarketLoaderService } from '../formula/market-loader.service.js';
import type { SignalReadinessService } from '../formula/signal-readiness.service.js';
import type { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import type { FormulaSpec } from '../formula/formula.types.js';
import { AiDecisionOutputSchema } from './decision-schema.js';

export type DecisionToolsDeps = {
  matchup: MatchupInputsService;
  markets: MarketLoaderService;
  runner: FormulaRunnerService;
  readiness: SignalReadinessService;
  analytics: LedgerAnalyticsService;
  gameId: string;
  track: string;
  spec: FormulaSpec;
};

export type CapturedDecision = { value: z.infer<typeof AiDecisionOutputSchema> | null };

/**
 * Tools available to the Decision agent. `record_decision` is the required
 * terminal tool — the agent MUST call it exactly once to finish. All other
 * tools are optional deep-dive helpers for when the pre-built brief isn't
 * enough (thin data, live recalculation doubts, etc).
 */
export function buildDecisionTools(deps: DecisionToolsDeps, out: CapturedDecision) {
  const getMatchDossier = tool(
    async () => {
      const built = await deps.matchup.build(deps.gameId);
      return JSON.stringify({
        inputs: built.inputs,
        input_sources: built.input_sources,
        notes: built.notes,
        context: built.context,
      });
    },
    {
      name: 'get_match_dossier',
      description:
        'Full raw match dossier: team inputs, weather, umpire, live state, and data-source provenance for every field. Use when you need more detail than the brief summary.',
      schema: z.object({}),
    },
  );

  const getFormulaOutput = tool(
    async () => {
      const built = await deps.matchup.build(deps.gameId);
      const marketLoad = await deps.markets.load(deps.gameId, deps.track);
      const analysis = deps.runner.analyze(built.inputs, marketLoad.markets, deps.spec);
      return JSON.stringify(analysis);
    },
    {
      name: 'get_formula_output',
      description:
        'Re-runs the deterministic v42 + FormulaSpec engine right now for this exact game/track and returns the full After5Analysis (lambdas, probabilities, all value_bets/signals, breakdown). Use to double-check numbers from the brief.',
      schema: z.object({}),
    },
  );

  const getRecentLedgerPerformance = tool(
    async ({ days }) => JSON.stringify(await deps.analytics.stats(days ?? 14)),
    {
      name: 'get_recent_ledger_performance',
      description:
        'Recent ledger track record (winrate, ROI, worst losses, breakdown by confidence tier) for the current production formula. Use to calibrate how aggressive your confidence_tier should be.',
      schema: z.object({ days: z.number().optional() }),
    },
  );

  const recordDecision = tool(
    async (args) => {
      out.value = args;
      return JSON.stringify({ recorded: true });
    },
    {
      name: 'record_decision',
      description:
        'REQUIRED terminal tool. Call exactly once with your final decision to finish the analysis. After calling this, stop — do not call any other tool.',
      schema: AiDecisionOutputSchema,
    },
  );

  return [getMatchDossier, getFormulaOutput, getRecentLedgerPerformance, recordDecision];
}
