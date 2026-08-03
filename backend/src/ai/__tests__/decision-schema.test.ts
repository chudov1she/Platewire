import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AiDecisionOutputSchema,
  validateDecisionAgainstAnalysis,
} from '../decision-schema.js';

const pool = [
  {
    market: 'moneyline',
    side: 'home',
    decimal_odds: 2.1,
    value_pct: 12,
    roi_pct: 8,
    model_prob: 55,
    line: null,
  },
  {
    market: 'total',
    side: 'over',
    decimal_odds: 1.95,
    value_pct: 20,
    roi_pct: 15,
    model_prob: 60,
    line: 4.5,
  },
];

describe('decision-schema', () => {
  it('accepts a well-formed pass decision', () => {
    const parsed = AiDecisionOutputSchema.parse({
      action: 'pass',
      market: null,
      side: null,
      confidence_tier: null,
      risk_flags: ['thin_lineup_data'],
      rationale: 'Not enough edge to justify a stake today.',
      notify_brief: 'Пасс: края недостаточно для ставки.',
    });
    assert.equal(parsed.action, 'pass');
    assert.ok(parsed.notify_brief.length > 0);
  });

  it('rejects a decision with an invalid confidence tier', () => {
    const parsed = AiDecisionOutputSchema.safeParse({
      action: 'bet',
      market: 'moneyline',
      side: 'home',
      confidence_tier: 'yolo',
      risk_flags: [],
      rationale: 'x',
      notify_brief: 'x',
    });
    assert.equal(parsed.success, false);
  });

  it('validates a bet against the fresh formula pool when it matches', () => {
    const decision = AiDecisionOutputSchema.parse({
      action: 'bet',
      market: 'moneyline',
      side: 'home',
      confidence_tier: 'medium',
      risk_flags: [],
      rationale: 'Clear rotation edge.',
      notify_brief: 'Ставим хозяев по ML: ротация даёт край.',
    });
    const result = validateDecisionAgainstAnalysis(decision, pool);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.matched.decimal_odds, 2.1);
    }
  });

  it('rejects a bet on a market/side that formula did not actually produce', () => {
    const decision = AiDecisionOutputSchema.parse({
      action: 'bet',
      market: 'team_total',
      side: 'over',
      team: 'home',
      confidence_tier: 'high',
      risk_flags: [],
      rationale: 'Hallucinated pick.',
      notify_brief: 'Неверный пик.',
    });
    const result = validateDecisionAgainstAnalysis(decision, pool);
    assert.equal(result.ok, false);
  });

  it('validates team_total when team+side+line match the pool', () => {
    const ttPool = [
      ...pool,
      {
        market: 'team_total',
        side: 'over',
        team: 'away' as const,
        decimal_odds: 1.9,
        value_pct: 18,
        roi_pct: 10,
        model_prob: 58,
        line: 2.5,
      },
    ];
    const decision = AiDecisionOutputSchema.parse({
      action: 'bet',
      market: 'team_total',
      side: 'over',
      team: 'away',
      line: 2.5,
      confidence_tier: 'medium',
      risk_flags: [],
      rationale: 'Away IT edge.',
      notify_brief: 'ИТ гостей овер.',
    });
    const result = validateDecisionAgainstAnalysis(decision, ttPool);
    assert.equal(result.ok, true);
  });

  it('requires notify_brief', () => {
    const parsed = AiDecisionOutputSchema.safeParse({
      action: 'pass',
      market: null,
      side: null,
      confidence_tier: null,
      risk_flags: [],
      rationale: 'ok',
    });
    assert.equal(parsed.success, false);
  });

  it('always accepts pass regardless of pool contents', () => {
    const decision = AiDecisionOutputSchema.parse({
      action: 'pass',
      market: null,
      side: null,
      confidence_tier: null,
      risk_flags: [],
      rationale: 'No edge.',
      notify_brief: 'Пасс: края нет.',
    });
    const result = validateDecisionAgainstAnalysis(decision, []);
    assert.equal(result.ok, true);
  });
});
