import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  digestLineupFingerprint,
  digestSpFingerprint,
  isPlayerSetLineupFingerprint,
  lineupSubstitutionDetected,
} from '../context-fingerprint.js';

describe('context-fingerprint', () => {
  it('digests lineup player sets stably (order ignored)', () => {
    const rows = [
      { side: 'home', mlbPlayerId: 2, battingOrder: 2, fullName: 'B' },
      { side: 'away', mlbPlayerId: 1, battingOrder: 1, fullName: 'A' },
      { side: 'home', mlbPlayerId: 3, battingOrder: 1, fullName: 'C' },
    ];
    const a = digestLineupFingerprint(rows);
    const b = digestLineupFingerprint(
      rows.map((r) =>
        r.mlbPlayerId === 2 ? { ...r, battingOrder: 9 } : r,
      ),
    );
    const c = digestLineupFingerprint([...rows].reverse());
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(a, c);
    assert.ok(isPlayerSetLineupFingerprint(a));
  });

  it('changes when a player is substituted', () => {
    const base = [
      { side: 'home', mlbPlayerId: 10, battingOrder: 1 },
      { side: 'away', mlbPlayerId: 20, battingOrder: 1 },
    ];
    const swapped = [
      { side: 'home', mlbPlayerId: 11, battingOrder: 1 },
      { side: 'away', mlbPlayerId: 20, battingOrder: 1 },
    ];
    const a = digestLineupFingerprint(base);
    const b = digestLineupFingerprint(swapped);
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a, b);
    assert.equal(
      lineupSubstitutionDetected({ previousFp: a, nextFp: b }),
      true,
    );
  });

  it('does not treat old order-based fp mismatch as substitution', () => {
    const next = digestLineupFingerprint([
      { side: 'home', mlbPlayerId: 1, battingOrder: 1 },
    ]);
    assert.equal(
      lineupSubstitutionDetected({
        previousFp: 'd054d48f90d578192c44820e',
        nextFp: next,
      }),
      false,
    );
  });

  it('returns null without confirmed batting orders', () => {
    assert.equal(
      digestLineupFingerprint([
        { side: 'home', mlbPlayerId: 1, battingOrder: null },
      ]),
      null,
    );
  });

  it('digests SP ids and changes when a pitcher swaps', () => {
    const a = digestSpFingerprint(10, 20);
    const b = digestSpFingerprint(10, 21);
    assert.ok(a);
    assert.ok(b);
    assert.notEqual(a, b);
  });
});
