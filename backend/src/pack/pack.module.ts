import { Module, forwardRef } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { GamesModule } from '../games/games.module.js';
import { OddsModule } from '../odds/odds.module.js';
import { WeatherModule } from '../weather/weather.module.js';
import { GamePackService } from './game-pack.service.js';
import { MatchupInputsService } from './matchup-inputs.service.js';
import { PackController } from './pack.controller.js';

@Module({
  imports: [
    ContextModule,
    OddsModule,
    WeatherModule,
    forwardRef(() => GamesModule),
  ],
  controllers: [PackController],
  providers: [MatchupInputsService, GamePackService],
  exports: [MatchupInputsService, GamePackService],
})
export class PackModule {}
