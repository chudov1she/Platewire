import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatBetAlert, tgMarketLabel } from '../telegram-format.js';
import { tableHtmlToPreLines } from '../telegram-rich.js';

describe('telegram-format', () => {
  it('labels markets baseballai-style', () => {
    assert.equal(
      tgMarketLabel({ market: 'total', side: 'over', line: 4.5 }, 'KC', 'DET'),
      'Т 4.5 Б',
    );
    assert.equal(
      tgMarketLabel({ market: 'moneyline', side: 'away', line: null }, 'KC', 'DET'),
      'Win KC',
    );
  });

  it('builds table + AI brief footer', () => {
    const payload = formatBetAlert({
      awayAbbr: 'TEX',
      homeAbbr: 'TB',
      track: 'prematch',
      pick: {
        market: 'total',
        side: 'over',
        line: 4,
        decimalOdds: 1.88,
        valuePct: 12.5,
        roiPct: 8.1,
      },
      notifyBrief: 'Ставим тотал больше: модель видит высокий темп атаки.',
      versionLabel: 'v42-default',
      stakeUnits: 3,
      confidenceTier: 'medium',
    });
    assert.match(payload.title, /TEX vs TB · прематч F5/);
    assert.match(payload.footer, /Ставим тотал больше/);
    assert.match(payload.footer, /ставка 3u/);
    const lines = tableHtmlToPreLines(payload.tableHtml);
    assert.ok(lines.some((l) => l.includes('Т 4 Б')));
    assert.ok(payload.fallbackHtml.includes('<pre>'));
  });

  it('marks recalc and pass in title', () => {
    const payload = formatBetAlert({
      awayAbbr: 'NYY',
      homeAbbr: 'BOS',
      track: 'inn1',
      pick: null,
      notifyBrief: 'После смены SP пассуем.',
      versionLabel: 'v42',
      captureReason: 'sp_recalc',
      action: 'pass',
    });
    assert.match(payload.title, /перерасчёт/);
    assert.match(payload.title, /PASS/);
  });

  it('includes previous→next pick diff on recalc', () => {
    const payload = formatBetAlert({
      awayAbbr: 'KC',
      homeAbbr: 'DET',
      track: 'prematch',
      pick: {
        market: 'total',
        side: 'under',
        line: 4.5,
        decimalOdds: 2.05,
        valuePct: 5,
        roiPct: 4,
      },
      notifyBrief: 'Состав ослаб — тотал меньше.',
      versionLabel: 'v42',
      captureReason: 'lineup_recalc',
      action: 'bet',
      previousPick: {
        action: 'bet',
        pickMarket: 'total',
        pickSide: 'over',
        pickLine: 4.5,
        decimalOdds: 1.9,
      },
    });
    assert.match(payload.footer, /Было: Т 4\.5 Б @ 1\.90 → стало: Т 4\.5 М @ 2\.05/);
  });

  it('shows PASS in pick diff', () => {
    const payload = formatBetAlert({
      awayAbbr: 'KC',
      homeAbbr: 'DET',
      track: 'prematch',
      pick: null,
      notifyBrief: 'После смены SP края нет.',
      versionLabel: 'v42',
      captureReason: 'sp_recalc',
      action: 'pass',
      previousPick: {
        action: 'bet',
        pickMarket: 'moneyline',
        pickSide: 'away',
        pickLine: null,
        decimalOdds: 2.1,
      },
    });
    assert.match(payload.footer, /Было: Win KC @ 2\.10 → стало: PASS/);
  });
});
