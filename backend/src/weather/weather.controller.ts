import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WeatherSyncService } from './weather-sync.service.js';

@ApiTags('weather')
@Controller('games/:id/weather')
export class WeatherController {
  constructor(private readonly weather: WeatherSyncService) {}

  @Get()
  get(@Param('id') id: string) {
    return this.weather.listForGame(id, { autoFetch: true });
  }

  @Post('refresh')
  async refresh(@Param('id') id: string) {
    const sync = await this.weather.syncGame(id, { force: true });
    const payload = await this.weather.listForGame(id);
    return { ...payload, sync };
  }
}
