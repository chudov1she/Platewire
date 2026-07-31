import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { UsersModule } from '../users/users.module.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramNotifyService } from './telegram-notify.service.js';
import { TelegramUpdatesService } from './telegram-updates.service.js';

@Module({
  imports: [AiModule, UsersModule],
  providers: [TelegramBotService, TelegramNotifyService, TelegramUpdatesService],
  exports: [TelegramBotService, TelegramNotifyService],
})
export class TelegramModule {}
