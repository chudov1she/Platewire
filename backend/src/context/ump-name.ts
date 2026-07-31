/** Normalize umpire names for matching MLB Official ↔ UmpScorecards. */
export function normalizeUmpName(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function umpNameParts(nameKey: string): { first: string; last: string } {
  const parts = nameKey.split(' ').filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/**
 * Resolve best UmpScorecards name for an MLB official full name.
 * Prefer exact nameKey; else unique last-name + first-initial match.
 */
export function matchUmpScorecardName(
  officialFullName: string | null | undefined,
  candidates: Array<{ umpireName: string; nameKey: string }>,
): string | null {
  const key = normalizeUmpName(officialFullName);
  if (!key || !candidates.length) return null;

  const exact = candidates.find((c) => c.nameKey === key);
  if (exact) return exact.umpireName;

  const { first, last } = umpNameParts(key);
  if (!last) return null;
  const initial = first.charAt(0);
  const loose = candidates.filter((c) => {
    const p = umpNameParts(c.nameKey);
    return p.last === last && (!initial || p.first.charAt(0) === initial);
  });
  if (loose.length === 1) return loose[0]!.umpireName;
  return null;
}
