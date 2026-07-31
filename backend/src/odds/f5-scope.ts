export type F5OddsStage = 'prematch' | 'inn1' | 'inn2';

export const F5_STAGES: F5OddsStage[] = ['prematch', 'inn1', 'inn2'];

export const F5_INNINGS = 5;

export function completedInnings(
  inning: number | null | undefined,
  _inningHalf?: string | null,
): number {
  void _inningHalf;
  if (inning == null) return 0;
  return Math.max(0, inning - 1);
}

export function f5IsComplete(
  inning: number | null | undefined,
  _inningHalf?: string | null,
): boolean {
  void _inningHalf;
  return inning != null && inning > F5_INNINGS;
}

export function f5WindowActive(
  inning: number | null | undefined,
  _inningHalf?: string | null,
): boolean {
  void _inningHalf;
  if (inning == null) return true;
  return inning <= F5_INNINGS;
}

/** Elapsed F5 innings including in-progress bottom half. */
export function elapsedF5Innings(
  inning: number | null | undefined,
  inningHalf?: string | null,
): number {
  if (inning == null) return 0;
  const half = (inningHalf || '').toLowerCase();
  if (half.startsWith('bot')) return inning;
  return Math.max(0, inning - 1);
}

export function liveF5RecalcActive(
  completed: number,
  opts?: { inning?: number | null; inningHalf?: string | null },
): boolean {
  if (f5IsComplete(opts?.inning, opts?.inningHalf)) return false;
  const elapsed =
    opts?.inning != null
      ? elapsedF5Innings(opts.inning, opts.inningHalf)
      : completed;
  if (elapsed <= 0) return false;
  return (
    elapsed < F5_INNINGS ||
    (opts?.inning === F5_INNINGS && !f5IsComplete(opts.inning, opts.inningHalf))
  );
}

export function remainingF5Innings(
  completed: number,
  opts?: { inning?: number | null; inningHalf?: string | null },
): number {
  if (f5IsComplete(opts?.inning, opts?.inningHalf)) return 0;
  const elapsed =
    opts?.inning != null
      ? elapsedF5Innings(opts.inning, opts.inningHalf)
      : completed;
  if (elapsed <= 0) return F5_INNINGS;
  const remaining = F5_INNINGS - elapsed;
  if (remaining <= 0 && opts?.inning === F5_INNINGS) return 1;
  return Math.max(0, remaining);
}

export function stageForGame(
  status: string,
  inning: number | null | undefined,
): F5OddsStage {
  const c = completedInnings(inning);
  if (c >= 2) return 'inn2';
  if (c >= 1) return 'inn1';
  void status;
  return 'prematch';
}

/** Stages that should be captured given current game state. */
export function dueStages(
  status: string,
  inning: number | null | undefined,
): F5OddsStage[] {
  const current = stageForGame(status, inning);
  if (current === 'inn2') return ['prematch', 'inn1', 'inn2'];
  if (current === 'inn1') return ['prematch', 'inn1'];
  return ['prematch'];
}

export function isF5OddsStage(value: string): value is F5OddsStage {
  return F5_STAGES.includes(value as F5OddsStage);
}
