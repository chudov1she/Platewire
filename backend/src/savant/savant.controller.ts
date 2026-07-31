import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { SavantService, type SavantLayer } from './savant.service.js';

@ApiTags('savant')
@Controller()
export class SavantController {
  constructor(private readonly savant: SavantService) {}

  @Get('games/:id/savant')
  get(@Param('id') id: string) {
    return this.savant.getForGame(id, { autoFetch: true });
  }

  @Get('games/:id/savant/statcast')
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  statcast(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.savant.getStatcast(id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      autoFetch: true,
    });
  }

  @Post('games/:id/savant/refresh')
  @ApiQuery({
    name: 'layers',
    required: false,
    description: 'Comma list: preview,gamefeed,statcast',
    example: 'preview,gamefeed,statcast',
  })
  refresh(@Param('id') id: string, @Query('layers') layers?: string) {
    return this.savant.refresh(id, parseLayers(layers));
  }

  @Get('players/:mlbPlayerId')
  player(@Param('mlbPlayerId') mlbPlayerId: string) {
    return this.savant.getPlayer(Number(mlbPlayerId));
  }
}

function parseLayers(raw?: string): SavantLayer[] {
  if (!raw?.trim()) return ['preview', 'gamefeed'];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: SavantLayer[] = [];
  if (parts.includes('preview')) out.push('preview');
  if (parts.includes('gamefeed')) out.push('gamefeed');
  if (parts.includes('statcast')) out.push('statcast');
  return out.length ? out : ['preview', 'gamefeed'];
}
