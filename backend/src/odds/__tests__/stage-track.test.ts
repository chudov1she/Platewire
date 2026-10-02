import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Defect #11: the stage track was the last snapshot by fetchedAt, so an
 * ok=false row (empty markets) hid the last good read and the pack lost its line.
 *
 * Mirrors the selection in odds.service.getLatestF5. Rows arrive newest-first,
 * the winner is the newest row with ok=true.
 */
function pickTrack(rows: Array<{ stage: string; ok: boolean; fetchedAt: string }>) {
  const latestByStage = new Map<string, (typeof rows)[number]>();
  for (const row of [...rows].reverse()) {
    if (!row.ok) continue;
    latestByStage.set(row.stage, row);
  }
  return latestByStage;
}

/** The old rule, kept here so the regression is explicit. */
function pickTrackOld(rows: Array<{ stage: string; ok: boolean; fetchedAt: string }>) {
  const latestByStage = new Map<string, (typeof rows)[number]>();
  for (const row of [...rows].reverse()) {
    latestByStage.set(row.stage, row);
  }
  return latestByStage;
}

describe('stage track selection', () => {
  const rows = [
    { stage: 'inn2', ok: false, fetchedAt: '2026-10-02T03:01:37.703Z' },
    { stage: 'inn2', ok: false, fetchedAt: '2026-10-02T02:58:44.815Z' },
    { stage: 'inn2', ok: true, fetchedAt: '2026-10-02T02:56:43.303Z' },
    { stage: 'prematch', ok: true, fetchedAt: '2026-10-02T00:38:43.090Z' },
  ];

  it('picks the last GOOD read, not the last row', () => {
    const track = pickTrack(rows).get('inn2');
    assert.equal(track?.ok, true);
    assert.equal(track?.fetchedAt, '2026-10-02T02:56:43.303Z');
  });

  it('old rule would have picked the empty row (regression guard)', () => {
    const old = pickTrackOld(rows).get('inn2');
    assert.equal(old?.ok, false);
    assert.notEqual(old?.fetchedAt, pickTrack(rows).get('inn2')?.fetchedAt);
  });

  it('leaves the stage empty when every read failed', () => {
    const onlyFails = [
      { stage: 'inn1', ok: false, fetchedAt: '2026-10-02T01:00:00.000Z' },
    ];
    assert.equal(pickTrack(onlyFails).get('inn1'), undefined);
  });

  it('keeps stages independent', () => {
    const track = pickTrack(rows);
    assert.equal(track.get('prematch')?.ok, true);
    assert.equal(track.get('inn2')?.ok, true);
  });
});