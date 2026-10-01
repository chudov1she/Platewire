import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inPrematchWindow,
  needsStageWatch,
  ODDS_REFRESH_MS,
  stagesNeedingFreshCapture,
} from '../stage-needs.js';

describe('stagesNeedingFreshCapture', () => {
  const start = new Date('2026-07-30T12:00:00.000Z');

  it('prematch required inside T-60m until a recent ok snapshot', () => {
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
        snapshots: [
          {
            stage: 'prematch',
            locked: true,
            ok: true,
            fetchedAt: new Date(now.getTime() - 5_000),
          },
        ],
      }),
      [],
    );
  });

  it('refreshes prematch again after the refresh gap even if a prior snap is locked', () => {
    const now = new Date('2026-07-30T11:15:00.000Z');
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'PREVIEW',
        inning: null,
        gameDateUtc: start,
        now,
        snapshots: [
          {
            stage: 'prematch',
            locked: true,
            ok: true,
            fetchedAt: new Date(now.getTime() - ODDS_REFRESH_MS - 1_000),
          },
        ],
      }),
      ['prematch'],
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

  it('LIVE early window still captures prematch', () => {
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'LIVE',
        inning: 1,
        snapshots: [],
      }),
      ['prematch'],
    );
  });

  it('live after two innings refreshes only the current inn2 window', () => {
    const due = stagesNeedingFreshCapture({
      status: 'LIVE',
      inning: 3,
      snapshots: [{ stage: 'prematch', locked: true, ok: true }],
    });
    assert.deepEqual(due, ['inn2']);
  });

  it('skips a fresh inn2 snapshot and ignores older locked inn1', () => {
    const now = new Date('2026-07-30T13:00:00.000Z');
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'LIVE',
        inning: 3,
        now,
        snapshots: [
          { stage: 'prematch', locked: true, ok: true, fetchedAt: now },
          { stage: 'inn1', locked: true, ok: true, fetchedAt: now },
          {
            stage: 'inn2',
            locked: false,
            ok: true,
            fetchedAt: new Date(now.getTime() - 5_000),
          },
        ],
      }),
      [],
    );
  });

  it('backs off a failed odds scrape for 90s then will retry', () => {
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

  it('does not capture a final game', () => {
    assert.deepEqual(
      stagesNeedingFreshCapture({
        status: 'FINAL',
        inning: 9,
        snapshots: [],
      }),
      [],
    );
  });
});

describe('needsStageWatch', () => {
  it('ignores PREVIEW and FINAL', () => {
    assert.equal(needsStageWatch({ status: 'PREVIEW', snapshots: [] }), false);
    assert.equal(needsStageWatch({ status: 'FINAL', snapshots: [] }), false);
  });

  it('watches LIVE even after every stage already has a snapshot', () => {
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
      true,
    );
  });
});
