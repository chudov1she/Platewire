import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { isF5OddsStage, type F5OddsStage } from '../odds/f5-scope.js';
import { OddsService } from '../odds/odds.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MatchupInputsService, resolveStartingPitcherId } from '../formula/matchup-inputs.service.js';
import { MarketLoaderService } from '../formula/market-loader.service.js';
import { SignalReadinessService } from '../formula/signal-readiness.service.js';
import type { ReadinessResult } from '../formula/signal-readiness.service.js';
import { DecisionAgentService } from '../ai/decision-agent.service.js';
import { TelegramNotifyService } from '../telegram/telegram-notify.service.js';
import type { SavantPreviewSummary } from '../savant/savant.client.js';
import {
  digestLineupFingerprint,
  digestSpFingerprint,
} from './context-fingerprint.js';

export type CaptureOptions = {
  /** Bypass the readiness hard-gate (still records the decision, marked forced). */
  force?: boolean;
  /** Bypass the "odds must be locked" requirement — used for manual/dry-run testing only. */
  allowUnlocked?: boolean;
  /**
   * Explicit capture reason. When `*_recalc`, an existing pending entry for
   * this track may be updated (settled rows are never touched).
   */
  reason?: string;
};

export type CaptureResult = {
  captured: boolean;
  entry: Record<string, unknown> | null;
  reason: string;
  readiness?: ReadinessResult;
  materialChange?: boolean;
};

type LedgerRow = {
  id: string;
  gameId: string;
  track: string;
  action: string;
  pickMarket: string | null;
  pickSide: string | null;
  pickLine: number | null;
  decimalOdds: number | null;
  valuePct: number | null;
  roiPct: number | null;
  confidenceTier: string | null;
  stakeUnits: number | null;
  resultStatus: string;
  profitUnits: number | null;
  riskFlags: string[];
  rationale: string | null;
  notifyBrief: string | null;
  captureReason: string | null;
  lineupFingerprint: string | null;
  spFingerprint: string | null;
  formulaVersionId: string;
  capturedAt: Date;
};

/**
 * Formula + AI Decision + Ledger seam. One ledger row per (gameId, track).
 * Pending rows may be rewritten on context recalc (lineup/SP); settled rows
 * are immutable aside from settlement fields.
 */
@Injectable()
export class LedgerCaptureService {
  private readonly logger = new Logger(LedgerCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchup: MatchupInputsService,
    private readonly markets: MarketLoaderService,
    private readonly readiness: SignalReadinessService,
    private readonly decisionAgent: DecisionAgentService,
    private readonly notify: TelegramNotifyService,
    private readonly odds: OddsService,
  ) {}

