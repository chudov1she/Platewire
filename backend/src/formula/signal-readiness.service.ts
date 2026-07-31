import { Injectable } from '@nestjs/common';
import type { F5OddsStage } from '../odds/f5-scope.js';
import type { InputSource } from './formula.types.js';
import type { MatchupContextFlags } from './matchup-inputs.service.js';
import {
  marketsComplete,
  type MarketLoadResult,
} from './market-loader.service.js';

export type { MatchupContextFlags };

export type ReadinessResult = {
  ready: boolean;
  score: number;
  hardGaps: string[];
  softGaps: string[];
  inputsReady: boolean;
  oddsOk: boolean;
  contextOk: boolean;
};

export type ReadinessEvaluateInput = {
  track: F5OddsStage | string;
  input_sources: Record<string, InputSource>;
  market: Pick<MarketLoadResult, 'markets' | 'marketsUsed' | 'locked' | 'source'>;
  context: MatchupContextFlags;
};

/**
 * Hard gaps block the Decision agent from being invoked at all (pipeline
 * skips and retries next tick). Soft gaps never block — they only ride
 * along in the decision brief so the AI can weigh thin-data risk itself.
 */
@Injectable()
export class SignalReadinessService {
  evaluate(input: ReadinessEvaluateInput): ReadinessResult {
    const hardGaps: string[] = [];
    const softGaps: string[] = [];
    const track = String(input.track || 'prematch');

    for (const side of ['home', 'away'] as const) {
      pushFeatureGap(hardGaps, input.input_sources[`${side}_ops`], side, 'OPS');
      pushFeatureGap(
        hardGaps,
        input.input_sources[`${side}_sp_era`],
        side,
        'SP_ERA',
      );
    }
    const inputsReady = !hardGaps.some(
      (g) => g.includes(':OPS=') || g.includes(':SP_ERA='),
    );

    const bothSp = input.context.hasHomeSp && input.context.hasAwaySp;
    let contextOk = true;
    if (track === 'prematch') {
      if (!input.context.hasLineup && !bothSp) {
        hardGaps.push('context:prematch');
        contextOk = false;
      }
    } else if (track === 'inn1' || track === 'inn2') {
      if (!bothSp) {
        hardGaps.push('context:sp');
        contextOk = false;
      }
    }

    let oddsOk = true;
    const m = input.market;
    if (!m.marketsUsed || m.markets.length === 0) {
      hardGaps.push(`odds:${track}=missing`);
      oddsOk = false;
    } else if (!marketsComplete(m.markets)) {
      hardGaps.push(`odds:${track}=incomplete`);
      oddsOk = false;
    }

    const ump = input.input_sources.ump_strike_zone_pct;
    if (!ump || ump.source === 'default') {
      softGaps.push('ump:default');
    }
    const temp = input.input_sources.temperature_f;
    if (!temp || temp.source === 'default') {
      softGaps.push('weather:neutral');
    }

    const score = computeScore(hardGaps, softGaps);
    return {
      ready: hardGaps.length === 0,
      score,
      hardGaps,
      softGaps,
      inputsReady,
      oddsOk,
      contextOk,
    };
  }
}

function pushFeatureGap(
  hardGaps: string[],
  src: InputSource | undefined,
  side: 'home' | 'away',
  field: 'OPS' | 'SP_ERA',
): void {
  if (!src || src.source === 'default') {
    hardGaps.push(`${side}:${field}=default`);
    return;
  }
  if (src.source === 'feature' && src.ready !== true) {
    hardGaps.push(`${side}:${field}=not_ready`);
  }
}

/**
 * start 100; −25 per missing OPS side; −25 per missing SP side;
 * −30 odds fail (once); −20 context fail; soft −5 each; floor 0.
 */
export function computeScore(hardGaps: string[], softGaps: string[]): number {
  let score = 100;
  for (const g of hardGaps) {
    if (g.includes(':OPS=')) score -= 25;
    else if (g.includes(':SP_ERA=')) score -= 25;
  }
  if (hardGaps.some((g) => g.startsWith('odds:'))) score -= 30;
  if (hardGaps.some((g) => g.startsWith('context:'))) score -= 20;
  score -= softGaps.length * 5;
  return Math.max(0, score);
}

/** Pure helper for unit tests without Nest DI. */
export function evaluateReadiness(
  input: ReadinessEvaluateInput,
): ReadinessResult {
  return new SignalReadinessService().evaluate(input);
}

export function marketsForReadiness(
  market: MarketLoadResult,
): ReadinessEvaluateInput['market'] {
  return {
    markets: market.markets,
    marketsUsed: market.marketsUsed,
    locked: market.locked,
    source: market.source,
  };
}
