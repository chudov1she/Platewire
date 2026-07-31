import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ContextModule } from '../context/context.module.js';
import { GamesModule } from '../games/games.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OddsModule } from '../odds/odds.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { GamePipelineService } from './game-pipeline.service.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineScheduler } from './pipeline.scheduler.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GamesModule,
    OddsModule,
    LedgerModule,
    WeatherModule,
    ContextModule,
  ],
  controllers: [PipelineController],
  providers: [GamePipelineService, PipelineScheduler],
  exports: [GamePipelineService],
})
export class PipelineModule {}
