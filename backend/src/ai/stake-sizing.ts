/**
 * Deterministic stake sizing. The AI Decision agent never writes a stake size
 * itself — money math stays in code.
 *
 * Desk convention: flat paper stake of 50 units on a 1000-point bankroll
 * (5% per bet). confidence_tier is kept for display / filtering only and
 * does not change the stake.
 */

export type ConfidenceTier = 'low' | 'medium' | 'high';

/** @deprecated unused — flat stake ignores tier; kept for call-site compatibility. */
export const CONFIDENCE_MULTIPLIER: Record<ConfidenceTier, number> = {
  low: 1,
  medium: 1,
  high: 1,
};

/**
 * Notional starting bankroll in "points" (classic desk 1000-point bank).
 * Display/sizing constant only — not persisted per-entry.
 */
export const STARTING_BANKROLL_POINTS = 1000;
/** @deprecated use STARTING_BANKROLL_POINTS */
export const BANKROLL_UNIT = STARTING_BANKROLL_POINTS;

/** Flat stake per bet. */
export const FLAT_STAKE_UNITS = 50;

/** @deprecated Kelly path removed; aliases kept so older imports compile. */
export const KELLY_FRACTION = 0;
export const MIN_STAKE_UNITS = FLAT_STAKE_UNITS;
export const MAX_STAKE_FRACTION = FLAT_STAKE_UNITS / STARTING_BANKROLL_POINTS;

export function kellyFraction(_modelProb: number, _decimalOdds: number): number {
  return 0;
}

export function computeStakeUnits(_opts?: {
  modelProbPct?: number;
  decimalOdds?: number;
  confidenceTier?: ConfidenceTier;
  bankrollUnit?: number;
}): number {
  return FLAT_STAKE_UNITS;
}