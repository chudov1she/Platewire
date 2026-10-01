import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OfficeDeskService } from './office-desk.service.js';
import { OfficeEventsService } from './office-events.service.js';

@ApiTags('office')
@Controller('office')
export class OfficeController {
  constructor(
    private readonly desk: OfficeDeskService,
    private readonly events: OfficeEventsService,
  ) {}

  @Get('formula')
  formula() {
    return this.desk.activeFormula();
  }

  @Get('formulas')
  formulas() {
    return this.desk.listFormulas();
  }

  @Post('formulas')
  createFormula(
    @Body()
    body: {
      version?: string;
      value_threshold?: number;
      overround?: number;
      constants?: Record<string, unknown>;
      notes?: string;
      activate?: boolean;
    },
  ) {
    return this.desk.createFormula(body);
  }

  @Post('formulas/activate')
  activate(@Body() body: { version?: string }) {
    return this.desk.activateFormula(body.version ?? '');
  }

  @Get('sources')
  sources() {
    return this.desk.listSources();
  }

  @Put('sources/:key')
  saveSource(
    @Param('key') key: string,
    @Body()
    body: {
      title?: string;
      adapter?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      notes?: string | null;
    },
  ) {
    return this.desk.upsertSource(key, body);
  }

  @Get('runs')
  runs(@Query('limit') limit?: string) {
    return this.desk.listRuns(limit ? Number(limit) : 20);
  }

  @Post('runs')
  startRun(
    @Body()
    body: {
      game_id?: string;
      matchup?: string;
      reason?: string;
      stage?: string;
      formula?: string;
    },
  ) {
    return this.desk.startRun(body);
  }

  @Post('games/:id/settled')
  settled(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.events.ackSettlement(id, body.reason ?? '');
  }

  @Post('runs/:id/finish')
  finishRun(
    @Param('id') id: string,
    @Body() body: { status?: string; summary?: string },
  ) {
    return this.desk.finishRun(id, body);
  }
}