  async captureDecision(
    gameId: string,
    track: string,
    opts: CaptureOptions = {},
  ): Promise<CaptureResult> {
    if (!isF5OddsStage(track)) {
      return { captured: false, entry: null, reason: 'bad_track' };
    }
    const stage: F5OddsStage = track;
    const isRecalc = Boolean(opts.reason?.includes('recalc'));
    const captureReason =
      opts.reason ?? (opts.force ? 'forced' : 'ok');

    const existing = await this.prisma.f5LedgerEntry.findUnique({
      where: { gameId_track: { gameId, track: stage } },
    });
    if (existing && !isRecalc) {
      return {
        captured: false,
        entry: this.serialize(existing),
        reason: 'already_captured',
      };
    }
    if (existing && isRecalc && existing.resultStatus !== 'pending') {
      return {
        captured: false,
        entry: this.serialize(existing),
        reason: 'already_settled',
      };
    }

    // Lineup/SP recalc must re-price against LIVE book odds, not the
    // originally locked snapshot (markets move after the first capture).
    if (isRecalc) {
      try {
        const refreshed = (await this.odds.captureF5Stage(gameId, stage, {
          requireMarkets: false,
          force: true,
        })) as { ok?: boolean; skipped?: boolean; skip_reason?: string };
        if (refreshed.skipped && refreshed.skip_reason) {
          this.logger.warn(
            `recalc odds refresh skipped game=${gameId} stage=${stage} reason=${refreshed.skip_reason}`,
          );
        }
        if (refreshed.ok === false) {
          return {
            captured: false,
            entry: existing ? this.serialize(existing) : null,
            reason: 'odds_refresh_incomplete',
          };
        }
        this.logger.log(
          `recalc odds refreshed game=${gameId} stage=${stage} ok=${Boolean(refreshed.ok)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `recalc odds refresh failed game=${gameId} stage=${stage}: ${msg}`,
        );
        return {
          captured: false,
          entry: existing ? this.serialize(existing) : null,
          reason: 'odds_refresh_failed',
        };
      }
    }

    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        homeTeam: true,
        awayTeam: true,
        lineupPlayers: {
          select: {
            side: true,
            mlbPlayerId: true,
            battingOrder: true,
            fullName: true,
          },
        },
        savantPreview: { select: { summaryJson: true } },
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const marketLoad = await this.markets.load(gameId, stage);
    if (!marketLoad.marketsUsed) {
      return { captured: false, entry: null, reason: 'no_odds' };
    }
    if (!marketLoad.locked && !opts.allowUnlocked) {
      return { captured: false, entry: null, reason: 'odds_not_locked' };
    }

    const built = await this.matchup.build(gameId);
    const gate = this.readiness.evaluate({
      track: stage,
      input_sources: built.input_sources,
      market: marketLoad,
      context: built.context,
    });
    if (!gate.ready && !opts.force) {
      return { captured: false, entry: null, reason: 'not_ready', readiness: gate };
    }

    const summary = (game.savantPreview?.summaryJson ??
      null) as SavantPreviewSummary | null;
    const homePitcherId = resolveStartingPitcherId(
      game.homeProbableMlbId,
      summary?.home?.pitchers,
    );
    const awayPitcherId = resolveStartingPitcherId(
      game.awayProbableMlbId,
      summary?.away?.pitchers,
    );
    const lineupFp = digestLineupFingerprint(game.lineupPlayers);
    const spFp = digestSpFingerprint(homePitcherId, awayPitcherId);

    const matchupLabel = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
    const result = await this.decisionAgent.decide(gameId, stage, matchupLabel);

    const trace = await this.prisma.aiDecisionTrace.create({
      data: {
        gameId,
        track: stage,
        promptJson: result.trace.promptJson as Prisma.InputJsonValue,
        rawOutputJson: result.trace.rawOutputJson as Prisma.InputJsonValue,
        model: result.trace.model,
        latencyMs: result.trace.latencyMs,
      },
    });

    const data = {
      action: result.decision.action,
      pickMarket:
        result.decision.action === 'bet' ? result.decision.market : null,
      pickSide: result.decision.action === 'bet' ? result.decision.side : null,
      pickLine: result.matched?.line ?? null,
      decimalOdds: result.matched?.decimal_odds ?? null,
      modelProb: result.matched?.model_prob ?? null,
      valuePct: result.matched?.value_pct ?? null,
      roiPct: result.matched?.roi_pct ?? null,
      confidenceTier: result.decision.confidence_tier,
      stakeUnits: result.stakeUnits,
      formulaVersionId: result.formulaVersionId,
      signalsJson: result.analysis.signals as unknown as Prisma.InputJsonValue,
      dossierDigestJson: {
        expected_total: result.analysis.expected_total,
        p_home_lead: result.analysis.p_home_lead,
        p_tie: result.analysis.p_tie,
        p_away_lead: result.analysis.p_away_lead,
        simulation_mode: result.analysis.simulation_mode,
        readiness: result.readiness,
      } as unknown as Prisma.InputJsonValue,
      riskFlags: result.decision.risk_flags,
      rationale: result.decision.rationale,
      notifyBrief: result.decision.notify_brief,
      captureReason,
      lineupFingerprint: lineupFp,
      spFingerprint: spFp,
      aiTraceId: trace.id,
      resultStatus: 'pending' as const,
      capturedAt: new Date(),
    };

    let entry: LedgerRow;
    let materialChange = true;
    const previousPick =
      existing && isRecalc
        ? {
            action: existing.action,
            pickMarket: existing.pickMarket,
            pickSide: existing.pickSide,
            pickLine: existing.pickLine,
            decimalOdds: existing.decimalOdds,
          }
        : null;
    if (existing && isRecalc) {
      materialChange = this.isMaterialChange(existing, data);
      entry = await this.prisma.f5LedgerEntry.update({
        where: { id: existing.id },
        data,
      });
    } else {
      entry = await this.prisma.f5LedgerEntry.create({
        data: {
          gameId,
          track: stage,
          ...data,
        },
      });
    }

    this.logger.log(
      `ledger capture game=${gameId} track=${stage} action=${result.decision.action}` +
        ` reason=${captureReason}` +
        (result.decision.action === 'bet'
          ? ` pick=${result.decision.market}/${result.decision.side} tier=${result.decision.confidence_tier} stake=${result.stakeUnits}`
          : ''),
    );

    try {
      await this.notify.notifyAfterCapture({
        entry: {
          gameId,
          track: stage,
          action: entry.action,
          pickMarket: entry.pickMarket,
          pickSide: entry.pickSide,
          pickLine: entry.pickLine,
          decimalOdds: entry.decimalOdds,
          valuePct: entry.valuePct,
          roiPct: entry.roiPct,
          stakeUnits: entry.stakeUnits,
          confidenceTier: entry.confidenceTier,
          notifyBrief: entry.notifyBrief,
          captureReason: entry.captureReason,
          formulaVersionId: entry.formulaVersionId,
          formulaVersionLabel: result.formulaVersionLabel,
          awayAbbr: game.awayTeam.abbreviation,
          homeAbbr: game.homeTeam.abbreviation,
          gameDateUtc: game.gameDateUtc,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
        },
        isRecalc,
        materialChange,
        previous: previousPick,
      });
    } catch (err) {
      this.logger.warn(
        `tg notify failed game=${gameId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      captured: true,
      entry: this.serialize(entry),
      reason: isRecalc ? captureReason : result.decision.action,
      readiness: gate,
      materialChange,
    };
  }

  /**
   * Re-capture any pending F5 stage (prematch / inn1 / inn2) when confirmed
   * lineup or probable SP fingerprint drifted. Fresh Winline odds are pulled
   * inside captureDecision when reason includes `recalc`.
   */
  async captureIfContextChanged(gameId: string): Promise<{
    changed: boolean;
    captured: boolean;
    reason: string;
    lineupFingerprint: string | null;
    spFingerprint: string | null;
    tracks?: string[];
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        lineupPlayers: {
          select: {
            side: true,
            mlbPlayerId: true,
            battingOrder: true,
            fullName: true,
          },
        },
        savantPreview: { select: { summaryJson: true } },
      },
    });
    if (!game) {
      return {
        changed: false,
        captured: false,
        reason: 'no_game',
        lineupFingerprint: null,
        spFingerprint: null,
      };
    }

    const summary = (game.savantPreview?.summaryJson ??
      null) as SavantPreviewSummary | null;
    const homePitcherId = resolveStartingPitcherId(
      game.homeProbableMlbId,
      summary?.home?.pitchers,
    );
    const awayPitcherId = resolveStartingPitcherId(
      game.awayProbableMlbId,
      summary?.away?.pitchers,
    );
    const lineupFp = digestLineupFingerprint(game.lineupPlayers);
    const spFp = digestSpFingerprint(homePitcherId, awayPitcherId);

    const pending = await this.prisma.f5LedgerEntry.findMany({
      where: { gameId, resultStatus: 'pending' },
    });
    if (!pending.length) {
      return {
        changed: false,
        captured: false,
        reason: 'no_pending_entry',
        lineupFingerprint: lineupFp,
        spFingerprint: spFp,
      };
    }

    let anyChanged = false;
    let anyCaptured = false;
    const reasons: string[] = [];
    const tracksTouched: string[] = [];

    for (const existing of pending) {
      if (!isF5OddsStage(existing.track)) continue;

      const lineupChanged =
        lineupFp != null &&
        existing.lineupFingerprint != null &&
        lineupFp !== existing.lineupFingerprint;
      const spChanged =
        spFp != null &&
        existing.spFingerprint != null &&
        spFp !== existing.spFingerprint;

      const lineupFirstSeen =
        lineupFp != null && existing.lineupFingerprint == null;
      const spFirstSeen = spFp != null && existing.spFingerprint == null;

      if (!lineupChanged && !spChanged) {
        if (lineupFirstSeen || spFirstSeen) {
          await this.prisma.f5LedgerEntry.update({
            where: { id: existing.id },
            data: {
              lineupFingerprint: lineupFp ?? existing.lineupFingerprint,
              spFingerprint: spFp ?? existing.spFingerprint,
            },
          });
          reasons.push(`${existing.track}:fp_seeded`);
        } else {
          reasons.push(`${existing.track}:fp_same`);
        }
        continue;
      }

      const reason = lineupChanged
        ? spChanged
          ? 'lineup_sp_recalc'
          : 'lineup_recalc'
        : 'sp_recalc';

      const result = await this.captureDecision(gameId, existing.track, {
        reason,
      });
      anyChanged = true;
      if (result.captured) anyCaptured = true;
      tracksTouched.push(existing.track);
      reasons.push(`${existing.track}:${result.reason}`);
    }

    return {
      changed: anyChanged,
      captured: anyCaptured,
      reason: reasons.join(',') || 'fp_same',
      lineupFingerprint: lineupFp,
      spFingerprint: spFp,
      tracks: tracksTouched,
    };
  }

