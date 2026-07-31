export type UmpPitchRow = {
  description: string | null;
  events: string | null;
};

export type UmpRateMetrics = {
  pitches: number;
  calledStrikes: number;
  calledBalls: number;
  strikeouts: number;
  walks: number;
  calledStrikeRate: number | null;
  calledBallRate: number | null;
  kRate: number | null;
  bbRate: number | null;
};

export function computeUmpRates(rows: UmpPitchRow[]): UmpRateMetrics {
  let calledStrikes = 0;
  let calledBalls = 0;
  let strikeouts = 0;
  let walks = 0;

  for (const row of rows) {
    const desc = (row.description ?? '').toLowerCase();
    const events = (row.events ?? '').toLowerCase();
    if (desc.includes('called_strike') || desc.includes('called strike')) {
      calledStrikes += 1;
    }
    if (desc === 'ball' || desc.startsWith('ball ')) {
      calledBalls += 1;
    }
    if (events.includes('strikeout')) strikeouts += 1;
    if (events === 'walk' || events.includes('walk')) walks += 1;
  }

  const calledTotal = calledStrikes + calledBalls;
  const decisionTotal = strikeouts + walks;

  return {
    pitches: rows.length,
    calledStrikes,
    calledBalls,
    strikeouts,
    walks,
    calledStrikeRate: calledTotal > 0 ? calledStrikes / calledTotal : null,
    calledBallRate: calledTotal > 0 ? calledBalls / calledTotal : null,
    kRate: decisionTotal > 0 ? strikeouts / decisionTotal : null,
    bbRate: decisionTotal > 0 ? walks / decisionTotal : null,
  };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
