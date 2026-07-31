import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeMatchup,
  buildLambdas,
  exactPoissonF5,
  fixtureMatchupInputs,
  parkFactor,
} from '../engines/v42/index.js';
import { FormulaRunnerService } from '../formula-runner.service.js';
import { defaultFormulaSpec, patchFormulaSpec } from '../formula-spec.js';
import type { MarketLine } from '../formula.types.js';

describe('v42 engine', () => {
  it('builds finite lambdas for fixture matchup', () => {
    const inputs = fixtureMatchupInputs();
    const built = buildLambdas(inputs);
    assert.ok(built.lambda_home > 0.05 && built.lambda_home < 1.5);
    assert.ok(built.lambda_away > 0.05 && built.lambda_away < 1.5);
    assert.equal(typeof built.breakdown.park_time, 'number');
  });

  it('applies Coors park chaos', () => {
    const { factor, chaos } = parkFactor('Coors Field', { coors_chaos: true });
    assert.equal(factor, 1.15);
    assert.equal(chaos, 1.2);
  });

  it('exact poisson probs sum ~1', () => {
    const sim = exactPoissonF5({
      lambda_home: 0.5,
      lambda_away: 0.45,
      remaining_innings: 2,
      base_home: 1,
      base_away: 0,
    });
    const sum = sim.p_home_lead! + sim.p_tie! + sim.p_away_lead!;
    assert.ok(Math.abs(sum - 1) < 0.02);
  });

  it('analyzeMatchup returns value bets above threshold', () => {
    const markets: MarketLine[] = [
      { market: 'moneyline', side: 'home', decimal_odds: 3.5 },
      { market: 'moneyline', side: 'away', decimal_odds: 1.4 },
      { market: 'total', side: 'over', decimal_odds: 2.0, line: 4.5 },
      { market: 'total', side: 'under', decimal_odds: 1.8, line: 4.5 },
    ];
    const analysis = analyzeMatchup(fixtureMatchupInputs(), markets, {
      n_main: 5_000,
      value_threshold: 0,
    });
    assert.ok(analysis.value_bets.length >= 1);
    assert.equal(analysis.formula_version, 'v42');
    assert.ok(analysis.p_home_lead + analysis.p_tie + analysis.p_away_lead > 0.9);
  });
});

describe('formula runner overlay', () => {
  const runner = new FormulaRunnerService();

  it('applies lambda multipliers from spec', () => {
    const base = runner.analyze(fixtureMatchupInputs(), [], defaultFormulaSpec());
    const boosted = runner.analyze(
      fixtureMatchupInputs(),
      [],
      patchFormulaSpec(defaultFormulaSpec(), {
        version: 'boost',
        lambda_home_mult: '1.2',
        lambda_away_mult: '0.9',
      }),
    );
    assert.ok(boosted.lambda_home > base.lambda_home * 1.15);
    assert.ok(boosted.lambda_away < base.lambda_away * 0.95);
  });

  it('falls back to mult 1.0 on bad expression and notes error', () => {
    const analysis = runner.analyze(
      fixtureMatchupInputs(),
      [],
      patchFormulaSpec(defaultFormulaSpec(), {
        lambda_home_mult: 'unknown_var * 2',
      }),
    );
    assert.ok(analysis.notes.some((n) => n.startsWith('formula_error=')));
    assert.ok(analysis.lambda_home > 0);
  });

  it('validate catches bad derived keys and exprs', () => {
    const errors = runner.validate(
      patchFormulaSpec(defaultFormulaSpec(), {
        derived: { 'bad-name': '1', ok: 'missing + 1' },
        lambda_home_mult: 'nope',
      }),
    );
    assert.ok(errors.length >= 1);
  });
});
