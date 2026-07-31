import { Module } from '@nestjs/common';
import { FormulaModule } from '../formula/formula.module.js';
import { AiModule } from '../ai/ai.module.js';
import { OddsModule } from '../odds/odds.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { LedgerAnalyticsModule } from './ledger-analytics.module.js';
import { LedgerCaptureService } from './ledger-capture.service.js';
import { LedgerController } from './ledger.controller.js';

@Module({
  imports: [
    FormulaModule,
    LedgerAnalyticsModule,
    AiModule,
    TelegramModule,
    OddsModule,
  ],
  controllers: [LedgerController],
  providers: [LedgerCaptureService],
  exports: [LedgerCaptureService, LedgerAnalyticsModule],
})
export class LedgerModule {}
