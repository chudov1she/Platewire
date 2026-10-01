import { f5IsComplete } from '../odds/f5-scope.js';

/** How long a dispatched settlement may run before the office sends it again. */
export const SETTLE_RETRY_MS = 3 * 60 * 1000;

export type SettlementDecision = 'f5_settled' | 'final' | 'hold' | 'open';

/**
 * Webhook 200 only means the worker was started. `f5` and `final` are written
 * when that worker confirms. A pending key older than the retry window is sent again.
 */
export function decideSettlement(
  status: string,
  inning: number | null | undefined,
  finalKey: string | null | undefined,
  pendingAgeMs: number,
): SettlementDecision {
  const f5Done = f5IsComplete(inning);
  const key = finalKey ?? null;
  const fresh = pendingAgeMs >= 0 && pendingAgeMs < SETTLE_RETRY_MS;

  if (key === 'final') return 'hold';
  if (key === 'final_pending' && fresh) return 'hold';
  if (key === 'f5_pending' && fresh) return 'hold';

  if (f5Done && key !== 'f5' && key !== 'final_pending') {
    return 'f5_settled';
  }
  if (status === 'FINAL' && key !== 'final') {
    return 'final';
  }
  if (f5Done || key === 'f5' || key === 'f5_pending' || key === 'final_pending') {
    return 'hold';
  }
  return 'open';
}

export function pendingFinalKey(reason: 'f5_settled' | 'final'): string {
  return reason === 'final' ? 'final_pending' : 'f5_pending';
}
