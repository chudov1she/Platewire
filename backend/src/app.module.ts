import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ContextModule } from './context/context.module.js';
import { FormulaModule } from './formula/formula.module.js';
import { GamesModule } from './games/games.module.js';
import { HealthModule } from './health/health.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { OddsModule } from './odds/odds.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SavantModule } from './savant/savant.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { UsersModule } from './users/users.module.js';
import { WeatherModule } from './weather/weather.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
    GamesModule,
    WeatherModule,
    OddsModule,
    SavantModule,
    ContextModule,
    FormulaModule,
    AiModule,
    TelegramModule,
    LedgerModule,
    PipelineModule,
  ],
})
export class AppModule {}
