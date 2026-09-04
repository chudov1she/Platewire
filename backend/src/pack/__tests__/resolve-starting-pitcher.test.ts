import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStartingPitcherId } from '../matchup-inputs.service.js';

describe('resolveStartingPitcherId', () => {
  it('prefers MLB probable id', () => {
    const id = resolveStartingPitcherId(607259, [
      { mlb_player_id: 702047, era: null, games_started: 0 },
      { mlb_player_id: 607259, era: 2.45, games_started: 20 },
    ]);
    assert.equal(id, 607259);
  });

  it('falls back to pitcher with ERA and most GS', () => {
    const id = resolveStartingPitcherId(null, [
      { mlb_player_id: 702047, era: null, games_started: 0 },
      { mlb_player_id: 571927, era: 6.07, games_started: 10 },
      { mlb_player_id: 607259, era: 2.45, games_started: 20 },
    ]);
    assert.equal(id, 607259);
  });
});
