import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyBook, orientBook } from '../book.js';
import type { NormalizedMarket } from '../winline/normalize.js';

function m(
  partial: Partial<NormalizedMarket> & Pick<NormalizedMarket, 'type' | 'period' | 'name'>,
): NormalizedMarket {
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

describe('classifyBook', () => {
  const markets: NormalizedMarket[] = [
    m({
      name: 'Исход (после 5 ин.)',
      type: '1x2',
      period: 'after_5',
      home: 2.09,
      draw: 5.2,
      away: 2.49,
    }),
    m({
      name: 'Тотал (после 5 ин.)',
      type: 'total',
      period: 'after_5',
      line: 3.5,
      over: 1.81,
      under: 2.01,
    }),
    m({
      name: 'Тотал (после 5 ин.)',
      type: 'total',
      period: 'after_5',
      line: 4,
      over: 2.1,
      under: 1.7,
    }),
    m({
      name: 'Тотал (после 5 ин.) Атланта',
      type: 'total',
      period: 'after_5',
      team: 'Атланта',
      team_side: 'home',
      line: 2,
      over: 1.9,
      under: 1.9,
    }),
    m({
      name: 'Тотал хитов (после 5 иннингов)',
      type: 'total',
      period: 'after_5',
      line: 4.5,
      over: 1.95,
      under: 1.85,
    }),
    m({
      name: 'Тотал хитов (после 5 иннингов) Филадельфия',
      type: 'total',
      period: 'after_5',
      team: 'Филадельфия',
      team_side: 'away',
      line: 2.5,
      over: 1.7,
      under: 2.1,
    }),
    m({
      name: 'Фора (после 5 ин.)',
      type: 'handicap',
      period: 'after_5',
      line: -1,
      home: 1.48,
      away: 2.47,
    }),
    m({
      name: 'Исход матча',
      type: '1x2',
      period: 'match',
      home: 1.7,
      away: 2.2,
    }),
  ];

  it('keeps every priced line and labels kind, period, stat and side', () => {
    const book = classifyBook(markets);
    assert.equal(book.length, 8);

    const ml = book.find((q) => q.kind === 'moneyline' && q.period === 'after_5');
    assert.equal(ml?.side, 'match');
    assert.equal(ml?.stat, 'runs');
    assert.equal(ml?.home, 2.09);

    const totals = book.filter((q) => q.kind === 'total');
    assert.deepEqual(
      totals.map((q) => q.line),
      [3.5, 4],
    );
    assert.ok(totals.every((q) => q.stat === 'runs' && q.side === 'match'));

    const team = book.find((q) => q.kind === 'team_total');
    assert.equal(team?.side, 'home');
    assert.equal(team?.line, 2);

    const hits = book.find((q) => q.kind === 'hits_total');
    assert.equal(hits?.stat, 'hits');
    assert.equal(hits?.line, 4.5);
    assert.notEqual(hits?.kind, 'total');

    const teamHits = book.find((q) => q.kind === 'team_hits');
    assert.equal(teamHits?.side, 'away');

    const hcp = book.find((q) => q.kind === 'handicap');
    assert.equal(hcp?.line, -1);
    assert.equal(hcp?.side, 'match');

    const matchMl = book.find((q) => q.kind === 'moneyline' && q.period === 'match');
    assert.equal(matchMl?.away, 2.2);
  });

  it('does not guess a team side when the name is unbound', () => {
    const book = classifyBook([
      m({
        name: 'Тотал (после 5 ин.) Неизвестные',
        type: 'total',
        period: 'after_5',
        team: 'Неизвестные',
        line: 2.5,
        over: 1.8,
        under: 2,
      }),
    ]);
    assert.equal(book[0]?.kind, 'team_total');
    assert.equal(book[0]?.side, null);
  });
});

describe('orientBook', () => {
  it('swaps MLB sides and negates the handicap line', () => {
    const book = orientBook(
      classifyBook([
        m({
          name: 'Исход (после 5 ин.)',
          type: '1x2',
          period: 'after_5',
          home: 2.09,
          away: 2.49,
        }),
        m({
          name: 'Фора (после 5 ин.)',
          type: 'handicap',
          period: 'after_5',
          line: -1,
          home: 1.48,
          away: 2.47,
        }),
        m({
          name: 'Тотал (после 5 ин.)',
          type: 'total',
          period: 'after_5',
          line: 3.5,
          over: 1.81,
          under: 2.01,
        }),
        m({
          name: 'Тотал (после 5 ин.) Хозяева',
          type: 'total',
          period: 'after_5',
          team_side: 'home',
          line: 2,
          over: 1.9,
          under: 1.9,
        }),
      ]),
      true,
    );

    const ml = book.find((q) => q.kind === 'moneyline');
    assert.equal(ml?.home, 2.49);
    assert.equal(ml?.away, 2.09);

    const hcp = book.find((q) => q.kind === 'handicap');
    assert.equal(hcp?.line, 1);
    assert.equal(hcp?.home, 2.47);
    assert.equal(hcp?.away, 1.48);

    const total = book.find((q) => q.kind === 'total');
    assert.equal(total?.over, 1.81);
    assert.equal(total?.line, 3.5);

    const team = book.find((q) => q.kind === 'team_total');
    assert.equal(team?.side, 'away');
  });
});
