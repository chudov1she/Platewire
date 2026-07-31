import { Module } from '@nestjs/common';
import { OpenMeteoClient } from './open-meteo.client.js';
import { WeatherController } from './weather.controller.js';
import { WeatherSyncService } from './weather-sync.service.js';

@Module({
  controllers: [WeatherController],
  providers: [OpenMeteoClient, WeatherSyncService],
  exports: [WeatherSyncService],
})
export class WeatherModule {}
