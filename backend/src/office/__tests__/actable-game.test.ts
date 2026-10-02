import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SYNTHETIC_PK_FROM, isActableGame } from '../actable-game.js';

/**
 * Defect #16. A rehearsal game (pk 990001, statusDetail 'Synthetic', status LIVE)
 * was picked up by the stage watch, reached the production listener, and a real
 * stake of 10 units was sent for a match that does not exist.
 *
 * The gate lives in one place so the pipeline universe and office.consider agree:
 * five call sites reach office.consider without going through the universe.
 */
describe('isActableGame', () => {
  it('rejects the synthetic game that got through', () => {
    assert.equal(
      isActableGame({ mlbGamePk: 990001, statusDetail: 'Synthetic' }),
      false,
    );
  });

  it('rejects any pk in the rehearsal range', () => {
    assert.equal(isActableGame({ mlbGamePk: SYNTHETIC_PK_FROM }), false);
    assert.equal(isActableGame({ mlbGamePk: 999999 }), false);
  });

  it('rejects a game whose status names it synthetic, whatever its pk', () => {
    assert.equal(
      isActableGame({ mlbGamePk: 849844, statusDetail: 'Synthetic LIVE' }),
      false,
    );
    assert.equal(
      isActableGame({ mlbGamePk: 849844, statusDetail: 'synthetic preview' }),
      false,
    );
  });

  it('accepts the real game the office did act on', () => {
    assert.equal(
      isActableGame({ mlbGamePk: 849844, statusDetail: 'Scheduled' }),
      true,
    );
  });

  it('accepts a real id right below the boundary', () => {
    assert.equal(isActableGame({ mlbGamePk: 989999 }), true);
  });

  it('accepts a game with no status detail', () => {
    assert.equal(isActableGame({ mlbGamePk: 849844 }), true);
    assert.equal(isActableGame({ mlbGamePk: 849844, statusDetail: null }), true);
  });

  it('does not reject a real game just because the word appears elsewhere', () => {
    // 'Synthetic' must be the detail of THIS game, not a substring coincidence
    // in another field — the gate only sees statusDetail.
    assert.equal(isActableGame({ mlbGamePk: 849844, statusDetail: 'Final' }), true);
  });
});
