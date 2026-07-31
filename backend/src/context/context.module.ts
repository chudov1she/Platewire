import { Module, forwardRef } from '@nestjs/common';
import { SavantModule } from '../savant/savant.module.js';
import { ContextController } from './context.controller.js';
import { ContextService } from './context.service.js';
import { OfficialFeaturesService } from './official-features.service.js';
import { PlayerFeaturesService } from './player-features.service.js';
import { UmpRollupService } from './ump-rollup.service.js';
import { UmpScorecardsClient } from './ump-scorecards.client.js';
import { UmpScorecardsService } from './ump-scorecards.service.js';

@Module({
  imports: [forwardRef(() => SavantModule)],
  controllers: [ContextController],
  providers: [
    ContextService,
    PlayerFeaturesService,
    OfficialFeaturesService,
    UmpRollupService,
    UmpScorecardsClient,
    UmpScorecardsService,
  ],
  exports: [
    ContextService,
    PlayerFeaturesService,
    OfficialFeaturesService,
    UmpRollupService,
    UmpScorecardsService,
  ],
})
export class ContextModule {}
