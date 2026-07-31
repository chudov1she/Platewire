import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasPendingLedgerDecision,
  inPrematchWindow,
  needsStageWatch,
  stagesNeedingFreshCapture,
} from '../stage-needs.js';

describe('stagesNeedingFreshCapture', () => {
  const start = new Date('2026-07-30T12:00:00.000Z');

  it('prematch required inside T-60m until ok secured', () => {
    const now = new Date('2026-07-30T11:15:00.000Z');
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'PREVIEW',
        inning: null,
        gameDateUtc: start,
        now,
        snapshots: [],
      }),
      ['prematch'],
    );
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'PREVIEW',
        inning: null,
        gameDateUtc: start,
        now,
        snapshots: [{ stage: 'prematch', locked: true, ok: true }],
      }),
      [],
    );
  });

  it('no prematch 3h before start', () => {
    const now = new Date('2026-07-30T09:00:00.000Z');
    assert.ok(!inPrematchWindow(start, now));
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'PREVIEW',
        inning: null,
        gameDateUtc: start,
        now,
        snapshots: [],
      }),
      [],
    );
  });

  it('LIVE last-chance prematch if still missing before inn1', () => {
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'LIVE',
        inning: 1,
        snapshots: [],
      }),
      ['prematch'],
    );
  });

  it('catch-up 0→2 needs inn1 then inn2 as separate dues', () => {
    const due = stagesNeedingFreshCapture({
      status: 'LIVE',
      inning: 3,
      snapshots: [{ stage: 'prematch', locked: true, ok: true }],
    });
    assert.deepEqual(due, ['inn1', 'inn2']);
  });

  it('skips secured inn1', () => {
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'LIVE',
        inning: 3,
        snapshots: [
          { stage: 'prematch', locked: true, ok: true },
          { stage: 'inn1', locked: true, ok: true },
          { stage: 'inn2', locked: false, ok: false },
        ],
      }),
      ['inn2'],
    );
  });

  it('backs off failed odds scrape for 90s then will retry', () => {
    const now = new Date('2026-07-30T12:10:00.000Z');
    const due = stagesNeedingFreshCapture({
      status: 'LIVE',
      inning: 2,
      now,
      snapshots: [
        { stage: 'prematch', locked: true, ok: true },
        {
          stage: 'inn1',
          locked: false,
          ok: false,
          fetchedAt: new Date('2026-07-30T12:09:30.000Z'),
        },
      ],
    });
    assert.deepEqual(due, []);
  });
});

describe('hasPendingLedgerDecision', () => {
  it('true when prematch odds locked but no ledger row', () => {
    assert.equal(
      hasPendingLedgerDecision({
        snapshots: [{ stage: 'prematch', locked: true, ok: true }],
        ledgerTracks: [],
        stages: ['prematch'],
      }),
      true,
    );
  });

  it('false once prematch ledger exists', () => {
    assert.equal(
      hasPendingLedgerDecision({
        snapshots: [{ stage: 'prematch', locked: true, ok: true }],
        ledgerTracks: ['prematch'],
        stages: ['prematch'],
      }),
      false,
    );
  });

  it('false when odds not locked yet', () => {
    assert.equal(
      hasPendingLedgerDecision({
        snapshots: [{ stage: 'prematch', locked: false, ok: true }],
        ledgerTracks: [],
        stages: ['prematch'],
      }),
      false,
    );
  });
});

describe('needsStageWatch', () => {
  it('ignores PREVIEW', () => {
    assert.equal(
      needsStageWatch({ status: 'PREVIEW', snapshots: [] }),
      false,
    );
  });

  it('watches LIVE until required bets secured', () => {
    assert.equal(needsStageWatch({ status: 'LIVE', snapshots: [] }), true);
    assert.equal(
      needsStageWatch({
        status: 'LIVE',
        snapshots: [
          { stage: 'prematch', locked: true, ok: true },
          { stage: 'inn1', locked: true, ok: true },
          { stage: 'inn2', locked: true, ok: true },
        ],
      }),
      false,
    );
  });
});
