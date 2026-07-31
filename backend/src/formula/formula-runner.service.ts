import { Injectable } from '@nestjs/common';
import {
  FormulaEvalError,
  evaluateDerived,
  evaluateExpression,
} from './formula-eval.js';
import { buildFormulaEnv, registryCatalog } from './formula-registry.js';
import type { FormulaSpec } from './formula.types.js';
import type {
  After5Analysis,
  MarketLine,
  MatchupInputs,
} from './formula.types.js';
import { validateDerivedKeys } from './formula-spec.js';
import {
  analyzeMatchup,
  buildLambdas,
  evaluateMarkets,
} from './engines/v42/index.js';
import {
  isLiveRecalc,
  simulateF5,
  simulateLiveF5,
} from './engines/v42/v42-simulate.js';
import { remainingF5Innings } from '../odds/f5-scope.js';
import { capProb } from './engines/v42/v42-simulate.js';

/**
 * Applies the dynamic FormulaSpec overlay on top of the deterministic v42
 * engine. This is the sole quantitative source of truth the AI Decision
 * agent reads from — it never recomputes probabilities itself.
 */
@Injectable()
export class FormulaRunnerService {
  analyze(
    inputs: MatchupInputs,
    markets: MarketLine[] | null | undefined,
    spec: FormulaSpec | null | undefined,
  ): After5Analysis {
    if (!spec) {
      return analyzeMatchup(inputs, markets);
    }

    const params = spec.parameters;
    const built = buildLambdas(inputs);
    let { lambda_home: lambdaHome, lambda_away: lambdaAway } = built;
    const { chaos, notes: baseNotes, breakdown } = built;

    let env = buildFormulaEnv(inputs, {
      base_lambda_home: lambdaHome,
      base_lambda_away: lambdaAway,
      breakdown,
    });

    let homeMult = 1;
    let awayMult = 1;
    const notes = [...baseNotes];

    try {
      env = evaluateDerived(spec.derived, env);
      homeMult = evaluateExpression(spec.lambda_home_mult, env);
      awayMult = evaluateExpression(spec.lambda_away_mult, env);
    } catch (err) {
      const msg =
        err instanceof FormulaEvalError ? err.message : String(err);
      notes.push(`formula_error=${msg}`);
      homeMult = 1;
      awayMult = 1;
    }

    lambdaHome = Math.max(0.01, lambdaHome * homeMult);
    lambdaAway = Math.max(0.01, lambdaAway * awayMult);

    const live = inputs.live;
    let sim: Record<string, number>;
    let simMode: string;
    let expectedHome: number;
    let expectedAway: number;

    if (live && isLiveRecalc(live)) {
      const liveSim = simulateLiveF5(lambdaHome, lambdaAway, live, {
        chaos,
        seed: inputs.seed ?? 42,
        margin_tie: params.margin_tie,
      });
      simMode = liveSim.mode ?? 'live_mc';
      sim = {
        p_home_lead: liveSim.p_home_lead,
        p_tie: liveSim.p_tie,
        p_away_lead: liveSim.p_away_lead,
        p_over_4_5: liveSim.p_over_4_5,
        avg_total: liveSim.avg_total,
      };
      const remaining = Math.max(
        1,
        remainingF5Innings(live.completed_innings, {
          inning: live.inning,
          inningHalf: live.inning_half,
        }),
      );
      expectedHome = live.home_score + lambdaHome * remaining;
      expectedAway = live.away_score + lambdaAway * remaining;
    } else {
      sim = simulateF5(lambdaHome, lambdaAway, {
        chaos,
        seed: inputs.seed ?? 42,
        margin_tie: params.margin_tie,
      });
      simMode = 'pregame_mc';
      expectedHome = lambdaHome * 5;
      expectedAway = lambdaAway * 5;
    }

    sim.p_home_lead = capProb(sim.p_home_lead!, params.prob_cap);
    sim.p_tie = capProb(sim.p_tie!, params.prob_cap);
    sim.p_away_lead = capProb(sim.p_away_lead!, params.prob_cap);
    sim.p_over_4_5 = capProb(sim.p_over_4_5!, params.prob_cap);

    const valueRows = evaluateMarkets(sim, markets ?? [], {
      overround: params.overround,
    });
    const valueBets = valueRows.filter(
      (b) => b.value_pct >= params.value_threshold_pct,
    );
    const signals = valueRows.filter(
      (b) =>
        b.value_pct >= params.signal_value_pct &&
        b.roi_pct >= params.signal_roi_pct,
    );

    notes.push(
      `formula=${spec.version}`,
      `home_mult=${homeMult.toFixed(4)}`,
      `away_mult=${awayMult.toFixed(4)}`,
    );
    if (Object.keys(spec.derived).length) {
      notes.push(`derived=${Object.keys(spec.derived).sort().join(',')}`);
    }

    const envRounded: Record<string, number> = {};
    for (const [k, v] of Object.entries(env)) {
      envRounded[k] = Math.round(v * 10000) / 10000;
    }

    return {
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      expected_home_runs: expectedHome,
      expected_away_runs: expectedAway,
      expected_total: expectedHome + expectedAway,
      p_home_lead: sim.p_home_lead!,
      p_tie: sim.p_tie!,
      p_away_lead: sim.p_away_lead!,
      p_over_4_5: sim.p_over_4_5!,
      avg_total: sim.avg_total!,
      value_bets: valueBets,
      signals,
      notes,
      formula_version: spec.version,
      breakdown: { ...breakdown, formula_env: envRounded },
      simulation_mode: simMode,
    };
  }

  validate(spec: FormulaSpec): string[] {
    const errors: string[] = [];
    const keyErr = validateDerivedKeys(spec.derived);
    if (keyErr) errors.push(keyErr);

    const env: Record<string, number> = {};
    for (const item of registryCatalog()) env[item.name] = 1;

    try {
      evaluateDerived(spec.derived, env);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    for (const [label, expr] of [
      ['lambda_home_mult', spec.lambda_home_mult],
      ['lambda_away_mult', spec.lambda_away_mult],
    ] as const) {
      try {
        evaluateExpression(expr, env);
      } catch (err) {
        errors.push(
          `${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return errors;
  }
}
