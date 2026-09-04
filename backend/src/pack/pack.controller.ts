import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GamePackService } from './game-pack.service.js';

@ApiTags('games')
@ApiBearerAuth()
@Controller('games')
export class PackController {
  constructor(private readonly pack: GamePackService) {}

  @Get(':id/pack')
  @ApiOperation({
    summary:
      'Full collected knowledge pack for one game (facts only — no formula/bets)',
  })
  getPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.pack.getPack(id);
  }
}
