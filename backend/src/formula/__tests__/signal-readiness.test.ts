import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InputSource, MarketLine } from '../formula.types.js';
import { marketsComplete } from '../market-loader.service.js';
import { computeScore, evaluateReadiness } from '../signal-readiness.service.js';

function feature(ready = true): InputSource {
  return { value: 0.75, source: 'feature', ready };
}

function def(): InputSource {
  return { value: 0.72, source: 'default', ready: false };
}

function completeMl(): MarketLine[] {
  return [
    { market: 'moneyline', side: 'home', decimal_odds: 1.9 },
    { market: 'moneyline', side: 'away', decimal_odds: 2.0 },
  ];
}

function readySources(): Record<string, InputSource> {
  return {
    home_ops: feature(),
    away_ops: feature(),
    home_sp_era: feature(),
    away_sp_era: feature(),
    ump_strike_zone_pct: { value: 0.48, source: 'feature', ready: true },
    temperature_f: { value: 75, source: 'mlb_weather' },
  };
}

describe('marketsComplete', () => {
  it('requires both ML sides', () => {
    assert.equal(
      marketsComplete([{ market: 'moneyline', side: 'home', decimal_odds: 1.9 }]),
      false,
    );
    assert.equal(marketsComplete(completeMl()), true);
  });

  it('requires over+under for total', () => {
    assert.equal(
      marketsComplete([{ market: 'total', side: 'over', decimal_odds: 1.9, line: 4.5 }]),
      false,
    );
    assert.equal(
      marketsComplete([
        { market: 'total', side: 'over', decimal_odds: 1.9, line: 4.5 },
        { market: 'total', side: 'under', decimal_odds: 1.9, line: 4.5 },
      ]),
      true,
    );
  });
});

describe('signal-readiness', () => {
  it('feature ready + locked odds -> ready, high score', () => {
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: readySources(),
      market: { markets: completeMl(), marketsUsed: true, locked: true, source: 'winline' },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, true);
    assert.equal(r.hardGaps.length, 0);
    assert.ok(r.score >= 90);
  });

  it('one OPS default -> hard gap, !ready', () => {
    const sources = readySources();
    sources.home_ops = def();
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: sources,
      market: { markets: completeMl(), marketsUsed: true, locked: true, source: 'winline' },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, false);
    assert.ok(r.hardGaps.includes('home:OPS=default'));
    assert.equal(r.inputsReady, false);
  });

  it('incomplete ML -> incomplete gap', () => {
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: readySources(),
      market: {
        markets: [{ market: 'moneyline', side: 'home', decimal_odds: 1.9 }],
        marketsUsed: true,
        locked: true,
        source: 'winline',
      },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, false);
    assert.ok(r.hardGaps.includes('odds:prematch=incomplete'));
  });

  it('missing odds -> missing gap', () => {
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: readySources(),
      market: { markets: [], marketsUsed: false, locked: false, source: null },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, false);
    assert.ok(r.hardGaps.includes('odds:prematch=missing'));
  });

  it('soft ump only -> ready with softGaps', () => {
    const sources = readySources();
    sources.ump_strike_zone_pct = { value: null, source: 'default', ready: false };
    sources.temperature_f = { value: 72, source: 'default' };
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: sources,
      market: { markets: completeMl(), marketsUsed: true, locked: true, source: 'winline' },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, true);
    assert.deepEqual(r.softGaps, ['ump:default', 'weather:neutral']);
    assert.equal(r.score, 90);
  });

  it('zone default but UmpScorecards present -> ump_zone soft gap only', () => {
    const sources = readySources();
    sources.ump_strike_zone_pct = { value: null, source: 'default', ready: false };
    sources.ump_accuracy_above_x = {
      value: 0.49,
      source: 'umpscorecards',
      ready: true,
    };
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: sources,
      market: { markets: completeMl(), marketsUsed: true, locked: true, source: 'winline' },
      context: { hasLineup: true, hasHomeSp: true, hasAwaySp: true },
    });
    assert.equal(r.ready, true);
    assert.deepEqual(r.softGaps, ['ump_zone:statcast_default']);
    assert.ok(!r.softGaps.includes('ump:default'));
  });

  it('score math sanity', () => {
    assert.equal(computeScore(['home:OPS=default'], []), 75);
    assert.equal(
      computeScore(
        ['home:OPS=default', 'away:SP_ERA=default', 'odds:prematch=missing'],
        ['ump:default'],
      ),
      100 - 25 - 25 - 30 - 5,
    );
    assert.equal(computeScore(['context:prematch'], []), 80);
  });

  it('prematch without lineup and SP -> context:prematch', () => {
    const r = evaluateReadiness({
      track: 'prematch',
      input_sources: readySources(),
      market: { markets: completeMl(), marketsUsed: true, locked: true, source: 'winline' },
      context: { hasLineup: false, hasHomeSp: false, hasAwaySp: true },
    });
    assert.equal(r.ready, false);
    assert.ok(r.hardGaps.includes('context:prematch'));
  });
});
