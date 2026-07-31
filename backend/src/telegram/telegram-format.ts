import {
  buildHtmlTable,
  composeFallbackPre,
  composeRichHtml,
  type RichAlertPayload,
} from './telegram-rich.js';

export type NotifyPick = {
  market: string;
  side: string;
  line?: number | null;
  decimalOdds: number;
  valuePct: number;
  roiPct: number;
};

/** Baseballai-style market labels for TG tables. */
export function tgMarketLabel(
  bet: Pick<NotifyPick, 'market' | 'side' | 'line'>,
  awayAbbr: string,
  homeAbbr: string,
): string {
  const m = bet.market.toLowerCase();
  const s = bet.side.toLowerCase();
  if (m === 'moneyline') {
    if (s === 'away') return `Win ${awayAbbr}`;
    if (s === 'home') return `Win ${homeAbbr}`;
    return 'X';
  }
  if (m === 'total') {
    const line = bet.line ?? 4.5;
    const suffix = s === 'over' ? 'Б' : 'М';
    return `Т ${trimNum(line)} ${suffix}`;
  }
  if (m === 'runline' || m === 'handicap') {
    const side = s === 'home' ? homeAbbr : awayAbbr;
    const line = bet.line ?? 1.5;
    return `RL ${side} ${trimNum(line)}`;
  }
  return `${bet.market} ${bet.side}`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function trackTitleRu(track: string): string {
  const t = track.toLowerCase();
  if (t === 'inn1') return 'после 1-го инн';
  if (t === 'inn2') return 'после 2-го инн';
  if (t === 'prematch') return 'прематч F5';
  return track;
}

export function formatPickChangeLine(opts: {
  awayAbbr: string;
  homeAbbr: string;
  previous: {
    action: string;
    pickMarket: string | null;
    pickSide: string | null;
    pickLine: number | null;
    decimalOdds: number | null;
  } | null;
  next: {
    action: string;
    pickMarket: string | null;
    pickSide: string | null;
    pickLine: number | null;
    decimalOdds: number | null;
  };
}): string | null {
  if (!opts.previous) return null;

  const fmt = (row: {
    action: string;
    pickMarket: string | null;
    pickSide: string | null;
    pickLine: number | null;
    decimalOdds: number | null;
  }) => {
    if (row.action === 'pass' || !row.pickMarket || !row.pickSide) {
      return 'PASS';
    }
    const label = tgMarketLabel(
      {
        market: row.pickMarket,
        side: row.pickSide,
        line: row.pickLine,
      },
      opts.awayAbbr,
      opts.homeAbbr,
    );
    const odds =
      row.decimalOdds != null && Number.isFinite(row.decimalOdds)
        ? ` @ ${row.decimalOdds.toFixed(2)}`
        : '';
    return `${label}${odds}`;
  };

  const from = fmt(opts.previous);
  const to = fmt(opts.next);
  if (from === to) return null;
  return `Было: ${from} → стало: ${to}`;
}

export function formatBetAlert(opts: {
  awayAbbr: string;
  homeAbbr: string;
  track: string;
  pick: NotifyPick | null;
  notifyBrief: string;
  versionLabel: string;
  stakeUnits?: number | null;
  confidenceTier?: string | null;
  captureReason?: string | null;
  awayScore?: number | null;
  homeScore?: number | null;
  action?: string;
  previousPick?: {
    action: string;
    pickMarket: string | null;
    pickSide: string | null;
    pickLine: number | null;
    decimalOdds: number | null;
  } | null;
}): RichAlertPayload {
  const stage = trackTitleRu(opts.track);
  const liveScore =
    opts.awayScore != null && opts.homeScore != null
      ? ` · ${opts.awayScore}-${opts.homeScore}`
      : '';
  const recalcTag =
    opts.captureReason?.includes('recalc') ? ' · перерасчёт' : '';
  const passTag = opts.action === 'pass' ? ' · PASS' : '';
  const title = `${opts.awayAbbr} vs ${opts.homeAbbr} · ${stage}${liveScore}${recalcTag}${passTag}`;

  const rows: Array<Array<string | number>> = [];
  if (opts.pick) {
    rows.push([
      tgMarketLabel(opts.pick, opts.awayAbbr, opts.homeAbbr),
      opts.pick.decimalOdds.toFixed(2),
      `${opts.pick.valuePct >= 0 ? '+' : ''}${opts.pick.valuePct.toFixed(1)}%`,
      `${opts.pick.roiPct >= 0 ? '+' : ''}${opts.pick.roiPct.toFixed(1)}%`,
    ]);
  } else {
    rows.push(['—', '—', '—', '—']);
  }

  const tableHtml = buildHtmlTable(['Market', 'Odds', 'Value', 'ROI'], rows);

  const meta: string[] = [];
  if (opts.stakeUnits != null && Number.isFinite(opts.stakeUnits)) {
    meta.push(`ставка ${opts.stakeUnits}u`);
  }
  if (opts.confidenceTier) {
    meta.push(`уверенность ${opts.confidenceTier}`);
  }
  meta.push(`formula ${opts.versionLabel}`);

  const changeLine =
    opts.captureReason?.includes('recalc')
      ? formatPickChangeLine({
          awayAbbr: opts.awayAbbr,
          homeAbbr: opts.homeAbbr,
          previous: opts.previousPick ?? null,
          next: {
            action: opts.action ?? (opts.pick ? 'bet' : 'pass'),
            pickMarket: opts.pick?.market ?? null,
            pickSide: opts.pick?.side ?? null,
            pickLine: opts.pick?.line ?? null,
            decimalOdds: opts.pick?.decimalOdds ?? null,
          },
        })
      : null;

  const footer = [changeLine, opts.notifyBrief.trim(), meta.join(' · ')]
    .filter(Boolean)
    .join('\n');

  return {
    title,
    tableHtml,
    footer,
    fallbackHtml: composeFallbackPre({ title, tableHtml, footer }),
  };
}

export { composeRichHtml };
