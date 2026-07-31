import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { UserStatus } from '../generated/prisma/client.js';
import { Statuses } from '../common/index.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GamePipelineService,
  type PipelineReason,
} from './game-pipeline.service.js';

class TickDto {
  @IsOptional()
  @IsString()
  game_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  mlb_game_pk?: number;
}

class RunDto {
  @IsIn(['slate', 'prematch', 'stage_watch', 'final_probe'])
  reason!: PipelineReason;
}

@ApiTags('ops')
@ApiBearerAuth()
@Statuses(UserStatus.ADMIN)
@Controller('ops/pipeline')
export class PipelineController {
  constructor(
    private readonly pipeline: GamePipelineService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  status() {
    return this.pipeline.getStatus();
  }

  @Post('tick')
  async tick(@Body() body: TickDto) {
    let gameId = body.game_id;
    if (!gameId && body.mlb_game_pk != null) {
      const g = await this.prisma.game.findUnique({
        where: { mlbGamePk: body.mlb_game_pk },
      });
      if (!g) {
        return { ok: false, message: 'Game not found' };
      }
      gameId = g.id;
    }
    if (!gameId) {
      return { ok: false, message: 'provide game_id or mlb_game_pk' };
    }
    return this.pipeline.tickGame(gameId);
  }

  @Post('run')
  run(@Body() body: RunDto) {
    return this.pipeline.tickUniverse(body.reason);
  }
}
