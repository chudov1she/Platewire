import { createHash } from 'node:crypto';

export type LineupFpRow = {
  side: string;
  mlbPlayerId: number | null;
  battingOrder: number | null;
  fullName?: string | null;
};

/** Prefix so we can migrate off the old order-sensitive digest without a mass recalc. */
export const LINEUP_FP_PLAYER_SET_PREFIX = 'ps:';

/**
 * Fingerprint of *who* is in the confirmed lineup (per side), not batting order.
 * Recalc should fire only when a player is substituted — order reshuffles are ignored.
 */
export function digestLineupFingerprint(rows: LineupFpRow[]): string | null {
  const parts = new Set<string>();
  for (const row of rows) {
    // Still require a confirmed batting-order slot (same gate as before).
    if (row.battingOrder == null) continue;
    const id = row.mlbPlayerId ?? row.fullName;
    if (id == null || id === '') continue;
    parts.add(`${row.side}:${id}`);
  }
  if (!parts.size) return null;
  const key = [...parts].sort().join('|');
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${LINEUP_FP_PLAYER_SET_PREFIX}${hash}`;
}

/** True when stored fp is the new player-set format. */
export function isPlayerSetLineupFingerprint(
  fp: string | null | undefined,
): boolean {
  return typeof fp === 'string' && fp.startsWith(LINEUP_FP_PLAYER_SET_PREFIX);
}

/**
 * Lineup identity changed enough to warrant a bet recalc.
 * Old order-based fingerprints are treated as a one-time reseed (no recalc).
 */
export function lineupSubstitutionDetected(opts: {
  previousFp: string | null | undefined;
  nextFp: string | null | undefined;
}): boolean {
  const { previousFp, nextFp } = opts;
  if (nextFp == null || previousFp == null) return false;
  if (!isPlayerSetLineupFingerprint(previousFp)) return false;
  return previousFp !== nextFp;
}

/** SHA256[:24] of probable starting pitchers (home/away mlb ids). */
export function digestSpFingerprint(
  homePitcherId: number | null | undefined,
  awayPitcherId: number | null | undefined,
): string | null {
  if (homePitcherId == null && awayPitcherId == null) return null;
  const key = `home:${homePitcherId ?? 'none'}|away:${awayPitcherId ?? 'none'}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}
