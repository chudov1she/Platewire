import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '../generated/prisma/client.js';
import { Statuses } from '../common/index.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { CurationAgentService } from './curation-agent.service.js';
import { RunCurationDto } from './dto/agent.dto.js';

@ApiTags('agent')
@ApiBearerAuth()
@Controller('agent')
export class AiController {
  constructor(
    private readonly curation: CurationAgentService,
    private readonly proposals: AgentProposalService,
  ) {}

  @Post('curation/run')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Manually trigger a Curation-agent review pass' })
  runCuration(@Body() body: RunCurationDto) {
    return this.curation.run(body.prompt);
  }

  @Get('proposals')
  @ApiOperation({ summary: 'List formula-change proposals from the Curation agent' })
  listProposals(@Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 20;
    return this.proposals.list(Number.isFinite(n) ? n : 20);
  }

  @Get('proposals/:id')
  @ApiOperation({ summary: 'Get a single proposal' })
  getProposal(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.getOne(id);
  }

  @Get('proposals/:id/preview')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({
    summary:
      'Preview resolved spec + live ledger backtest against current production before apply',
  })
  previewProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') days?: string,
    @Query('track') track?: string,
  ) {
    const n = days ? Number(days) : 14;
    return this.proposals.preview(id, {
      days: Number.isFinite(n) ? n : 14,
      track: track || undefined,
      liveBacktest: true,
    });
  }

  @Post('proposals/:id/reject')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({ summary: 'Reject a proposal' })
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.reject(id);
  }

  @Post('proposals/:id/apply')
  @Statuses(UserStatus.ADMIN)
  @ApiOperation({
    summary:
      'Human-only: patch current production with the proposal, create + activate FormulaVersion',
  })
  apply(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.apply(id);
  }
}
