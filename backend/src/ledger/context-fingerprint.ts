import { createHash } from 'node:crypto';

export type LineupFpRow = {
  side: string;
  mlbPlayerId: number | null;
  battingOrder: number | null;
  fullName?: string | null;
};

/** SHA256[:24] of confirmed batting orders — port of baseballai lineup_fingerprint. */
export function digestLineupFingerprint(rows: LineupFpRow[]): string | null {
  const parts: string[] = [];
  for (const row of [...rows].sort((a, b) => {
    const side = a.side.localeCompare(b.side);
    if (side !== 0) return side;
    return (a.battingOrder ?? 0) - (b.battingOrder ?? 0);
  })) {
    if (row.battingOrder == null) continue;
    const id = row.mlbPlayerId ?? row.fullName;
    if (id == null || id === '') continue;
    parts.push(`${row.side}:${id}:${row.battingOrder}`);
  }
  if (!parts.length) return null;
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
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
