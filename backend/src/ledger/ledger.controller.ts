import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '../generated/prisma/client.js';
import { Statuses } from '../common/index.js';
import {
  CaptureDecisionDto,
  FormulaBacktestDto,
  PatchLedgerEntryDto,
} from './dto/ledger.dto.js';
import { LedgerAnalyticsService } from './ledger-analytics.service.js';
import { LedgerBacktestService } from './ledger-backtest.service.js';
import { LedgerCaptureService } from './ledger-capture.service.js';
import { LedgerSettleService } from './ledger-settle.service.js';

@ApiTags('ledger')
@ApiBearerAuth()
@Controller()
export class LedgerController {
  constructor(
    private readonly capture: LedgerCaptureService,
    private readonly analytics: LedgerAnalyticsService,
    private readonly settle: LedgerSettleService,
    private readonly backtest: LedgerBacktestService,
  ) {}

  @Get('ledger')
  @ApiOperation({ summary: 'List F5 ledger entries (the factual bet/pass record)' })
  list(
    @Query('track') track?: string,
    @Query('status') status?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : 50;
    return this.analytics.list({ track, status, action, limit: Number.isFinite(n) ? n : 50 });
  }

  @Get('ledger/stats')
  @ApiOperation({ summary: 'Ledger performance stats (ROI, winrate, breakdowns)' })
  stats(@Query('days') days?: string, @Query('track') track?: string) {
    const n = days ? Number(days) : 7;
    return this.analytics.stats(Number.isFinite(n) ? n : 7, track || undefined);
  }

  @Get('ledger/equity')
  @ApiOperation({ summary: 'Chronological equity curve (running bankroll) for the analytics page' })
  equity(@Query('limit') limit?: string, @Query('track') track?: string) {
    const n = limit ? Number(limit) : 200;
    return this.analytics.equityCurve(
      Number.isFinite(n) ? n : 200,
      track || undefined,
    );
  }

  @Post('ledger/backtest-formula')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({
    summary:
      'Replay settled ledger picks: production baseline vs versionId / inline spec / patch',
  })
  backtestFormula(@Body() body: FormulaBacktestDto) {
    return this.backtest.compareCandidate(body);
  }

  @Get('ledger/:id')
  @ApiOperation({ summary: 'Single ledger entry with full AI decision trace' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.getOne(id);
  }

  @Patch('ledger/:id')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({
    summary: 'Include/exclude a ledger entry from ROI, equity and stats (journal row stays)',
  })
  async patchEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchLedgerEntryDto,
  ) {
    try {
      return await this.analytics.setExcludedFromStats(id, body.excludedFromStats);
    } catch {
      throw new NotFoundException('Ledger entry not found');
    }
  }

  @Post('games/:id/ledger/capture')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({
    summary:
      'Runs the AI Decision agent for this game+track and writes the resulting bet/pass to the ledger (idempotent per game+track)',
  })
  captureDecision(@Param('id', ParseUUIDPipe) id: string, @Body() body: CaptureDecisionDto) {
    return this.capture.captureDecision(id, body.track ?? 'prematch', {
      force: body.force,
      allowUnlocked: body.allowUnlocked,
    });
  }

  @Post('games/:id/ledger/settle')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Settle pending ledger entries for a game once F5 score is known' })
  settleGame(@Param('id', ParseUUIDPipe) id: string) {
    return this.settle.settleGame(id);
  }

  @Post('ledger/settle-batch')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Settle pending ledger entries across all eligible games' })
  settleBatch(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.settle.settleBatch(Number.isFinite(n) ? n : 50);
  }
}
