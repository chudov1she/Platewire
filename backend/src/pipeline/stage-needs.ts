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
 * Long enough to avoid ban spam; short enough to still guarantee a line.
 */
export const ODDS_SCRAPE_BACKOFF_MS = 90 * 1000;

/** Minimum gap between successful scrapes of the current stage. */
export const ODDS_REFRESH_MS = 60 * 1000;

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

function latestByStage(snapshots: StageLockRow[]): Map<string, StageLockRow> {
  const by = new Map<string, StageLockRow>();
  for (const snap of snapshots) {
    const prev = by.get(snap.stage);
    const prevAt = prev?.fetchedAt?.getTime() ?? -1;
    const at = snap.fetchedAt?.getTime() ?? -1;
    if (!prev || at >= prevAt) by.set(snap.stage, snap);
  }
  return by;
}

function currentStage(inning: number | null): F5OddsStage {
  const completed = completedInnings(inning);
  if (completed >= 2) return 'inn2';
  if (completed >= 1) return 'inn1';
  return 'prematch';
}

function inOddsBackoff(snap: StageLockRow | undefined, now: Date): boolean {
  if (!snap?.fetchedAt || snap.ok) return false;
  return now.getTime() - snap.fetchedAt.getTime() < ODDS_SCRAPE_BACKOFF_MS;
}

function refreshedRecently(snap: StageLockRow | undefined, now: Date): boolean {
  if (!snap?.ok || !snap.fetchedAt) return false;
  return now.getTime() - snap.fetchedAt.getTime() < ODDS_REFRESH_MS;
}

/**
 * Current odds window that still needs a fresh Winline read.
 * A previous ok snapshot does not freeze the stage; it only pauses the next
 * scrape for ODDS_REFRESH_MS. FINAL games are not captured.
 */
export function stagesNeedingFreshCapture(opts: {
  status: string;
  inning: number | null;
  snapshots: StageLockRow[];
  gameDateUtc?: Date | null;
  now?: Date;
}): F5OddsStage[] {
  if (opts.status === 'FINAL') return [];
  const now = opts.now ?? new Date();
  const stage = currentStage(opts.inning);
  const completed = completedInnings(opts.inning);

  if (stage === 'prematch') {
    const inWindow =
      opts.status === 'PREVIEW' && inPrematchWindow(opts.gameDateUtc, now);
    const liveEarly =
      (opts.status === 'LIVE' || opts.status === 'OTHER') && completed < 1;
    if (!inWindow && !liveEarly) return [];
  } else if (opts.status !== 'LIVE' && opts.status !== 'OTHER') {
    return [];
  }

  const snap = latestByStage(opts.snapshots).get(stage);
  if (inOddsBackoff(snap, now) || refreshedRecently(snap, now)) return [];
  return [stage];
}

/** LIVE games keep a stage watch until the game is final. */
export function needsStageWatch(opts: {
  status: string;
  snapshots?: StageLockRow[];
}): boolean {
  void opts.snapshots;
  return opts.status === 'LIVE' || opts.status === 'OTHER';
}
