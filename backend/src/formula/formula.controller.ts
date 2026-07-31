import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '../generated/prisma/client.js';
import { Statuses } from '../common/index.js';
import { isF5OddsStage } from '../odds/f5-scope.js';
import {
  CreateFormulaVersionDto,
  EvalFormulaDto,
  PutProductionDto,
  ValidateFormulaDto,
} from './dto/formula.dto.js';
import { FormulaRunnerService } from './formula-runner.service.js';
import { FormulaStoreService } from './formula-store.service.js';
import { MatchupInputsService } from './matchup-inputs.service.js';
import { MarketLoaderService } from './market-loader.service.js';
import { SignalReadinessService } from './signal-readiness.service.js';
import { normalizeFormulaSpec } from './formula-spec.js';

@ApiTags('formula')
@ApiBearerAuth()
@Controller()
export class FormulaController {
  constructor(
    private readonly store: FormulaStoreService,
    private readonly runner: FormulaRunnerService,
    private readonly matchup: MatchupInputsService,
    private readonly markets: MarketLoaderService,
    private readonly readiness: SignalReadinessService,
  ) {}

  @Get('formula/production')
  @ApiOperation({ summary: 'Current production FormulaSpec + env keys' })
  getProduction() {
    return this.store.getProduction();
  }

  @Get('formula/versions')
  @ApiOperation({ summary: 'List formula versions (newest first)' })
  listVersions(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.store.listVersions(Number.isFinite(n) ? n : 50);
  }

  @Get('formula/versions/:id')
  @ApiOperation({ summary: 'Get formula version by id' })
  getVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.store.getVersion(id);
  }

  @Post('formula/versions')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Create immutable formula version' })
  createVersion(@Body() body: CreateFormulaVersionDto) {
    return this.store.createVersion({ ...body, createdBy: 'human' });
  }

  @Put('formula/production')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Create version and set as production (human only)' })
  putProduction(@Body() body: PutProductionDto) {
    return this.store.putProduction(body);
  }

  @Post('formula/versions/:id/activate')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Point production at an existing version (human only)' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.store.activate(id);
  }

  @Post('formula/validate')
  @ApiOperation({ summary: 'Validate FormulaSpec expressions without saving' })
  validate(@Body() body: ValidateFormulaDto) {
    const spec = normalizeFormulaSpec(body.spec);
    const errors = this.runner.validate(spec);
    return { ok: errors.length === 0, errors, spec };
  }

  @Get('games/:id/readiness')
  @ApiOperation({
    summary: 'Signal readiness for game+track (hard/soft gaps + score)',
  })
  async getReadiness(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('track') track?: string,
  ) {
    const trackPoint = track && isF5OddsStage(track) ? track : 'prematch';
    const built = await this.matchup.build(id);
    const marketLoad = await this.markets.load(id, trackPoint);
    const readiness = this.readiness.evaluate({
      track: trackPoint,
      input_sources: built.input_sources,
      market: marketLoad,
      context: built.context,
    });
    return {
      gameId: id,
      track: marketLoad.track,
      ...readiness,
      marketsUsed: marketLoad.marketsUsed,
      locked: marketLoad.locked,
      context: built.context,
    };
  }

  @Post('games/:id/formula/eval')
  @ApiOperation({
    summary:
      'Evaluate After-5 formula for a game (inline spec -> versionId -> production)',
  })
  async evalGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EvalFormulaDto,
  ) {
    const resolved = await this.store.resolveSpec({
      versionId: body.versionId,
      spec: body.spec,
    });
    const built = await this.matchup.build(id);
    const marketLoad = await this.markets.load(id, body.track ?? 'prematch');
    const readiness = this.readiness.evaluate({
      track: marketLoad.track,
      input_sources: built.input_sources,
      market: marketLoad,
      context: built.context,
    });

    const analysis = this.runner.analyze(
      built.inputs,
      marketLoad.markets,
      resolved.spec,
    );

    const notes = [
      ...built.notes,
      ...marketLoad.notes,
      ...analysis.notes,
      ...(resolved.dryRun ? ['dry_run_inline_spec'] : []),
    ];

    return {
      gameId: id,
      formulaVersionId: resolved.formulaVersionId,
      versionLabel: resolved.versionLabel,
      specVersion: resolved.spec.version,
      dryRun: resolved.dryRun,
      track: marketLoad.track,
      marketsUsed: marketLoad.marketsUsed,
      locked: marketLoad.locked,
      readiness,
      lambda_home: analysis.lambda_home,
      lambda_away: analysis.lambda_away,
      expected_home_runs: analysis.expected_home_runs,
      expected_away_runs: analysis.expected_away_runs,
      expected_total: analysis.expected_total,
      p_home_lead: analysis.p_home_lead,
      p_tie: analysis.p_tie,
      p_away_lead: analysis.p_away_lead,
      p_over_4_5: analysis.p_over_4_5,
      avg_total: analysis.avg_total,
      value_bets: analysis.value_bets,
      signals: analysis.signals,
      notes,
      input_sources: built.input_sources,
      breakdown: analysis.breakdown,
      simulation_mode: analysis.simulation_mode,
      formula_version: analysis.formula_version,
    };
  }
}
