import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContextService } from '../context/context.service.js';
import { GamesService } from '../games/games.service.js';
import { OddsService } from '../odds/odds.service.js';
import type { F5OddsStage } from '../odds/f5-scope.js';
import { GamePackService } from '../pack/game-pack.service.js';
import { GamePipelineService } from '../pipeline/game-pipeline.service.js';
import { OfficeDeskService } from '../office/office-desk.service.js';
import { CollectorSearchService } from './collector-search.service.js';

const stageSchema = z.enum(['prematch', 'inn1', 'inn2']);

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return textResult(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

@Injectable()
export class PlatewireMcpService {
  constructor(
    private readonly games: GamesService,
    private readonly pack: GamePackService,
    private readonly search: CollectorSearchService,
    private readonly context: ContextService,
    private readonly odds: OddsService,
    private readonly pipeline: GamePipelineService,
    private readonly desk: OfficeDeskService,
  ) {}

  createServer(): McpServer {
    const server = new McpServer({
      name: 'platewire',
      version: '0.1.0',
    });

    server.registerTool(
      'list_slate',
      {
        description:
          'List MLB games for a date (YYYY-MM-DD) or today, with completeness flags.',
        inputSchema: z.object({
          date: z.string().optional().describe('Official date YYYY-MM-DD. Omit for today.'),
        }),
      },
      async ({ date }) =>
        run(() => (date ? this.games.listByDate(date) : this.games.listToday())),
    );

    server.registerTool(
      'get_game',
      {
        description: 'Game card without the full dossier.',
        inputSchema: z.object({
          game_id: z.string().describe('Platewire game UUID'),
        }),
      },
      async ({ game_id }) => run(() => this.games.getById(game_id)),
    );

    server.registerTool(
      'get_pack',
      {
        description:
          'Full collected dossier for one game: lineups, players, weather, umpire, odds tracks and history.',
        inputSchema: z.object({
          game_id: z.string(),
        }),
      },
      async ({ game_id }) => run(() => this.pack.getPack(game_id)),
    );

    server.registerTool(
      'search',
      {
        description:
          'Search the local collector database. One string: team name or abbreviation, player name, umpire name, or YYYY-MM-DD. Returns short hits only.',
        inputSchema: z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(20).optional(),
        }),
      },
      async ({ query, limit }) => run(() => this.search.search(query, limit ?? 8)),
    );

    server.registerTool(
      'get_player',
      {
        description: 'Stored features for one player by MLB player id.',
        inputSchema: z.object({
          mlb_player_id: z.number().int(),
        }),
      },
      async ({ mlb_player_id }) =>
        run(() => this.context.getPlayerFeatures(mlb_player_id)),
    );

    server.registerTool(
      'get_official',
      {
        description: 'Stored features for one umpire by MLB official id.',
        inputSchema: z.object({
          mlb_official_id: z.number().int(),
        }),
      },
      async ({ mlb_official_id }) =>
        run(() => this.context.getOfficialFeatures(mlb_official_id)),
    );

    server.registerTool(
      'get_odds',
      {
        description:
          'Latest F5 line per stage plus recent snapshot history. Does not scrape.',
        inputSchema: z.object({
          game_id: z.string(),
          stage: stageSchema.optional(),
        }),
      },
      async ({ game_id, stage }) =>
        run(() => this.odds.getLatestF5(game_id, { stage })),
    );

    server.registerTool(
      'sync_slate',
      {
        description: 'Pull the MLB schedule for a date into the collector. Omit date for today.',
        inputSchema: z.object({
          date: z.string().optional(),
        }),
      },
      async ({ date }) => run(() => this.games.syncDate(date)),
    );

    server.registerTool(
      'refresh_game',
      {
        description:
          'One pipeline pass for a single game: live score, weather, context, and the current odds window.',
        inputSchema: z.object({
          game_id: z.string(),
        }),
      },
      async ({ game_id }) => run(() => this.pipeline.tickGame(game_id)),
    );

    server.registerTool(
      'refresh_odds',
      {
        description:
          'Scrape Winline F5 again for one game and store a new snapshot. Stage defaults to the current window.',
        inputSchema: z.object({
          game_id: z.string(),
          stage: stageSchema.optional(),
        }),
      },
      async ({ game_id, stage }) =>
        run(() =>
          this.odds.fetchF5ForGame(game_id, {
            requireMarkets: false,
            force: true,
            stage: stage as F5OddsStage | undefined,
            pipelineCapture: Boolean(stage),
          }),
        ),
    );

    server.registerTool(
      'refresh_context',
      {
        description: 'Refresh lineups and player/umpire features for one game.',
        inputSchema: z.object({
          game_id: z.string(),
        }),
      },
      async ({ game_id }) => run(() => this.context.refresh(game_id)),
    );

    server.registerTool(
      'refresh_player',
      {
        description: 'Fetch and store features for one MLB player id.',
        inputSchema: z.object({
          mlb_player_id: z.number().int(),
        }),
      },
      async ({ mlb_player_id }) =>
        run(() => this.context.getPlayerFeatures(mlb_player_id, { sync: true })),
    );

    server.registerTool(
      'pipeline_status',
      {
        description: 'Whether the collector pipeline is enabled, in flight, and what it did in the last hour.',
        inputSchema: z.object({}),
      },
      async () => run(() => this.pipeline.getStatus()),
    );

    server.registerTool(
      'list_formulas',
      {
        description: 'Formula versions stored in the database, and which one is active.',
        inputSchema: z.object({}),
      },
      async () => run(() => this.desk.listFormulas()),
    );

    server.registerTool(
      'save_formula',
      {
        description:
          'Store a new formula version. Does not change the running version unless activate is true. The next game run reads the active version.',
        inputSchema: z.object({
          version: z.string(),
          value_threshold: z.number(),
          overround: z.number(),
          constants: z.record(z.string(), z.unknown()).optional(),
          notes: z.string().optional(),
          activate: z.boolean().optional(),
        }),
      },
      async (input) => run(() => this.desk.createFormula(input)),
    );

    server.registerTool(
      'activate_formula',
      {
        description: 'Make a stored formula version the one the next game run uses.',
        inputSchema: z.object({ version: z.string() }),
      },
      async ({ version }) => run(() => this.desk.activateFormula(version)),
    );

    server.registerTool(
      'list_sources',
      {
        description:
          'Collector sources. Builtin adapters can be enabled or disabled. An http source is fetched on the next collector tick.',
        inputSchema: z.object({}),
      },
      async () => run(() => this.desk.listSources()),
    );

    server.registerTool(
      'save_source',
      {
        description:
          'Create or update a data source. adapter is mlb_schedule, savant, weather, winline, umpscorecards, live_scores, or http. http requires config.url. Workers see it on the next run.',
        inputSchema: z.object({
          key: z.string(),
          title: z.string().optional(),
          adapter: z.string().optional(),
          enabled: z.boolean().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          notes: z.string().nullable().optional(),
        }),
      },
      async ({ key, ...rest }) => run(() => this.desk.upsertSource(key, rest)),
    );

    server.registerTool(
      'list_runs',
      {
        description: 'Recent office workers: which game they are on, whether they are still running, and the result summary.',
        inputSchema: z.object({
          limit: z.number().int().min(1).max(50).optional(),
        }),
      },
      async ({ limit }) => run(() => this.desk.listRuns(limit ?? 20)),
    );

    return server;
  }
}
