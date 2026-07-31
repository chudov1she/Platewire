import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  actualF5Outcome,
  extractF5RunsFromScoreboard,
  profitForResult,
  settleBetResult,
  toLedgerStatus,
} from '../f5-settle.js';

describe('f5-settle', () => {
  it('settles moneyline with tie push', () => {
    assert.equal(actualF5Outcome(2, 2), 'tie');
    assert.equal(
      settleBetResult({ market: 'moneyline', side: 'home', f5Home: 2, f5Away: 2 }),
      'PUSH',
    );
    assert.equal(
      settleBetResult({ market: 'moneyline', side: 'home', f5Home: 3, f5Away: 1 }),
      'WIN',
    );
    assert.equal(
      settleBetResult({ market: 'moneyline', side: 'away', f5Home: 3, f5Away: 1 }),
      'LOSE',
    );
  });

  it('settles totals over/under 4.5', () => {
    assert.equal(
      settleBetResult({ market: 'total', side: 'over', line: 4.5, f5Home: 3, f5Away: 2 }),
      'WIN',
    );
    assert.equal(
      settleBetResult({ market: 'total', side: 'under', line: 4.5, f5Home: 1, f5Away: 1 }),
      'WIN',
    );
  });

  it('settles runline', () => {
    assert.equal(
      settleBetResult({ market: 'runline', side: 'home', line: -1.5, f5Home: 4, f5Away: 1 }),
      'WIN',
    );
    assert.equal(
      settleBetResult({ market: 'runline', side: 'away', line: 1.5, f5Home: 4, f5Away: 1 }),
      'LOSE',
    );
  });

  it('computes profit', () => {
    assert.equal(profitForResult(100, 2.0, 'WIN'), 100);
    assert.equal(profitForResult(100, 2.0, 'LOSE'), -100);
    assert.equal(profitForResult(100, 2.0, 'PUSH'), 0);
    assert.equal(profitForResult(null, 2.0, 'WIN'), null);
    assert.equal(toLedgerStatus('LOSE'), 'loss');
  });

  it('extracts F5 runs from a savant-shaped scoreboard linescore', () => {
    const board = {
      linescore: {
        innings: [
          { num: 1, away: { runs: 1 }, home: { runs: 0 } },
          { num: 2, away: { runs: 0 }, home: { runs: 0 } },
          { num: 3, away: { runs: 0 }, home: { runs: 1 } },
          { num: 4, away: { runs: 1 }, home: { runs: 0 } },
          { num: 5, away: { runs: 0 }, home: { runs: 0 } },
          { num: 6, away: { runs: 2 }, home: { runs: 0 } },
        ],
      },
    };
    const f5 = extractF5RunsFromScoreboard(board);
    assert.equal(f5.away, 2);
    assert.equal(f5.home, 1);
  });

  it('returns nulls when fewer than 5 innings are present', () => {
    const f5 = extractF5RunsFromScoreboard({
      linescore: { innings: [{ num: 1, away: 1, home: 0 }] },
    });
    assert.equal(f5.home, null);
    assert.equal(f5.away, null);
  });

  it('extracts F5 runs from MLB StatsAPI linescore shape', () => {
    const linescore = {
      innings: [
        { num: 1, away: { runs: 0 }, home: { runs: 3 } },
        { num: 2, away: { runs: 0 }, home: { runs: 0 } },
        { num: 3, away: { runs: 0 }, home: { runs: 0 } },
        { num: 4, away: { runs: 0 }, home: { runs: 0 } },
        { num: 5, away: { runs: 0 }, home: { runs: 0 } },
        { num: 6, away: { runs: 0 }, home: { runs: 0 } },
        { num: 9, away: { runs: 0 }, home: { runs: 0 } },
      ],
    };
    const f5 = extractF5RunsFromScoreboard(linescore);
    assert.equal(f5.away, 0);
    assert.equal(f5.home, 3);
    assert.equal(
      settleBetResult({
        market: 'total',
        side: 'over',
        line: 4,
        f5Home: f5.home!,
        f5Away: f5.away!,
      }),
      'LOSE',
    );
  });
});
