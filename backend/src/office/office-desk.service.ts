import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ADAPTERS = new Set([
  'mlb_schedule',
  'savant',
  'weather',
  'winline',
  'umpscorecards',
  'live_scores',
  'http',
]);

const ENGINE_CONSTANTS = {
  league_era: 4.5,
  league_ops: 0.72,
  league_barrel: 0.085,
  league_hardhit: 0.35,
  league_sprint: 27,
  league_gb_pct: 0.42,
  league_bullpen_era: 4.5,
  lambda_min: 0.05,
  lambda_max: 1.5,
  prob_cap: 0.92,
  park_factors: {
    'coors field': 1.15,
    'fenway park': 1.05,
    'comerica park': 0.98,
    'oracle park': 0.96,
    'petco park': 0.97,
    'wrigley field': 1.04,
    'yankee stadium': 1.03,
    'great american ball park': 1.06,
  },
};

const BUILTIN_SOURCES: Array<{
  key: string;
  title: string;
  adapter: string;
  config: Record<string, unknown>;
}> = [
  { key: 'mlb_schedule', title: 'MLB schedule', adapter: 'mlb_schedule', config: { interval_ms: 600_000 } },
  { key: 'live_scores', title: 'MLB live feed', adapter: 'live_scores', config: { interval_ms: 30_000 } },
  { key: 'savant', title: 'Baseball Savant', adapter: 'savant', config: { interval_ms: 120_000 } },
  { key: 'weather', title: 'Weather', adapter: 'weather', config: { interval_ms: 120_000 } },
  { key: 'winline', title: 'Winline lines', adapter: 'winline', config: { interval_ms: 60_000 } },
  { key: 'umpscorecards', title: 'UmpScorecards', adapter: 'umpscorecards', config: { interval_ms: 21_600_000 } },
];

