import { Module } from '@nestjs/common';
import { FormulaModule } from '../formula/formula.module.js';
import { LedgerAnalyticsService } from './ledger-analytics.service.js';
import { LedgerBacktestService } from './ledger-backtest.service.js';
import { LedgerSettleService } from './ledger-settle.service.js';

/**
 * Split out from LedgerModule so both LedgerModule (capture, which needs
 * the AI Decision agent) and AiModule (curation tools, which need ledger
 * analytics/backtest) can depend on it without a module import cycle.
 */
@Module({
  imports: [FormulaModule],
  providers: [LedgerAnalyticsService, LedgerBacktestService, LedgerSettleService],
  exports: [LedgerAnalyticsService, LedgerBacktestService, LedgerSettleService],
})
export class LedgerAnalyticsModule {}
