import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Defect #8: the lineup landed truncated (7 of 11 for PHI).
 *
 * The Savant board listed two players on the same batting order (pinch-hitter
 * beside the starter), and GameLineupPlayer is unique on
 * (gameId, side, battingOrder). The duplicate INSERT aborted the whole write, so
 * everything after the collision was lost.
 *
 * The rows below are the real snapshot for PHI @ ATL (pk 849844).
 */
type Row = { batting_order: number; full_name: string; mlb_player_id: number | null };

const AWAY_SNAPSHOT: Row[] = [
  { batting_order: 1, full_name: 'Trea Turner', mlb_player_id: 607208 },
  { batting_order: 2, full_name: 'Kyle Schwarber', mlb_player_id: 656941 },
  { batting_order: 3, full_name: 'Bryce Harper', mlb_player_id: 547180 },
  { batting_order: 4, full_name: 'Alec Bohm', mlb_player_id: 664761 },
  { batting_order: 5, full_name: 'Bryson Stott', mlb_player_id: 681082 },
  { batting_order: 6, full_name: 'Bryan De La Cruz', mlb_player_id: 650559 },
  { batting_order: 7, full_name: 'Brandon Marsh', mlb_player_id: 669016 },
  { batting_order: 7, full_name: 'Edmundo Sosa', mlb_player_id: 624641 }, // duplicate order
  { batting_order: 8, full_name: 'J.T. Realmuto', mlb_player_id: 592663 },
  { batting_order: 9, full_name: 'Justin Crawford', mlb_player_id: 702222 },
  { batting_order: 9, full_name: 'Derek Hill', mlb_player_id: 656537 }, // duplicate order
];

/** The write rule as it stands in savant-preview.service.upsertLineupPlayers. */
function writeLineup(rows: Row[]) {
  const seen = new Set<number>();
  const stored: Row[] = [];
  const skipped: Row[] = [];
  for (const row of rows) {
    if (seen.has(row.batting_order)) {
      skipped.push(row);
      continue;
    }
    seen.add(row.batting_order);
    stored.push(row);
  }
  return { stored, skipped };
}

/** The old rule: insert everything, let the unique constraint abort the batch. */
function writeLineupOld(rows: Row[]) {
  const seen = new Set<number>();
  const stored: Row[] = [];
  for (const row of rows) {
    if (seen.has(row.batting_order)) {
      // insert fails -> the whole write stops here, dropping everything after
      return { stored, abortedAt: row.full_name };
    }
    seen.add(row.batting_order);
    stored.push(row);
  }
  return { stored, abortedAt: null };
}

describe('lineup write', () => {
  it('keeps every distinct batting order instead of stopping at the collision', () => {
    const { stored } = writeLineup(AWAY_SNAPSHOT);
    assert.equal(stored.length, 9, 'nine distinct orders must survive');
  });

  it('the old rule would have truncated at Brandon Marsh', () => {
    const old = writeLineupOld(AWAY_SNAPSHOT);
    assert.equal(old.stored.length, 7, 'reproduces the reported 7 of 11');
    assert.equal(old.abortedAt, 'Edmundo Sosa');
    const names = old.stored.map((r) => r.full_name);
    assert.ok(!names.includes('J.T. Realmuto'), 'Realmuto was lost');
    assert.ok(!names.includes('Derek Hill'), 'Derek Hill was lost');
  });

  it('reports the duplicates it dropped rather than losing them silently', () => {
    const { skipped } = writeLineup(AWAY_SNAPSHOT);
    assert.deepEqual(
      skipped.map((r) => r.full_name),
      ['Edmundo Sosa', 'Derek Hill'],
    );
  });

  it('keeps the first player on a shared order', () => {
    const { stored } = writeLineup(AWAY_SNAPSHOT);
    const seven = stored.find((r) => r.batting_order === 7);
    assert.equal(seven?.full_name, 'Brandon Marsh');
  });

  it('a clean board is written whole', () => {
    const clean = AWAY_SNAPSHOT.filter(
      (r) => r.full_name !== 'Edmundo Sosa' && r.full_name !== 'Derek Hill',
    );
    const { stored, skipped } = writeLineup(clean);
    assert.equal(stored.length, 9);
    assert.equal(skipped.length, 0);
  });

  it('a doubleheader-style empty board is harmless', () => {
    const { stored, skipped } = writeLineup([]);
    assert.equal(stored.length, 0);
    assert.equal(skipped.length, 0);
  });

  it('rows without an mlb id still claim their order, exactly like the DB', () => {
    // GameLineupPlayer is unique on (gameId, side, battingOrder) regardless of the
    // player id, so a placeholder row occupies the slot just the same.
    const rows: Row[] = [
      { batting_order: 1, full_name: 'A', mlb_player_id: null },
      { batting_order: 1, full_name: 'B', mlb_player_id: 111 },
    ];
    const { stored, skipped } = writeLineup(rows);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].full_name, 'A');
    assert.deepEqual(skipped.map((r) => r.full_name), ['B']);
  });
});