  private isMaterialChange(
    prev: {
      action: string;
      pickMarket: string | null;
      pickSide: string | null;
      pickLine: number | null;
      stakeUnits: number | null;
    },
    next: {
      action: string;
      pickMarket: string | null;
      pickSide: string | null;
      pickLine: number | null;
      stakeUnits: number | null;
    },
  ): boolean {
    if (prev.action !== next.action) return true;
    if (prev.pickMarket !== next.pickMarket) return true;
    if (prev.pickSide !== next.pickSide) return true;
    const prevLine = prev.pickLine ?? null;
    const nextLine = next.pickLine ?? null;
    if (prevLine !== nextLine) {
      if (
        prevLine == null ||
        nextLine == null ||
        Math.abs(prevLine - nextLine) >= 0.01
      ) {
        return true;
      }
    }
    const prevStake = prev.stakeUnits ?? null;
    const nextStake = next.stakeUnits ?? null;
    if (prevStake !== nextStake) {
      if (
        prevStake == null ||
        nextStake == null ||
        Math.abs(prevStake - nextStake) >= 0.01
      ) {
        return true;
      }
    }
    return false;
  }

  private serialize(row: LedgerRow) {
    return {
      id: row.id,
      gameId: row.gameId,
      track: row.track,
      action: row.action,
      pickMarket: row.pickMarket,
      pickSide: row.pickSide,
      pickLine: row.pickLine,
      decimalOdds: row.decimalOdds,
      confidenceTier: row.confidenceTier,
      stakeUnits: row.stakeUnits,
      resultStatus: row.resultStatus,
      profitUnits: row.profitUnits,
      riskFlags: row.riskFlags,
      rationale: row.rationale,
      notifyBrief: row.notifyBrief,
      captureReason: row.captureReason,
      lineupFingerprint: row.lineupFingerprint,
      spFingerprint: row.spFingerprint,
      capturedAt: row.capturedAt.toISOString(),
    };
  }
}
