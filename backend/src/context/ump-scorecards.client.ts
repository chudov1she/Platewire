import { Injectable, Logger } from '@nestjs/common';

export type UmpScorecardsApiRow = {
  umpire: string;
  n: number;
  called_pitches_sum?: number;
  called_correct_sum?: number;
  called_wrong_sum?: number;
  overall_accuracy_wmean?: number;
  accuracy_above_x_wmean?: number;
  consistency_wmean?: number;
  favor_abs_mean?: number;
  total_run_impact_mean?: number;
  weighted_score?: number;
  [key: string]: unknown;
};

@Injectable()
export class UmpScorecardsClient {
  private readonly logger = new Logger(UmpScorecardsClient.name);
  private readonly baseUrl = 'https://umpscorecards.com';

  async fetchUmpires(): Promise<UmpScorecardsApiRow[]> {
    const url = `${this.baseUrl}/api/umpires`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'platewire/1.0 (+local umpire analytics)',
      },
    });
    if (!res.ok) {
      throw new Error(`umpscorecards ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { rows?: UmpScorecardsApiRow[] };
    const rows = body.rows ?? [];
    this.logger.debug(`umpscorecards umpires=${rows.length}`);
    return rows;
  }
}
