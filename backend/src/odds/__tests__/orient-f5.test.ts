import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { F5ExtractResult } from '../f5-extract.js';
import { orientF5ToMlbHome } from '../orient-f5.js';

const base: F5ExtractResult = {
  ok: true,
  moneyline: { home: 2.01, draw: 5.8, away: 2.5 },
  totals: [{ line: 4, over: 1.87, under: 1.94 }],
  handicaps: [
    { line: -1.5, home: 2.62, away: 1.41 },
    { line: -0.5, home: 1.9, away: 1.9 },
  ],
  main_total: { line: 4, over: 1.87, under: 1.94 },
  main_handicap: { line: -1.5, home: 2.62, away: 1.41 },
  missing: [],
  raw_f5_count: 4,
};

describe('orientF5ToMlbHome', () => {
  it('no-op when not flipped', () => {
    const r = orientF5ToMlbHome(base, false);
    assert.equal(r.moneyline?.home, 2.01);
    assert.equal(r.main_handicap?.line, -1.5);
  });

  it('swaps ML and negates handicap to MLB home', () => {
    const r = orientF5ToMlbHome(base, true);
    assert.deepEqual(r.moneyline, { home: 2.5, draw: 5.8, away: 2.01 });
    assert.equal(r.totals[0].line, 4);
    const h = r.handicaps.find((x) => x.line === 1.5);
    assert.ok(h);
    assert.equal(h!.home, 1.41);
    assert.equal(h!.away, 2.62);
    assert.equal(r.main_handicap?.line, 0.5);
  });
});
