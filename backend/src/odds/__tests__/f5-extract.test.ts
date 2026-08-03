import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractF5Markets } from '../f5-extract.js';
import type { NormalizedMarket } from '../winline/normalize.js';

function m(partial: Partial<NormalizedMarket> & Pick<NormalizedMarket, 'type' | 'period' | 'name'>): NormalizedMarket {
  return {
    group: 'Основные',
    team: null,
    team_side: null,
    row: null,
    line: null,
    outcomes: [],
    ...partial,
  };
}

describe('extractF5Markets', () => {
  const fixture: NormalizedMarket[] = [
    m({
      name: 'Исход (после 5 ин.)',
      type: '1x2',
      period: 'after_5',
      home: 2.01,
      draw: 5.8,
      away: 2.5,
    }),
    m({
      name: 'Тотал (после 5 ин.)',
      type: 'total',
      period: 'after_5',
      line: 4,
      over: 1.87,
      under: 1.94,
    }),
    m({
      name: 'Тотал (после 5 ин.)',
      type: 'total',
      period: 'after_5',
      line: 3.5,
      over: 1.55,
      under: 2.35,
    }),
    m({
      name: 'Тотал (после 5 ин.) Тампа-Бэй',
      type: 'total',
      period: 'after_5',
      team: 'Тампа-Бэй',
      team_side: 'home',
      line: 2.5,
      over: 1.9,
      under: 1.9,
    }),
    m({
      name: 'Фора (после 5 ин.)',
      type: 'handicap',
      period: 'after_5',
      line: -1.5,
      home: 2.62,
      away: 1.41,
    }),
    m({
      name: 'Фора (после 5 ин.)',
      type: 'handicap',
      period: 'after_5',
      line: -0.5,
      home: 1.9,
      away: 1.9,
    }),
    m({
      name: 'Исход матча',
      type: '1x2',
      period: 'match',
      home: 1.8,
      away: 2.1,
    }),
  ];

  it('extracts after_5 ML, match totals, handicaps, team totals and main lines', () => {
    const r = extractF5Markets(fixture);
    assert.equal(r.ok, true);
    assert.deepEqual(r.moneyline, { home: 2.01, draw: 5.8, away: 2.5 });
    assert.equal(r.totals.length, 2);
    assert.equal(r.handicaps.length, 2);
    assert.deepEqual(r.main_total, { line: 4, over: 1.87, under: 1.94 });
    assert.deepEqual(r.main_handicap, {
      line: -1.5,
      home: 2.62,
      away: 1.41,
    });
    assert.equal(r.team_totals.home.length, 1);
    assert.deepEqual(r.main_team_total_home, {
      line: 2.5,
      over: 1.9,
      under: 1.9,
    });
    assert.ok(!r.missing.includes('team_total'));
  });

  it('excludes team totals from match totals but keeps them separately', () => {
    const r = extractF5Markets(fixture);
    assert.ok(!r.totals.some((t) => t.line === 2.5));
    assert.ok(r.team_totals.home.some((t) => t.line === 2.5));
  });

  it('ok=false when moneyline missing', () => {
    const r = extractF5Markets(
      fixture.filter((x) => x.type !== '1x2' || x.period !== 'after_5'),
    );
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes('moneyline'));
  });

  it('excludes hits totals from match totals', () => {
    const r = extractF5Markets([
      ...fixture,
      m({
        name: 'Тотал хитов (после 5 иннингов)',
        type: 'total',
        period: 'after_5',
        line: 3.5,
        over: 2.05,
        under: 1.71,
      }),
      m({
        name: 'Тотал хитов (после 5 иннингов) ТЕХ',
        type: 'total',
        period: 'after_5',
        line: 2.5,
        over: 1.37,
        under: 2.77,
      }),
    ]);
    assert.equal(r.totals.length, 2);
    assert.ok(!r.totals.some((t) => t.line === 3.5 && t.over === 2.05));
    assert.deepEqual(r.main_total, { line: 4, over: 1.87, under: 1.94 });
  });

  it('live main_total prefers balanced match run line not hits', () => {
    const r = extractF5Markets([
      m({
        name: 'Исход 1X2 (после 5 иннингов)',
        type: '1x2',
        period: 'after_5',
        home: 1.05,
        draw: 13,
        away: 13,
      }),
      m({
        name: 'Тотал хитов (после 5 иннингов)',
        type: 'total',
        period: 'after_5',
        line: 3.5,
        over: 2.05,
        under: 1.71,
      }),
      m({
        name: 'Тотал (после 5 ин.)',
        type: 'total',
        period: 'after_5',
        line: 5,
        over: 1.52,
        under: 2.42,
      }),
      m({
        name: 'Тотал (после 5 ин.)',
        type: 'total',
        period: 'after_5',
        line: 5.5,
        over: 1.83,
        under: 1.94,
      }),
      m({
        name: 'Тотал (после 5 ин.)',
        type: 'total',
        period: 'after_5',
        line: 6,
        over: 2.15,
        under: 1.65,
      }),
    ]);
    assert.deepEqual(
      r.totals.map((t) => t.line).sort((a, b) => a - b),
      [5, 5.5, 6],
    );
    assert.equal(r.main_total?.line, 5.5);
  });
});
