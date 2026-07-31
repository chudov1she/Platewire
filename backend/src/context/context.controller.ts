import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ContextService } from './context.service.js';

@ApiTags('context')
@Controller()
export class ContextController {
  constructor(private readonly context: ContextService) {}

  @Get('games/:id/context')
  get(@Param('id') id: string) {
    return this.context.getForGame(id, { autoSync: true });
  }

  @Post('games/:id/context/refresh')
  refresh(@Param('id') id: string) {
    return this.context.refresh(id);
  }

  @Get('players/:mlbPlayerId/features')
  @ApiQuery({ name: 'sync', required: false })
  features(
    @Param('mlbPlayerId') mlbPlayerId: string,
    @Query('sync') sync?: string,
  ) {
    return this.context.getPlayerFeatures(Number(mlbPlayerId), {
      sync: sync === '1' || sync === 'true',
    });
  }

  @Get('officials/:mlbOfficialId/features')
  @ApiQuery({ name: 'sync', required: false })
  officialFeatures(
    @Param('mlbOfficialId') mlbOfficialId: string,
    @Query('sync') sync?: string,
  ) {
    return this.context.getOfficialFeatures(Number(mlbOfficialId), {
      sync: sync === '1' || sync === 'true',
    });
  }
}
