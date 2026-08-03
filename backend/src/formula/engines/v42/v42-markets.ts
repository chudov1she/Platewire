import { poissonPmf } from './v42-lambda.js';
import type { MarketLine, ValueBet } from '../../formula.types.js';

export const OVERROUND = 1.05;
export const VALUE_THRESHOLD = 65;

export function americanToDecimal(american: string | null | undefined): number | null {
  if (!american) return null;
  const value = Number.parseInt(american.replace('+', ''), 10);
  if (!Number.isFinite(value) || value === 0) return null;
  if (value > 0) return 1 + value / 100;
  return 1 + 100 / Math.abs(value);
}

export function impliedProb(decimalOdds: number, overround = OVERROUND): number {
  return 1 / decimalOdds / overround;
}

export function valuePct(myProb: number, implied: number): number {
  if (implied <= 0) return 0;
  return ((myProb - implied) / implied) * 100;
}

export function roiPct(myProb: number, odds: number): number {
  return (myProb * (odds - 1) - (1 - myProb)) * 100;
}

export function probTotalOver(lam: number, line: number): number {
  const lambda = Math.max(0.01, lam);
  let minRuns: number;
  if (Math.abs((line % 1) - 0.5) < 0.01) {
    minRuns = Math.trunc(line) + 1;
  } else {
    minRuns =
      line === Math.trunc(line)
        ? Math.max(1, Math.trunc(line) + 1)
        : Math.trunc(line) + 1;
  }
  let pAtOrBelow = 0;
  for (let k = 0; k < minRuns; k += 1) pAtOrBelow += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - pAtOrBelow));
}

export function evaluateMarkets(
  sim: Record<string, number>,
  markets: MarketLine[],
  opts?: { overround?: number },
): ValueBet[] {
  const overround = opts?.overround ?? OVERROUND;
  const bets: ValueBet[] = [];
  for (const market of markets) {
    let modelProb: number;
    if (market.market === 'moneyline') {
      if (market.side === 'home') modelProb = sim.p_home_lead ?? 0;
      else if (market.side === 'away') modelProb = sim.p_away_lead ?? 0;
      else modelProb = sim.p_tie ?? 0;
    } else if (market.market === 'total') {
      const line = market.line ?? 4.5;
      const pOver =
        Math.abs(line - 4.5) < 0.001
          ? (sim.p_over_4_5 ?? 0.5)
          : probTotalOver(sim.avg_total ?? 4.5, line);
      modelProb = market.side === 'over' ? pOver : 1 - pOver;
    } else if (market.market === 'team_total') {
      const line = market.line ?? 2.0;
      const teamLam =
        market.team === 'away'
          ? (sim.expected_away_runs ?? sim.avg_away ?? 2)
          : (sim.expected_home_runs ?? sim.avg_home ?? 2);
      const pOver = probTotalOver(teamLam, line);
      modelProb = market.side === 'over' ? pOver : 1 - pOver;
    } else if (market.market === 'runline') {
      // Legacy ledger rows may still settle; not offered in new pick pools.
      modelProb =
        market.side === 'home'
          ? (sim.p_home_lead ?? 0)
          : (sim.p_away_lead ?? 0);
    } else {
      continue;
    }
    const implied = impliedProb(market.decimal_odds, overround);
    bets.push({
      market: market.market,
      side: market.side,
      decimal_odds: market.decimal_odds,
      line: market.line ?? null,
      team: market.team ?? null,
      implied_pct: implied * 100,
      model_prob: modelProb * 100,
      value_pct: valuePct(modelProb, implied),
      roi_pct: roiPct(modelProb, market.decimal_odds),
    });
  }
  return bets.sort((a, b) => b.value_pct - a.value_pct);
}
