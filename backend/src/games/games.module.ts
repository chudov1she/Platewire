import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';
import { GamesSyncService } from './games-sync.service.js';

@Module({
  imports: [ContextModule],
  controllers: [GamesController],
  providers: [GamesService, GamesSyncService],
  exports: [GamesService, GamesSyncService],
})
export class GamesModule {}
