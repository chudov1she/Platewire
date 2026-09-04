import type { F5OddsStage } from '../odds/f5-scope.js';
import { completedInnings } from '../odds/f5-scope.js';

export type StageLockRow = {
  stage: string;
  locked: boolean;
  ok: boolean;
  fetchedAt?: Date | null;
};

/** Open prematch collection from T−60m; +30m grace if still PREVIEW (delayed start). */
export const PREMATCH_WINDOW_BEFORE_MS = 60 * 60 * 1000;
export const PREMATCH_WINDOW_AFTER_MS = 30 * 60 * 1000;

/**
 * Short pause after a failed Winline attempt, then retry again.
 * Long enough to avoid ban spam; short enough to still guarantee the bet.
 */
export const ODDS_SCRAPE_BACKOFF_MS = 90 * 1000;

export function inPrematchWindow(
  gameDateUtc: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!gameDateUtc) return false;
  const start = gameDateUtc.getTime();
  const t = now.getTime();
  return (
    start <= t + PREMATCH_WINDOW_BEFORE_MS &&
    start >= t - PREMATCH_WINDOW_AFTER_MS
  );
}

function inOddsBackoff(
  snap: StageLockRow | undefined,
  now: Date,
): boolean {
  if (!snap?.fetchedAt) return false;
  if (snap.ok && snap.locked) return false;
  if (snap.ok) return false;
  return now.getTime() - snap.fetchedAt.getTime() < ODDS_SCRAPE_BACKOFF_MS;
}

/**
 * Bets that are still REQUIRED and not yet secured (ok+locked).
 * Retries until success; never copies markets across stages.
 */
export function stagesNeedingFreshCapture(opts: {
  status: string;
  inning: number | null;
  snapshots: StageLockRow[];
  gameDateUtc?: Date | null;
  now?: Date;
}): F5OddsStage[] {
  const now = opts.now ?? new Date();
  const by = new Map(opts.snapshots.map((s) => [s.stage, s]));
  const out: F5OddsStage[] = [];
  const completed = completedInnings(opts.inning);

  const pm = by.get('prematch');
  const prematchSecured = pm?.ok === true && pm?.locked === true;
  const prematchOkEnough = pm?.ok === true; // success captured; lock may follow
  if (!prematchSecured && !prematchOkEnough && !inOddsBackoff(pm, now)) {
    // Guarantee window: PREVIEW within T−60m…T
    if (opts.status === 'PREVIEW' && inPrematchWindow(opts.gameDateUtc, now)) {
      out.push('prematch');
    }
    // Last chance: already LIVE but 1st inning not finished — still must get prematch bet
    if (opts.status === 'LIVE' && completed < 1) {
      out.push('prematch');
    }
  }

  if (completed >= 1) {
    const inn1 = by.get('inn1');
    if (!(inn1?.ok && inn1?.locked) && !inOddsBackoff(inn1, now)) {
      out.push('inn1');
    }
  }

  if (completed >= 2) {
    const inn2 = by.get('inn2');
    if (!(inn2?.ok && inn2?.locked) && !inOddsBackoff(inn2, now)) {
      out.push('inn2');
    }
  }

  return out;
}

/** LIVE games until inn1+inn2 secured (and last-chance prematch if missing). */
export function needsStageWatch(opts: {
  status: string;
  snapshots: StageLockRow[];
}): boolean {
  if (opts.status !== 'LIVE' && opts.status !== 'OTHER') return false;
  const by = new Map(opts.snapshots.map((s) => [s.stage, s]));
  const pmOk = by.get('prematch')?.ok === true;
  const inn1Ok = by.get('inn1')?.ok === true && by.get('inn1')?.locked === true;
  const inn2Ok = by.get('inn2')?.ok === true && by.get('inn2')?.locked === true;
  if (inn1Ok && inn2Ok && pmOk) return false;
  if (inn1Ok && inn2Ok && !pmOk) return false; // prematch missed forever after inn1 — stop
  return true;
}

/**
 * Odds are locked/ok but collection still wants another pass for that stage.
 * Kept for tests / tooling; pipeline no longer waits on ledger decisions.
 */
export function hasPendingLedgerDecision(opts: {
  snapshots: StageLockRow[];
  ledgerTracks: string[];
  stages?: F5OddsStage[];
}): boolean {
  const have = new Set(opts.ledgerTracks);
  const stages = opts.stages ?? (['prematch', 'inn1', 'inn2'] as F5OddsStage[]);
  const by = new Map(opts.snapshots.map((s) => [s.stage, s]));
  for (const stage of stages) {
    if (have.has(stage)) continue;
    const snap = by.get(stage);
    if (snap?.ok === true && snap?.locked === true) return true;
  }
  return false;
}
