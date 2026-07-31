import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { GamesService } from '../games/games.service.js';
import type { FormulaRunnerService } from '../formula/formula-runner.service.js';
import type { FormulaStoreService } from '../formula/formula-store.service.js';
import type { MatchupInputsService } from '../formula/matchup-inputs.service.js';
import type { MarketLoaderService } from '../formula/market-loader.service.js';
import type { SignalReadinessService } from '../formula/signal-readiness.service.js';
import type { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import type { LedgerBacktestService } from '../ledger/ledger-backtest.service.js';
import type { AgentProposalService } from './agent-proposal.service.js';
import { buildCurationTools } from './curation-tools.js';

export function buildAgentChatTools(deps: {
  games: GamesService;
  store: FormulaStoreService;
  runner: FormulaRunnerService;
  matchup: MatchupInputsService;
  markets: MarketLoaderService;
  readiness: SignalReadinessService;
  analytics: LedgerAnalyticsService;
  backtest: LedgerBacktestService;
  proposals: AgentProposalService;
}) {
  const listGames = tool(
    async ({ date }: { date?: string }) => {
      const res = date
        ? await deps.games.listByDate(date, { autoSync: false })
        : await deps.games.listToday();
      return JSON.stringify({
        date: res.date,
        count: res.count,
        games: res.games.map((g) => ({
          id: g.id,
          matchup: `${g.away_team.abbreviation} @ ${g.home_team.abbreviation}`,
          status: g.status,
          game_date_utc: g.game_date_utc,
          home_score: g.home_score,
          away_score: g.away_score,
        })),
      });
    },
    {
      name: 'list_games',
      description:
        "List MLB games for a date (default: today's slate). Returns each game's id (needed for eval_game), matchup, status, and score.",
      schema: z.object({
        date: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      }),
    },
  );

  const evalGame = tool(
    async ({ gameId, track }: { gameId: string; track?: 'prematch' | 'inn1' | 'inn2' }) => {
      const production = await deps.store.getProduction();
      const built = await deps.matchup.build(gameId);
      const marketLoad = await deps.markets.load(gameId, track ?? 'prematch');
      const readiness = deps.readiness.evaluate({
        track: marketLoad.track,
        input_sources: built.input_sources,
        market: marketLoad,
        context: built.context,
      });
      const analysis = deps.runner.analyze(built.inputs, marketLoad.markets, production.spec);
      return JSON.stringify({
        gameId,
        track: marketLoad.track,
        versionLabel: production.versionLabel,
        readiness: {
          ready: readiness.ready,
          score: readiness.score,
          hardGaps: readiness.hardGaps,
          softGaps: readiness.softGaps,
        },
        marketsUsed: marketLoad.marketsUsed,
        locked: marketLoad.locked,
        lambda_home: analysis.lambda_home,
        lambda_away: analysis.lambda_away,
        expected_total: analysis.expected_total,
        p_home_lead: analysis.p_home_lead,
        p_tie: analysis.p_tie,
        p_away_lead: analysis.p_away_lead,
        p_over_4_5: analysis.p_over_4_5,
        value_bets: analysis.value_bets,
        signals: analysis.signals,
        notes: [...built.notes, ...marketLoad.notes, ...analysis.notes],
      });
    },
    {
      name: 'eval_game',
      description:
        'Runs the current production formula for one game+track (prematch/inn1/inn2) and returns expected values, value bets, signals and readiness. Call list_games first to find the gameId.',
      schema: z.object({
        gameId: z.string().describe('Game UUID from list_games'),
        track: z.enum(['prematch', 'inn1', 'inn2']).optional(),
      }),
    },
  );

  return [listGames, evalGame, ...buildCurationTools(deps)];
}
