import { Module } from '@nestjs/common';
import { OfficeController } from './office.controller.js';
import { OfficeDeskService } from './office-desk.service.js';
import { OfficeEventsService } from './office-events.service.js';

@Module({
  controllers: [OfficeController],
  providers: [OfficeEventsService, OfficeDeskService],
  exports: [OfficeEventsService, OfficeDeskService],
})
export class OfficeModule {}
