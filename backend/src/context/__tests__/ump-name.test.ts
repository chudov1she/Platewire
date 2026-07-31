import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  matchUmpScorecardName,
  normalizeUmpName,
} from '../ump-name.js';

describe('ump-name', () => {
  it('normalizes suffixes and punctuation', () => {
    assert.equal(normalizeUmpName('Ron Kulpa Jr.'), 'ron kulpa');
    assert.equal(normalizeUmpName('José  Ortiz'), 'jose ortiz');
  });

  it('matches exact and loose last+initial', () => {
    const candidates = [
      { umpireName: 'Ron Kulpa', nameKey: 'ron kulpa' },
      { umpireName: 'Angel Hernandez', nameKey: 'angel hernandez' },
    ];
    assert.equal(matchUmpScorecardName('Ron Kulpa', candidates), 'Ron Kulpa');
    assert.equal(matchUmpScorecardName('R. Kulpa', candidates), 'Ron Kulpa');
    assert.equal(matchUmpScorecardName('Unknown Ump', candidates), null);
  });
});
