import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  digestLineupFingerprint,
  digestSpFingerprint,
} from '../context-fingerprint.js';

describe('context-fingerprint', () => {
  it('digests lineup batting orders stably', () => {
    const rows = [
      { side: 'home', mlbPlayerId: 2, battingOrder: 2, fullName: 'B' },
      { side: 'away', mlbPlayerId: 1, battingOrder: 1, fullName: 'A' },
      { side: 'home', mlbPlayerId: 3, battingOrder: 1, fullName: 'C' },
    ];
    const a = digestLineupFingerprint(rows);
    const b = digestLineupFingerprint([...rows].reverse());
    assert.ok(a);
    assert.equal(a, b);
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
