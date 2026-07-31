import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { UmpScorecardsService } from '../context/ump-scorecards.service.js';
import { GamePipelineService } from './game-pipeline.service.js';

@Injectable()
export class PipelineScheduler implements OnModuleInit {
  private readonly logger = new Logger(PipelineScheduler.name);

  constructor(
    private readonly pipeline: GamePipelineService,
    private readonly umpScorecards: UmpScorecardsService,
  ) {}

  /**
   * Nest @Interval does not fire on boot — empty Docker DB would sit idle
   * until the first slate (10m) / umpscorecards (6h) tick.
   */
  onModuleInit() {
    if (!this.pipeline.isEnabled()) return;
    setTimeout(() => {
      void this.bootstrapOnce();
    }, 2_000);
  }

  private async bootstrapOnce() {
    try {
      const ump = await this.umpScorecards.ensureFresh(false);
      this.logger.log(
        ump.skipped
          ? 'bootstrap umpscorecards skipped (fresh)'
          : `bootstrap umpscorecards upserted=${ump.upserted}`,
      );
    } catch (err) {
      this.logger.warn(
        `bootstrap umpscorecards: ${err instanceof Error ? err.message : err}`,
      );
    }
    try {
      await this.pipeline.tickUniverse('slate');
      this.logger.log('bootstrap slate done');
    } catch (err) {
      this.logger.warn(
        `bootstrap slate: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Slate sync every 10 minutes (+ final probe stub). */
  @Interval(10 * 60 * 1000)
  async slateTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      await this.pipeline.tickUniverse('slate');
      await this.pipeline.tickUniverse('final_probe');
    } catch (err) {
      this.logger.warn(
        `slate tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Prematch: every 2 min while games are in T−60m window without secured bet.
   * Retries until ok+locked — not a one-shot "chance".
   */
  @Interval(2 * 60 * 1000)
  async prematchTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      await this.pipeline.tickUniverse('prematch');
    } catch (err) {
      this.logger.warn(
        `prematch tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Stage watch: every 60s MLB inning check on LIVE.
   * Winline only when a required stage is still unsecured; 90s backoff after fail.
   */
  @Interval(60 * 1000)
  async stageWatchTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      await this.pipeline.tickUniverse('stage_watch');
    } catch (err) {
      this.logger.warn(
        `stage_watch tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Live scores: every 30s refresh MLB feed for ALL LIVE/OTHER games
   * (not only those still needing betting stages).
   */
  @Interval(30 * 1000)
  async liveScoresTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      await this.pipeline.tickLiveScores();
    } catch (err) {
      this.logger.warn(
        `live_scores tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Lineup/SP drift recalc for any pending F5 stage (~2 min). */
  @Interval(2 * 60 * 1000)
  async contextRecalcTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      await this.pipeline.tickContextRecalc();
    } catch (err) {
      this.logger.warn(
        `context_recalc tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** UmpScorecards catalog — TTL also guards ensureFresh. */
  @Interval(6 * 60 * 60 * 1000)
  async umpScorecardsTick() {
    if (!this.pipeline.isEnabled()) return;
    try {
      const r = await this.umpScorecards.ensureFresh(false);
      if (!r.skipped) {
        this.logger.log(`umpscorecards tick upserted=${r.upserted}`);
      }
    } catch (err) {
      this.logger.warn(
        `umpscorecards tick: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
