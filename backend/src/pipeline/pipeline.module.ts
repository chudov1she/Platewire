import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ContextModule } from '../context/context.module.js';
import { GamesModule } from '../games/games.module.js';
import { OddsModule } from '../odds/odds.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { OfficeModule } from '../office/office.module.js';
import { GamePipelineService } from './game-pipeline.service.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineScheduler } from './pipeline.scheduler.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GamesModule,
    OddsModule,
    WeatherModule,
    ContextModule,
    OfficeModule,
  ],
  controllers: [PipelineController],
  providers: [GamePipelineService, PipelineScheduler],
  exports: [GamePipelineService],
})
export class PipelineModule {}
