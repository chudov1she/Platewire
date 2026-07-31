import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  completedInnings,
  dueStages,
  stageForGame,
} from '../f5-scope.js';
import { decideF5StageWrite } from '../f5-stage.rules.js';

describe('f5-scope', () => {
  it('completedInnings from current inning', () => {
    assert.equal(completedInnings(null), 0);
    assert.equal(completedInnings(1), 0);
    assert.equal(completedInnings(2), 1);
    assert.equal(completedInnings(3), 2);
  });

  it('stageForGame', () => {
    assert.equal(stageForGame('PREVIEW', null), 'prematch');
    assert.equal(stageForGame('LIVE', 1), 'prematch');
    assert.equal(stageForGame('LIVE', 2), 'inn1');
    assert.equal(stageForGame('LIVE', 3), 'inn2');
  });

  it('dueStages', () => {
    assert.deepEqual(dueStages('PREVIEW', null), ['prematch']);
    assert.deepEqual(dueStages('LIVE', 2), ['prematch', 'inn1']);
    assert.deepEqual(dueStages('LIVE', 4), ['prematch', 'inn1', 'inn2']);
  });
});

describe('decideF5StageWrite', () => {
  it('skips locked without force', () => {
    const d = decideF5StageWrite({
      stage: 'inn1',
      existingLocked: true,
      extractOk: true,
      force: false,
      gameStatus: 'LIVE',
      completedInnings: 1,
    });
    assert.equal(d.action, 'skip');
  });

  it('writes and locks inn1', () => {
    const d = decideF5StageWrite({
      stage: 'inn1',
      existingLocked: false,
      extractOk: true,
      force: false,
      gameStatus: 'LIVE',
      completedInnings: 1,
    });
    assert.equal(d.action, 'write');
    if (d.action === 'write') {
      assert.equal(d.lockAfter, true);
      assert.equal(d.lockPrematch, true);
    }
  });

  it('prematch locks on first successful capture', () => {
    const d = decideF5StageWrite({
      stage: 'prematch',
      existingLocked: false,
      extractOk: true,
      force: false,
      gameStatus: 'PREVIEW',
      completedInnings: 0,
    });
    assert.equal(d.action, 'write');
    if (d.action === 'write') {
      assert.equal(d.lockAfter, true);
    }
  });

  it('skips incomplete extract without force', () => {
    const d = decideF5StageWrite({
      stage: 'prematch',
      existingLocked: false,
      extractOk: false,
      force: false,
      gameStatus: 'PREVIEW',
      completedInnings: 0,
    });
    assert.equal(d.action, 'skip');
  });
});
