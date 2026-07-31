import { Module, forwardRef } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { SavantController } from './savant.controller.js';
import { SavantGamefeedService } from './savant-gamefeed.service.js';
import { SavantPreviewService } from './savant-preview.service.js';
import { SavantService } from './savant.service.js';
import { SavantStatcastService } from './savant-statcast.service.js';

@Module({
  imports: [forwardRef(() => ContextModule)],
  controllers: [SavantController],
  providers: [
    SavantService,
    SavantPreviewService,
    SavantGamefeedService,
    SavantStatcastService,
  ],
  exports: [SavantService, SavantPreviewService],
})
export class SavantModule {}
