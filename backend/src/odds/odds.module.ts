import { Module } from '@nestjs/common';
import { OddsController } from './odds.controller.js';
import { OddsService } from './odds.service.js';
import { WinlineDiscoveryService } from './winline/discovery.service.js';
import { WinlineHtmlMarketsService } from './winline/html-markets.service.js';

@Module({
  controllers: [OddsController],
  providers: [
    OddsService,
    WinlineDiscoveryService,
    WinlineHtmlMarketsService,
  ],
  exports: [OddsService],
})
export class OddsModule {}
