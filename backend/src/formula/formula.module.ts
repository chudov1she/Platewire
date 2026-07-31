import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { FormulaController } from './formula.controller.js';
import { FormulaRunnerService } from './formula-runner.service.js';
import { FormulaStoreService } from './formula-store.service.js';
import { MatchupInputsService } from './matchup-inputs.service.js';
import { MarketLoaderService } from './market-loader.service.js';
import { SignalReadinessService } from './signal-readiness.service.js';

@Module({
  imports: [ContextModule],
  controllers: [FormulaController],
  providers: [
    FormulaRunnerService,
    FormulaStoreService,
    MatchupInputsService,
    MarketLoaderService,
    SignalReadinessService,
  ],
  exports: [
    FormulaRunnerService,
    FormulaStoreService,
    MatchupInputsService,
    MarketLoaderService,
    SignalReadinessService,
  ],
})
export class FormulaModule {}
