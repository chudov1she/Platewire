import { z } from 'zod';

/**
 * Strict schema for the Decision agent's final structured output.
 * Anything that fails this schema (or the cross-checks in
 * `validateDecisionAgainstAnalysis`) is discarded and the ledger records a
 * safe PASS instead — the agent never gets to bet on a hallucinated market.
 */
export const DecisionActionSchema = z.enum(['bet', 'pass']);
export const ConfidenceTierSchema = z.enum(['low', 'medium', 'high']);

export const AiDecisionOutputSchema = z.object({
  action: DecisionActionSchema,
  market: z.enum(['moneyline', 'total', 'team_total']).nullable(),
  side: z.string().nullable(),
  /** Required for team_total: which club's IT. */
  team: z.enum(['home', 'away']).nullable().optional(),
  line: z.number().nullable().optional(),
  confidence_tier: ConfidenceTierSchema.nullable(),
  risk_flags: z.array(z.string()).default([]),
  rationale: z.string().min(1).max(2000),
  /** Short TG-facing summary (1–3 sentences RU) based on this stage's forecast. */
  notify_brief: z.string().min(1).max(400),
});

export type AiDecisionOutput = z.infer<typeof AiDecisionOutputSchema>;

export type DecisionValidationResult =
  | { ok: true; matched: { decimal_odds: number; value_pct: number; roi_pct: number; model_prob: number; line: number | null } }
  | { ok: false; reason: string };

/**
 * Cross-checks the AI's chosen market/side/line against the FRESH formula
 * output computed the instant before the call. The AI can only ever bet on
 * a line that the deterministic engine actually produced — it cannot invent
 * odds, sides, or lines.
 */
export function validateDecisionAgainstAnalysis(
  decision: AiDecisionOutput,
  pool: Array<{
    market: string;
    side: string;
    decimal_odds: number;
    value_pct: number;
    roi_pct: number;
    model_prob: number;
    line?: number | null;
    team?: 'home' | 'away' | null;
  }>,
): DecisionValidationResult {
  if (decision.action === 'pass') {
    return { ok: true, matched: { decimal_odds: 0, value_pct: 0, roi_pct: 0, model_prob: 0, line: null } };
  }
  if (!decision.market || !decision.side || !decision.confidence_tier) {
    return { ok: false, reason: 'bet_missing_market_side_or_confidence' };
  }
  if (decision.market === 'team_total' && !decision.team) {
    return { ok: false, reason: 'team_total_missing_team' };
  }
  const match = pool.find(
    (b) =>
      b.market === decision.market &&
      b.side.toLowerCase() === decision.side!.toLowerCase() &&
      (decision.market !== 'team_total' || b.team === decision.team) &&
      (decision.line == null || b.line == null || Math.abs(b.line - decision.line) < 0.01),
  );
  if (!match) {
    return { ok: false, reason: 'no_matching_formula_signal_for_pick' };
  }
  return {
    ok: true,
    matched: {
      decimal_odds: match.decimal_odds,
      value_pct: match.value_pct,
      roi_pct: match.roi_pct,
      model_prob: match.model_prob,
      line: match.line ?? null,
    },
  };
}
