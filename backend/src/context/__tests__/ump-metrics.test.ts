import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeOfficialRole } from '../official-role.js';
import { computeUmpRates } from '../ump-metrics.js';
import { CONTEXT_UMP_MIN_GAMES } from '../../common/context.constants.js';

describe('normalizeOfficialRole', () => {
  it('maps HP aliases', () => {
    assert.equal(normalizeOfficialRole('Home Plate'), 'Home Plate');
    assert.equal(normalizeOfficialRole('HP'), 'Home Plate');
    assert.equal(normalizeOfficialRole('home plate umpire'), 'Home Plate');
  });

  it('maps base roles', () => {
    assert.equal(normalizeOfficialRole('1B'), 'First Base');
    assert.equal(normalizeOfficialRole('Second Base'), 'Second Base');
    assert.equal(normalizeOfficialRole('3B'), 'Third Base');
  });
});

describe('computeUmpRates', () => {
  it('computes called strike/ball and K/BB rates', () => {
    const r = computeUmpRates([
      { description: 'called_strike', events: null },
      { description: 'called_strike', events: null },
      { description: 'ball', events: null },
      { description: 'swinging_strike', events: 'strikeout' },
      { description: 'hit_into_play', events: 'walk' },
    ]);
    assert.equal(r.calledStrikes, 2);
    assert.equal(r.calledBalls, 1);
    assert.equal(r.strikeouts, 1);
    assert.equal(r.walks, 1);
    assert.ok(r.calledStrikeRate != null);
    assert.equal(Math.round(r.calledStrikeRate! * 1000) / 1000, 0.667);
    assert.equal(r.kRate, 0.5);
  });

  it('ready threshold constant is 15', () => {
    assert.equal(CONTEXT_UMP_MIN_GAMES, 15);
    assert.equal(4 >= CONTEXT_UMP_MIN_GAMES, false);
    assert.equal(15 >= CONTEXT_UMP_MIN_GAMES, true);
  });
});
