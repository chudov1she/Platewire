/** Normalize MLB officialType strings to canonical roles. */
export function normalizeOfficialRole(raw?: string): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (/home\s*plate/i.test(text) || text === 'HP') return 'Home Plate';
  if (/first/i.test(text) || text === '1B') return 'First Base';
  if (/second/i.test(text) || text === '2B') return 'Second Base';
  if (/third/i.test(text) || text === '3B') return 'Third Base';
  if (/left/i.test(text)) return 'Left Field';
  if (/right/i.test(text)) return 'Right Field';
  return text;
}
