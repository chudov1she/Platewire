import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { aliasesForAbbr, namesMatch, normName } from './winline-aliases.js';
import { WinlineDiscoveryService, type WinlineEventMeta } from './winline/discovery.service.js';
import { WinlineHtmlMarketsService } from './winline/html-markets.service.js';
import { buildEventPayload } from './winline/normalize.js';
import { extractF5Markets } from './f5-extract.js';
import { orientF5ToMlbHome } from './orient-f5.js';
import {
  completedInnings,
  isF5OddsStage,
  stageForGame,
  type F5OddsStage,
} from './f5-scope.js';
import { decideF5StageWrite } from './f5-stage.rules.js';

@Injectable()
export class OddsService {
  private readonly logger = new Logger(OddsService.name);
  private cachedList: WinlineEventMeta[] | null = null;
  private cachedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: WinlineDiscoveryService,
    private readonly html: WinlineHtmlMarketsService,
  ) {}

  async listWinlineMatches(opts: { force?: boolean } = {}) {
    const matches = await this.getDiscoveryList(opts.force);
    return {
      ok: true,
      updated_at: new Date(this.cachedAt || Date.now()).toISOString(),
      count: matches.length,
      matches: matches.map((e) => ({
        event_id: e.event_id,
        winline_event_id: e.event_id,
        team1: e.team1,
        team2: e.team2,
        league: e.league,
        is_live: e.is_live,
        href: e.href,
        url: `https://winline.ru/stavki/sport/bejsbol/ssha/mlb/${e.event_id}`,
      })),
    };
  }

  async resolve(body: {
    team1?: string;
    team2?: string;
    query?: string;
  }) {
    if (!body.team1 && !body.team2 && !body.query) {
      throw new HttpException(
        'provide team1/team2 or query',
        HttpStatus.BAD_REQUEST,
      );
    }
    const matches = await this.getDiscoveryList();
    const hits = this.filterResolve(matches, body);
    return {
      ok: true,
      count: hits.length,
      matches: hits.map((e) => ({
        event_id: e.event_id,
        winline_event_id: e.event_id,
        team1: e.team1,
        team2: e.team2,
        league: e.league,
        is_live: e.is_live,
        href: e.href,
        url: `https://winline.ru/stavki/sport/bejsbol/ssha/mlb/${e.event_id}`,
      })),
    };
  }

  async fetchOddsForGame(
    gameId: string,
    opts: { requireMarkets?: boolean; forceRebind?: boolean } = {},
  ) {
    const requireMarkets = opts.requireMarkets !== false;
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!game) throw new NotFoundException('Game not found');

    let eventId = game.winlineEventId;
    let flipped = game.winlineFlipped ?? false;

    if (!eventId || opts.forceRebind) {
      const bound = await this.bindGame(game);
      eventId = bound.eventId;
      flipped = bound.flipped;
      if (!eventId) {
        throw new HttpException(
          {
            message: 'Could not bind MLB game to Winline event',
            game_id: gameId,
            mlb_game_pk: game.mlbGamePk,
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const scraped = await this.html.fetchEventCategories(eventId);
    const team1 = flipped
      ? game.awayTeam.name
      : scraped.team1 || game.homeTeam.name;
    const team2 = flipped
      ? game.homeTeam.name
      : scraped.team2 || game.awayTeam.name;

    const event = buildEventPayload({
      eventId,
      team1,
      team2,
      isLive: game.status === 'LIVE',
      href: scraped.href,
      source: scraped.categories.length ? 'html' : 'error',
      categories: scraped.categories,
    });

    const capturedAt = new Date().toISOString();
    const payload = {
      ok: event.ok,
      captured_at: capturedAt,
      game_id: gameId,
      mlb_game_pk: game.mlbGamePk,
      winline_event_id: eventId,
      winline_flipped: flipped,
      event,
    };

    if (requireMarkets && !event.ok) {
      throw new HttpException(
        {
          message:
            'fresh markets missing after retries. Stale odds are never returned.',
          ...payload,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return payload;
  }

  async fetchF5ForGame(
    gameId: string,
    opts: {
      requireMarkets?: boolean;
      forceRebind?: boolean;
      force?: boolean;
      stage?: F5OddsStage;
      /** Pipeline may set stage without force; never rewrites locked without force. */
      pipelineCapture?: boolean;
    } = {},
  ) {
    const requireMarkets = opts.requireMarkets !== false;
    const force = opts.force === true;

    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    let stage: F5OddsStage = stageForGame(game.status, game.inning);
    if (opts.stage) {
      if (!force && !opts.pipelineCapture) {
        throw new HttpException(
          'stage override requires force=true',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!isF5OddsStage(opts.stage)) {
        throw new HttpException('invalid stage', HttpStatus.BAD_REQUEST);
      }
      stage = opts.stage;
    }

    const existing = await this.prisma.f5OddsSnapshot.findUnique({
      where: { gameId_stage: { gameId, stage } },
    });

    const decisionPreview = decideF5StageWrite({
      stage,
      existingLocked: existing?.locked ?? false,
      extractOk: true,
      force,
      gameStatus: game.status,
      completedInnings: completedInnings(game.inning),
    });

    if (decisionPreview.action === 'skip' && decisionPreview.reason === 'stage_locked') {
      return this.serializeF5Snap(existing!, game.mlbGamePk, {
        skipped: true,
        skip_reason: 'stage_locked',
      });
    }

    // Always fresh scrape for this stage — never reuse another track's markets.
    const full = await this.fetchOddsForGame(gameId, {
      requireMarkets: false,
      forceRebind: opts.forceRebind,
    });
    const markets = full.event?.markets ?? [];
    const rawExtracted = extractF5Markets(markets);
    const flipped = full.winline_flipped ?? false;
    const extracted = orientF5ToMlbHome(rawExtracted, flipped);
    const fetchedAt = new Date(full.captured_at);

    const decision = decideF5StageWrite({
      stage,
      existingLocked: existing?.locked ?? false,
      extractOk: extracted.ok,
      force,
      gameStatus: game.status,
      completedInnings: completedInnings(game.inning),
    });

    if (decision.action === 'skip') {
      // Pipeline: record failed attempt so we backoff 90s then retry (guarantee loop).
      if (
        opts.pipelineCapture &&
        decision.reason === 'extract_incomplete' &&
        !(existing?.locked)
      ) {
        const failSnap = await this.prisma.f5OddsSnapshot.upsert({
          where: { gameId_stage: { gameId, stage } },
          create: {
            gameId,
            stage,
            locked: false,
            winlineEventId: full.winline_event_id,
            flipped,
            moneylineJson: extracted.moneyline ?? undefined,
            totalsJson: extracted.totals,
            handicapsJson: extracted.handicaps,
            mainTotalJson: extracted.main_total ?? undefined,
            mainHandicapJson: extracted.main_handicap ?? undefined,
            ok: false,
            rawMarketCount: extracted.raw_f5_count,
            missingJson: extracted.missing,
            fetchedAt,
          },
          update: {
            locked: false,
            winlineEventId: full.winline_event_id,
            flipped,
            moneylineJson: extracted.moneyline ?? undefined,
            totalsJson: extracted.totals,
            handicapsJson: extracted.handicaps,
            mainTotalJson: extracted.main_total ?? undefined,
            mainHandicapJson: extracted.main_handicap ?? undefined,
            ok: false,
            rawMarketCount: extracted.raw_f5_count,
            missingJson: extracted.missing,
            fetchedAt,
          },
        });
        return {
          ...this.serializeF5Snap(failSnap, game.mlbGamePk, {
            skipped: true,
            skip_reason: decision.reason,
          }),
          fresh: true,
        };
      }

      if (existing) {
        const payload = this.serializeF5Snap(existing, game.mlbGamePk, {
          skipped: true,
          skip_reason: decision.reason,
        });
        if (requireMarkets && !existing.ok) {
          throw new HttpException(
            {
              message:
                'F5 markets incomplete after scrape (need moneyline + match total).',
              ...payload,
            },
            HttpStatus.BAD_GATEWAY,
          );
        }
        return payload;
      }
      const emptyPayload = {
        ok: false,
        captured_at: full.captured_at,
        game_id: gameId,
        mlb_game_pk: full.mlb_game_pk,
        winline_event_id: full.winline_event_id,
        winline_flipped: flipped,
        stage,
        locked: false,
        moneyline: extracted.moneyline,
        totals: extracted.totals,
        handicaps: extracted.handicaps,
        main_total: extracted.main_total,
        main_handicap: extracted.main_handicap,
        missing: extracted.missing,
        skipped: true,
        skip_reason: decision.reason,
        fresh: true,
      };
      if (requireMarkets) {
        throw new HttpException(
          {
            message:
              'F5 markets incomplete after scrape (need moneyline + match total).',
            ...emptyPayload,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      return emptyPayload;
    }

    const locked = decision.lockAfter;
    const snap = await this.prisma.f5OddsSnapshot.upsert({
      where: { gameId_stage: { gameId, stage } },
      create: {
        gameId,
        stage,
        locked,
        winlineEventId: full.winline_event_id,
        flipped,
        moneylineJson: extracted.moneyline ?? undefined,
        totalsJson: extracted.totals,
        handicapsJson: extracted.handicaps,
        mainTotalJson: extracted.main_total ?? undefined,
        mainHandicapJson: extracted.main_handicap ?? undefined,
        ok: extracted.ok,
        rawMarketCount: extracted.raw_f5_count,
        missingJson: extracted.missing,
        fetchedAt,
      },
      update: {
        locked,
        winlineEventId: full.winline_event_id,
        flipped,
        moneylineJson: extracted.moneyline ?? undefined,
        totalsJson: extracted.totals,
        handicapsJson: extracted.handicaps,
        mainTotalJson: extracted.main_total ?? undefined,
        mainHandicapJson: extracted.main_handicap ?? undefined,
        ok: extracted.ok,
        rawMarketCount: extracted.raw_f5_count,
        missingJson: extracted.missing,
        fetchedAt,
      },
    });

    if (decision.lockPrematch) {
      await this.prisma.f5OddsSnapshot.updateMany({
        where: { gameId, stage: 'prematch', locked: false },
        data: { locked: true },
      });
    }

    const payload = {
      ...this.serializeF5Snap(snap, game.mlbGamePk),
      fresh: true,
    };

    if (requireMarkets && !extracted.ok) {
      throw new HttpException(
        {
          message:
            'F5 markets incomplete after scrape (need moneyline + match total).',
          ...payload,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return payload;
  }

  /**
   * Fresh scrape for exactly one stage (pipeline / catch-up).
   * Never copies markets from another stage.
   * `force: true` rewrites an already-locked snapshot (lineup/SP recalc).
   */
  async captureF5Stage(
    gameId: string,
    stage: F5OddsStage,
    opts: {
      requireMarkets?: boolean;
      forceRebind?: boolean;
      force?: boolean;
    } = {},
  ) {
    return this.fetchF5ForGame(gameId, {
      requireMarkets: opts.requireMarkets ?? false,
      forceRebind: opts.forceRebind,
      force: opts.force === true,
      stage,
      pipelineCapture: true,
    });
  }

  async getLatestF5(gameId: string, opts: { stage?: string } = {}) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    if (opts.stage) {
      if (!isF5OddsStage(opts.stage)) {
        throw new HttpException('invalid stage', HttpStatus.BAD_REQUEST);
      }
      const snap = await this.prisma.f5OddsSnapshot.findUnique({
        where: { gameId_stage: { gameId, stage: opts.stage } },
      });
      if (!snap) {
        throw new NotFoundException(`No F5 snapshot for stage=${opts.stage}`);
      }
      return this.serializeF5Snap(snap, game.mlbGamePk);
    }

    const rows = await this.prisma.f5OddsSnapshot.findMany({
      where: { gameId },
    });
    if (!rows.length) {
      throw new NotFoundException('No F5 odds snapshot for this game');
    }

    const byStage = Object.fromEntries(
      rows.map((r) => [r.stage, this.serializeF5Snap(r, game.mlbGamePk)]),
    ) as Record<string, ReturnType<OddsService['serializeF5Snap']>>;

    return {
      ok: true,
      game_id: gameId,
      mlb_game_pk: game.mlbGamePk,
      tracks: {
        prematch: byStage.prematch ?? null,
        inn1: byStage.inn1 ?? null,
        inn2: byStage.inn2 ?? null,
      },
    };
  }

  private serializeF5Snap(
    snap: {
      gameId: string;
      stage: string;
      locked: boolean;
      winlineEventId: number;
      flipped: boolean;
      moneylineJson: unknown;
      totalsJson: unknown;
      handicapsJson: unknown;
      mainTotalJson: unknown;
      mainHandicapJson: unknown;
      ok: boolean;
      missingJson: unknown;
      fetchedAt: Date;
    },
    mlbGamePk: number,
    extra: Record<string, unknown> = {},
  ) {
    return {
      ok: snap.ok,
      captured_at: snap.fetchedAt.toISOString(),
      game_id: snap.gameId,
      mlb_game_pk: mlbGamePk,
      winline_event_id: snap.winlineEventId,
      winline_flipped: snap.flipped,
      stage: snap.stage,
      locked: snap.locked,
      moneyline: snap.moneylineJson,
      totals: snap.totalsJson,
      handicaps: snap.handicapsJson,
      main_total: snap.mainTotalJson,
      main_handicap: snap.mainHandicapJson,
      missing: snap.missingJson ?? [],
      ...extra,
    };
  }

  private async bindGame(game: {
    id: string;
    homeTeam: { abbreviation: string; name: string };
    awayTeam: { abbreviation: string; name: string };
  }): Promise<{ eventId: number | null; flipped: boolean }> {
    const list = await this.getDiscoveryList(true);
    const homeAliases = [
      ...aliasesForAbbr(game.homeTeam.abbreviation),
      game.homeTeam.name,
    ];
    const awayAliases = [
      ...aliasesForAbbr(game.awayTeam.abbreviation),
      game.awayTeam.name,
    ];

    let best: { eventId: number; flipped: boolean; score: number } | null =
      null;

    for (const meta of list) {
      const t1Home = namesMatch(meta.team1, homeAliases);
      const t2Away = namesMatch(meta.team2, awayAliases);
      const t1Away = namesMatch(meta.team1, awayAliases);
      const t2Home = namesMatch(meta.team2, homeAliases);

      if (t1Home && t2Away) {
        const score = (meta.is_live ? 10 : 0) + 2;
        if (!best || score > best.score) {
          best = { eventId: meta.event_id, flipped: false, score };
        }
      } else if (t1Away && t2Home) {
        const score = (meta.is_live ? 10 : 0) + 1;
        if (!best || score > best.score) {
          best = { eventId: meta.event_id, flipped: true, score };
        }
      }
    }

    if (!best) {
      this.logger.warn(
        `bind miss game=${game.id} home=${game.homeTeam.abbreviation} away=${game.awayTeam.abbreviation}`,
      );
      return { eventId: null, flipped: false };
    }

    await this.prisma.game.update({
      where: { id: game.id },
      data: {
        winlineEventId: best.eventId,
        winlineFlipped: best.flipped,
      },
    });

    this.logger.log(
      `bind ok game=${game.id} event=${best.eventId} flipped=${best.flipped}`,
    );
    return { eventId: best.eventId, flipped: best.flipped };
  }

  private async getDiscoveryList(force = false): Promise<WinlineEventMeta[]> {
    const ttlMs = 60_000;
    if (
      !force &&
      this.cachedList &&
      Date.now() - this.cachedAt < ttlMs
    ) {
      return this.cachedList;
    }
    this.cachedList = await this.discovery.discoverMlbEvents();
    this.cachedAt = Date.now();
    return this.cachedList;
  }

  private filterResolve(
    matches: WinlineEventMeta[],
    body: { team1?: string; team2?: string; query?: string },
  ): WinlineEventMeta[] {
    if (body.query) {
      const q = normName(body.query);
      return matches.filter(
        (m) =>
          normName(m.team1).includes(q) ||
          normName(m.team2).includes(q) ||
          `${normName(m.team1)} ${normName(m.team2)}`.includes(q),
      );
    }
    const t1 = normName(body.team1);
    const t2 = normName(body.team2);
    return matches.filter((m) => {
      const a = normName(m.team1);
      const b = normName(m.team2);
      const direct =
        (!t1 || a.includes(t1) || t1.includes(a)) &&
        (!t2 || b.includes(t2) || t2.includes(b));
      const flipped =
        (!t1 || b.includes(t1) || t1.includes(b)) &&
        (!t2 || a.includes(t2) || t2.includes(a));
      return direct || flipped;
    });
  }
}
