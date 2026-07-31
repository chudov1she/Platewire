import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeStakeUnits,
  FLAT_STAKE_UNITS,
  kellyFraction,
} from '../stake-sizing.js';

describe('stake-sizing', () => {
  it('uses flat 50u (ignores edge and tier)', () => {
    assert.equal(computeStakeUnits(), FLAT_STAKE_UNITS);
    assert.equal(
      computeStakeUnits({
        modelProbPct: 95,
        decimalOdds: 2.0,
        confidenceTier: 'high',
      }),
      50,
    );
    assert.equal(
      computeStakeUnits({
        modelProbPct: 51,
        decimalOdds: 1.9,
        confidenceTier: 'low',
      }),
      50,
    );
  });

  it('kellyFraction is unused (always 0 under flat staking)', () => {
    assert.equal(kellyFraction(0.6, 2.0), 0);
  });
});