@Injectable()
export class OfficeDeskService implements OnModuleInit {
  private readonly logger = new Logger(OfficeDeskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureSeed();
    } catch (err) {
      this.logger.warn(`office seed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async ensureSeed() {
    const engine = await this.prisma.formulaVersion.upsert({
      where: { version: 'v45.1' },
      update: {},
      create: {
        version: 'v45.1',
        valueThreshold: 65,
        overround: 1.05,
        constantsJson: ENGINE_CONSTANTS as Prisma.InputJsonValue,
        notes: 'After-5 v45.1. Weighted ERA, form shrinkage, RISP, RE24, bullpen.',
      },
    });
    const active = await this.prisma.formulaProduction.findUnique({
      where: { id: 1 },
      include: { version: true },
    });
    if (!active) {
      await this.prisma.formulaProduction.create({
        data: { id: 1, versionId: engine.id },
      });
    } else if (active.version.version === 'v42') {
      await this.prisma.formulaProduction.update({
        where: { id: 1 },
        data: { versionId: engine.id },
      });
    }
    for (const source of BUILTIN_SOURCES) {
      await this.prisma.collectorSource.upsert({
        where: { key: source.key },
        update: {},
        create: {
          key: source.key,
          title: source.title,
          adapter: source.adapter,
          enabled: true,
          configJson: source.config as Prisma.InputJsonValue,
        },
      });
    }
  }

  async activeFormula() {
    const row = await this.prisma.formulaProduction.findUnique({
      where: { id: 1 },
      include: { version: true },
    });
    if (!row) throw new NotFoundException('No active formula');
    return this.serializeFormula(row.version);
  }

  async listFormulas() {
    const [rows, active] = await Promise.all([
      this.prisma.formulaVersion.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.formulaProduction.findUnique({ where: { id: 1 } }),
    ]);
    return {
      active_version_id: active?.versionId ?? null,
      versions: rows.map((row) => this.serializeFormula(row)),
    };
  }

  async createFormula(input: {
    version?: string;
    value_threshold?: number;
    overround?: number;
    constants?: Record<string, unknown>;
    notes?: string;
    activate?: boolean;
  }) {
    const version = (input.version ?? '').trim();
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(version)) {
      throw new BadRequestException('version must be 1-40 letters, numbers, dot, dash, or underscore');
    }
    const valueThreshold = Number(input.value_threshold);
    const overround = Number(input.overround);
    if (!Number.isFinite(valueThreshold) || valueThreshold < 0 || valueThreshold > 500) {
      throw new BadRequestException('value_threshold must be between 0 and 500');
    }
    if (!Number.isFinite(overround) || overround < 1 || overround > 1.5) {
      throw new BadRequestException('overround must be between 1 and 1.5');
    }
    const current = await this.activeFormula().catch(() => null);
    const constants = {
      ...(current?.constants ?? ENGINE_CONSTANTS),
      ...(input.constants ?? {}),
    };
    const created = await this.prisma.formulaVersion.create({
      data: {
        version,
        valueThreshold,
        overround,
        constantsJson: constants as Prisma.InputJsonValue,
        notes: input.notes?.slice(0, 2000) ?? null,
      },
    });
    if (input.activate) await this.activateFormula(version);
    return this.serializeFormula(created);
  }

  async activateFormula(version: string) {
    const row = await this.prisma.formulaVersion.findUnique({ where: { version } });
    if (!row) throw new NotFoundException(`Formula ${version} not found`);
    await this.prisma.formulaProduction.upsert({
      where: { id: 1 },
      create: { id: 1, versionId: row.id },
      update: { versionId: row.id },
    });
    return this.serializeFormula(row);
  }

  async listSources() {
    const rows = await this.prisma.collectorSource.findMany({ orderBy: { key: 'asc' } });
    return rows.map((row) => this.serializeSource(row));
  }

  async isEnabled(key: string) {
    const row = await this.prisma.collectorSource.findUnique({ where: { key } });
    return row ? row.enabled : true;
  }

  async upsertSource(
    key: string,
    input: {
      title?: string;
      adapter?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      notes?: string | null;
    },
  ) {
    if (!/^[a-z0-9_]{1,40}$/.test(key)) {
      throw new BadRequestException('source key must be lowercase letters, numbers, or underscore');
    }
    const existing = await this.prisma.collectorSource.findUnique({ where: { key } });
    const adapter = input.adapter ?? existing?.adapter;
    if (!adapter || !ADAPTERS.has(adapter)) {
      throw new BadRequestException(`adapter must be one of ${[...ADAPTERS].join(', ')}`);
    }
    const config = {
      ...((existing?.configJson as Record<string, unknown> | null) ?? {}),
      ...(input.config ?? {}),
    };
    if (adapter === 'http') {
      const url = String(config.url ?? '');
      if (!/^https?:\/\//i.test(url)) {
        throw new BadRequestException('http source needs config.url starting with http:// or https://');
      }
    }
    const saved = await this.prisma.collectorSource.upsert({
      where: { key },
      create: {
        key,
        title: input.title?.slice(0, 120) || key,
        adapter,
        enabled: input.enabled ?? true,
        configJson: config as Prisma.InputJsonValue,
        notes: input.notes?.slice(0, 2000) ?? null,
      },
      update: {
        title: input.title?.slice(0, 120) ?? existing?.title,
        adapter,
        enabled: input.enabled ?? existing?.enabled ?? true,
        configJson: config as Prisma.InputJsonValue,
        notes: input.notes === undefined ? existing?.notes : input.notes?.slice(0, 2000) ?? null,
      },
    });
    return this.serializeSource(saved);
  }

  async refreshHttpSources() {
    const rows = await this.prisma.collectorSource.findMany({
      where: { adapter: 'http', enabled: true },
    });
    let refreshed = 0;
    for (const row of rows) {
      const config = (row.configJson as { url?: string; interval_ms?: number }) ?? {};
      const interval = Number(config.interval_ms) || 600_000;
      if (row.lastRunAt && Date.now() - row.lastRunAt.getTime() < interval) continue;
      const url = String(config.url ?? '');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        const text = (await response.text()).slice(0, 80_000);
        let payload: unknown = text;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { text };
        }
        await this.prisma.collectorSource.update({
          where: { key: row.key },
          data: {
            lastStatus: response.ok ? 'ok' : `HTTP ${response.status}`,
            lastPayload: payload as Prisma.InputJsonValue,
            lastRunAt: new Date(),
          },
        });
        refreshed += 1;
      } catch (err) {
        await this.prisma.collectorSource.update({
          where: { key: row.key },
          data: {
            lastStatus: err instanceof Error ? err.message.slice(0, 300) : 'fetch failed',
            lastRunAt: new Date(),
          },
        });
      }
    }
    return { refreshed };
  }

  async extraSourcePayloads() {
    const rows = await this.prisma.collectorSource.findMany({
      where: { adapter: 'http', enabled: true, lastPayload: { not: Prisma.DbNull } },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      key: row.key,
      title: row.title,
      last_status: row.lastStatus,
      last_run_at: row.lastRunAt?.toISOString() ?? null,
      payload: row.lastPayload,
    }));
  }

  async startRun(input: {
    game_id?: string;
    matchup?: string;
    reason?: string;
    stage?: string;
    formula?: string;
  }) {
    const row = await this.prisma.officeRun.create({
      data: {
        gameId: input.game_id || 'unknown',
        matchup: input.matchup ?? null,
        reason: input.reason || 'manual',
        stage: input.stage || 'prematch',
        status: 'running',
        formula: input.formula ?? null,
      },
    });
    return { id: row.id, status: row.status };
  }

  async finishRun(id: string, input: { status?: string; summary?: string }) {
    const status = input.status === 'error' ? 'error' : 'done';
    const row = await this.prisma.officeRun.update({
      where: { id },
      data: {
        status,
        summary: input.summary?.slice(0, 2000) ?? null,
        finishedAt: new Date(),
      },
    });
    return {
      id: row.id,
      status: row.status,
      finished_at: row.finishedAt?.toISOString() ?? null,
    };
  }

  async listRuns(limit = 20) {
    const rows = await this.prisma.officeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((row) => ({
      id: row.id,
      game_id: row.gameId,
      matchup: row.matchup,
      reason: row.reason,
      stage: row.stage,
      status: row.status,
      formula: row.formula,
      summary: row.summary,
      started_at: row.startedAt.toISOString(),
      finished_at: row.finishedAt?.toISOString() ?? null,
    }));
  }

  private serializeFormula(row: {
    id: string;
    version: string;
    valueThreshold: number;
    overround: number;
    constantsJson: unknown;
    notes: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      version: row.version,
      value_threshold: row.valueThreshold,
      overround: row.overround,
      constants: row.constantsJson,
      notes: row.notes,
      created_at: row.createdAt.toISOString(),
    };
  }

  private serializeSource(row: {
    key: string;
    title: string;
    adapter: string;
    enabled: boolean;
    configJson: unknown;
    notes: string | null;
    lastStatus: string | null;
    lastRunAt: Date | null;
    updatedAt: Date;
  }) {
    return {
      key: row.key,
      title: row.title,
      adapter: row.adapter,
      enabled: row.enabled,
      config: row.configJson,
      notes: row.notes,
      last_status: row.lastStatus,
      last_run_at: row.lastRunAt?.toISOString() ?? null,
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
