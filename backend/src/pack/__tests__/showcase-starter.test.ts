import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveStartingPitcherId } from '../matchup-inputs.service.js';

/**
 * Defect #4: the pack showcase took pitchers[0] from the Savant snapshot, so it
 * named Dylan Dodd / Jesús Luzardo while the maths read Ray Kerr / Aaron Nola off
 * the MLB probable. The showcase now resolves the id the same way the maths does.
 *
 * These cases mirror context.service.buildPack's selection.
 */
function pickShowcase(
  probableId: number | null,
  pitchers: Array<{ mlb_player_id: number | null; era: number | null; games_started: number | null }>,
) {
  const expectedId = resolveStartingPitcherId(probableId, pitchers);
  const list = pitchers ?? [];
  return (
    (expectedId != null ? list.find((p) => p.mlb_player_id === expectedId) : null) ??
    list[0] ??
    null
  );
}

// The real Savant board for PHI @ ATL: the probable is not first in the list.
const ATL_PITCHERS = [
  { mlb_player_id: 689266, era: 0.0, games_started: 0 }, // Dylan Dodd, no stats
  { mlb_player_id: 678061, era: 1.47, games_started: 12 }, // Ray Kerr, the probable
];
const PHI_PITCHERS = [
  { mlb_player_id: 666200, era: 0.0, games_started: 1 }, // Jesús Luzardo
  { mlb_player_id: 605400, era: 4.67, games_started: 27 }, // Aaron Nola, the probable
];

describe('pack showcase starter', () => {
  it('names the MLB probable, not pitchers[0]', () => {
    const home = pickShowcase(678061, ATL_PITCHERS);
    const away = pickShowcase(605400, PHI_PITCHERS);
    assert.equal(home?.mlb_player_id, 678061, 'ATL showcase must be Ray Kerr');
    assert.equal(away?.mlb_player_id, 605400, 'PHI showcase must be Aaron Nola');
  });

  it('no longer returns the no-stats call-up that the defect reported', () => {
    const home = pickShowcase(678061, ATL_PITCHERS);
    assert.notEqual(home?.mlb_player_id, 689266, 'Dylan Dodd must not be the showcase');
    const away = pickShowcase(605400, PHI_PITCHERS);
    assert.notEqual(away?.mlb_player_id, 666200, 'Jesús Luzardo must not be the showcase');
  });

  it('agrees with the maths for the same inputs', () => {
    const mathsHome = resolveStartingPitcherId(678061, ATL_PITCHERS);
    const showcaseHome = pickShowcase(678061, ATL_PITCHERS)?.mlb_player_id;
    assert.equal(showcaseHome, mathsHome);
  });

  it('falls back to the best Savant pitcher when the probable is unknown', () => {
    const home = pickShowcase(null, ATL_PITCHERS);
    assert.equal(home?.mlb_player_id, 678061, 'most games started wins');
  });

  it('falls back to the first entry when nothing has stats', () => {
    const list = [{ mlb_player_id: 111, era: null, games_started: null }];
    assert.equal(pickShowcase(null, list)?.mlb_player_id, 111);
  });

  it('survives an empty pitcher list', () => {
    assert.equal(pickShowcase(678061, []), null);
  });
});
