import {
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { GamesService } from './games.service.js';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('today')
  today() {
    return this.games.listToday();
  }

  @Get()
  @ApiQuery({ name: 'date', required: true, example: '2026-07-29' })
  list(@Query('date') date: string) {
    return this.games.listByDate(date, { autoSync: true });
  }

  @Post('sync')
  @ApiQuery({ name: 'date', required: false })
  sync(@Query('date') date?: string) {
    return this.games.syncDate(date);
  }

  @Get(':id')
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  getOne(
    @Param('id') id: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.games.getById(id, {
      refresh: refresh === '1' || refresh === 'true',
    });
  }
}
