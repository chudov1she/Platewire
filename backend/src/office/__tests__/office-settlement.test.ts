import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SETTLE_RETRY_MS, decideSettlement } from '../office-settlement.js';

describe('decideSettlement', () => {
  it('sends f5 once the sixth inning has started', () => {
    assert.equal(decideSettlement('LIVE', 6, null, 0), 'f5_settled');
  });

  it('waits out a fresh pending dispatch', () => {
    assert.equal(decideSettlement('LIVE', 6, 'f5_pending', 10_000), 'hold');
    assert.equal(decideSettlement('FINAL', 9, 'final_pending', 10_000), 'hold');
  });

  it('retries a pending dispatch after the window', () => {
    assert.equal(
      decideSettlement('LIVE', 6, 'f5_pending', SETTLE_RETRY_MS),
      'f5_settled',
    );
    assert.equal(
      decideSettlement('FINAL', 9, 'final_pending', SETTLE_RETRY_MS),
      'final',
    );
  });

  it('sends final only after f5 was confirmed', () => {
    assert.equal(decideSettlement('FINAL', 9, 'f5', 0), 'final');
    assert.equal(decideSettlement('LIVE', 7, 'f5', 0), 'hold');
  });

  it('voids a shortened final that never finished five innings', () => {
    assert.equal(decideSettlement('FINAL', 3, null, 0), 'final');
  });

  it('leaves an in-progress game open for lineup and stage events', () => {
    assert.equal(decideSettlement('LIVE', 2, null, 0), 'open');
  });

  it('stops after the final ack', () => {
    assert.equal(decideSettlement('FINAL', 9, 'final', 0), 'hold');
  });
});
