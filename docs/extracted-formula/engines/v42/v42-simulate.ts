import {
  liveF5RecalcActive,
  remainingF5Innings,
} from '../../../odds/f5-scope.js';
import type { LiveF5State } from './v42-lambda.js';
import { exactPoissonF5 } from './v42-lambda.js';

export const MARGIN_TIE = 0.5;
export const PROB_CAP = 0.92;

/** Mulberry32 PRNG */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth Poisson sampler */
export function samplePoisson(lam: number, rng: () => number): number {
  if (lam <= 0) return 0;
  if (lam > 30) {
    // Normal approximation for speed
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z =
      Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * z));
  }
  const L = Math.exp(-lam);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function capProb(probability: number, cap = PROB_CAP): number {
  return Math.min(probability, cap);
}

export type SimResult = {
  p_home_lead: number;
  p_tie: number;
  p_away_lead: number;
  p_over_4_5: number;
  avg_total: number;
  mode?: string;
};

function summarizeSim(
  home: number[],
  away: number[],
  marginTie = MARGIN_TIE,
): Omit<SimResult, 'mode'> {
  const n = home.length;
  let homeLead = 0;
  let tie = 0;
  let awayLead = 0;
  let over = 0;
  let totalSum = 0;
  for (let i = 0; i < n; i += 1) {
    const h = home[i]!;
    const a = away[i]!;
    const margin = a - h;
    if (margin < -marginTie) homeLead += 1;
    else if (Math.abs(margin) <= marginTie) tie += 1;
    else awayLead += 1;
    const total = h + a;
    totalSum += total;
    if (total > 4.5) over += 1;
  }
  return {
    p_home_lead: capProb(homeLead / n),
    p_tie: capProb(tie / n),
    p_away_lead: capProb(awayLead / n),
    p_over_4_5: capProb(over / n),
    avg_total: totalSum / n,
  };
}

export function simulateF5(
  lambdaHome: number,
  lambdaAway: number,
  opts?: {
    n_main?: number;
    n_tail?: number;
    chaos?: number;
    seed?: number;
    innings?: number;
    margin_tie?: number;
  },
): Omit<SimResult, 'mode'> {
  const nMain = opts?.n_main ?? 20_000;
  const nTail = opts?.n_tail ?? 50_000;
  const chaos = opts?.chaos ?? 1;
  const seed = opts?.seed ?? 42;
  const innings = opts?.innings ?? 5;
  const marginTie = opts?.margin_tie ?? MARGIN_TIE;
  const rng = createRng(seed);

  const home: number[] = [];
  const away: number[] = [];
  for (let i = 0; i < nMain; i += 1) {
    let h = 0;
    let a = 0;
    for (let inn = 0; inn < innings; inn += 1) {
      h += samplePoisson(lambdaHome * chaos, rng);
      a += samplePoisson(lambdaAway * chaos, rng);
    }
    home.push(h);
    away.push(a);
  }
  if (chaos > 1 && nTail) {
    for (let i = 0; i < nTail; i += 1) {
      let h = 0;
      let a = 0;
      for (let inn = 0; inn < innings; inn += 1) {
        h += samplePoisson(lambdaHome * chaos * 1.15, rng);
        a += samplePoisson(lambdaAway * chaos * 1.15, rng);
      }
      home.push(h);
      away.push(a);
    }
  }
  return summarizeSim(home, away, marginTie);
}

export function simulateLiveF5(
  lambdaHome: number,
  lambdaAway: number,
  live: LiveF5State,
  opts?: { chaos?: number; seed?: number; margin_tie?: number },
): SimResult {
  const chaos = opts?.chaos ?? 1;
  const seed = opts?.seed ?? 42;
  const marginTie = opts?.margin_tie ?? MARGIN_TIE;
  let remaining = remainingF5Innings(live.completed_innings, {
    inning: live.inning,
    inningHalf: live.inning_half,
  });
  remaining = Math.max(1, remaining);
  const baseHome = live.home_score;
  const baseAway = live.away_score;

  if (remaining <= 2) {
    const exact = exactPoissonF5({
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      remaining_innings: remaining,
      base_home: baseHome,
      base_away: baseAway,
    });
    return {
      p_home_lead: capProb(exact.p_home_lead!),
      p_tie: capProb(exact.p_tie!),
      p_away_lead: capProb(exact.p_away_lead!),
      p_over_4_5: capProb(exact.p_over_4_5!),
      avg_total: exact.avg_total!,
      mode: 'exact_poisson',
    };
  }

  const rng = createRng(seed);
  const n = 70_000;
  const home: number[] = [];
  const away: number[] = [];
  for (let i = 0; i < n; i += 1) {
    let hAdd = 0;
    let aAdd = 0;
    for (let inn = 0; inn < remaining; inn += 1) {
      hAdd += samplePoisson(lambdaHome * chaos, rng);
      aAdd += samplePoisson(lambdaAway * chaos, rng);
    }
    home.push(baseHome + hAdd);
    away.push(baseAway + aAdd);
  }
  const mc = summarizeSim(home, away, marginTie);
  if (
    mc.p_home_lead > 0.85 ||
    mc.p_home_lead < 0.15 ||
    mc.p_away_lead > 0.85 ||
    mc.p_away_lead < 0.15
  ) {
    const exact = exactPoissonF5({
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      remaining_innings: remaining,
      base_home: baseHome,
      base_away: baseAway,
    });
    if (Math.abs(mc.p_home_lead - exact.p_home_lead!) > 0.05) {
      return {
        p_home_lead: capProb(exact.p_home_lead!),
        p_tie: capProb(exact.p_tie!),
        p_away_lead: capProb(exact.p_away_lead!),
        p_over_4_5: capProb(exact.p_over_4_5!),
        avg_total: exact.avg_total!,
        mode: 'exact_poisson_guard',
      };
    }
  }
  return { ...mc, mode: 'live_mc' };
}

export function isLiveRecalc(live: LiveF5State | null | undefined): boolean {
  if (!live) return false;
  return liveF5RecalcActive(live.completed_innings, {
    inning: live.inning,
    inningHalf: live.inning_half,
  });
}
