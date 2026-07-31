import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { OddsService } from './odds.service.js';
import type { F5OddsStage } from './f5-scope.js';

class ResolveDto {
  @IsOptional()
  @IsString()
  team1?: string;

  @IsOptional()
  @IsString()
  team2?: string;

  @IsOptional()
  @IsString()
  query?: string;
}

class GameOddsDto {
  @IsOptional()
  @IsBoolean()
  require_markets?: boolean;

  @IsOptional()
  @IsBoolean()
  force_rebind?: boolean;
}

class GameF5OddsDto {
  @IsOptional()
  @IsBoolean()
  require_markets?: boolean;

  @IsOptional()
  @IsBoolean()
  force_rebind?: boolean;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsIn(['prematch', 'inn1', 'inn2'])
  stage?: F5OddsStage;
}

@ApiTags('odds')
@Controller()
export class OddsController {
  constructor(private readonly odds: OddsService) {}

  @Get('odds/winline/matches')
  @ApiQuery({ name: 'refresh', required: false })
  winlineMatches(@Query('refresh') refresh?: string) {
    return this.odds.listWinlineMatches({
      force: refresh === '1' || refresh === 'true',
    });
  }

  @Post('odds/winline/resolve')
  resolve(@Body() body: ResolveDto) {
    return this.odds.resolve(body);
  }

  @Post('games/:id/odds')
  gameOdds(@Param('id') id: string, @Body() body: GameOddsDto) {
    return this.odds.fetchOddsForGame(id, {
      requireMarkets: body.require_markets !== false,
      forceRebind: body.force_rebind === true,
    });
  }

  @Post('games/:id/odds/f5')
  gameF5Odds(@Param('id') id: string, @Body() body: GameF5OddsDto) {
    return this.odds.fetchF5ForGame(id, {
      requireMarkets: body.require_markets !== false,
      forceRebind: body.force_rebind === true,
      force: body.force === true,
      stage: body.stage,
    });
  }

  @Get('games/:id/odds/f5')
  @ApiQuery({ name: 'stage', required: false })
  latestF5Odds(@Param('id') id: string, @Query('stage') stage?: string) {
    return this.odds.getLatestF5(id, { stage });
  }
}
