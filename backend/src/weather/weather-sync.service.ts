import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MlbStatsClient } from '../games/mlb-stats.client.js';
import {
  OpenMeteoClient,
  relativeToGame,
  weatherCodeText,
} from './open-meteo.client.js';

const SOURCE = 'open_meteo';
const MIN_RESYNC_MS = 15 * 60 * 1000;

@Injectable()
export class WeatherSyncService {
  private readonly logger = new Logger(WeatherSyncService.name);
  private readonly mlb = new MlbStatsClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly openMeteo: OpenMeteoClient,
  ) {}

  async syncGame(
    gameId: string,
    opts: { force?: boolean } = {},
  ): Promise<{
    gameId: string;
    observations: number;
    skipped?: boolean;
    reason?: string;
  }> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { venue: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    if (!game.venueId || !game.venue) {
      return { gameId, observations: 0, reason: 'no_venue' };
    }

    if (!opts.force) {
      const latest = await this.prisma.weatherObservation.findFirst({
        where: { gameId, source: SOURCE },
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      });
      if (
        latest &&
        Date.now() - latest.capturedAt.getTime() < MIN_RESYNC_MS
      ) {
        return { gameId, observations: 0, skipped: true, reason: 'fresh' };
      }
    }

    const venue = await this.ensureVenueCoordinates(game.venue);
    if (venue.latitude == null || venue.longitude == null) {
      return { gameId, observations: 0, reason: 'no_coordinates' };
    }

    const start = new Date(game.gameDateUtc.getTime() - 6 * 3600_000);
    const end = new Date(game.gameDateUtc.getTime() + 6 * 3600_000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const forecast = await this.openMeteo.forecast(
      venue.latitude,
      venue.longitude,
      startDate,
      endDate,
    );
    const hourly = forecast.hourly ?? {};
    const times = hourly.time ?? [];
    const capturedAt = new Date();
    let observations = 0;

    for (let i = 0; i < times.length; i++) {
      const observedAt = parseOpenMeteoTime(times[i]);
      if (!observedAt) continue;
      const code = numAt(hourly.weather_code, i);
      await this.prisma.weatherObservation.upsert({
        where: {
          gameId_source_observedAt: {
            gameId,
            source: SOURCE,
            observedAt,
          },
        },
        create: {
          gameId,
          venueId: venue.id,
          source: SOURCE,
          observedAt,
          relativeToGame: relativeToGame(game.gameDateUtc, observedAt),
          temperatureF: numAt(hourly.temperature_2m, i),
          apparentTemperatureF: numAt(hourly.apparent_temperature, i),
          humidity: numAt(hourly.relative_humidity_2m, i),
          dewPointF: numAt(hourly.dew_point_2m, i),
          pressureHpa: numAt(hourly.pressure_msl, i),
          precipitationIn: numAt(hourly.precipitation, i),
          cloudCover: numAt(hourly.cloud_cover, i),
          windSpeedMph: numAt(hourly.wind_speed_10m, i),
          windGustsMph: numAt(hourly.wind_gusts_10m, i),
          windDirectionDeg: numAt(hourly.wind_direction_10m, i),
          weatherCode: code,
          conditionText: weatherCodeText(code),
          capturedAt,
        },
        update: {
          venueId: venue.id,
          relativeToGame: relativeToGame(game.gameDateUtc, observedAt),
          temperatureF: numAt(hourly.temperature_2m, i),
          apparentTemperatureF: numAt(hourly.apparent_temperature, i),
          humidity: numAt(hourly.relative_humidity_2m, i),
          dewPointF: numAt(hourly.dew_point_2m, i),
          pressureHpa: numAt(hourly.pressure_msl, i),
          precipitationIn: numAt(hourly.precipitation, i),
          cloudCover: numAt(hourly.cloud_cover, i),
          windSpeedMph: numAt(hourly.wind_speed_10m, i),
          windGustsMph: numAt(hourly.wind_gusts_10m, i),
          windDirectionDeg: numAt(hourly.wind_direction_10m, i),
          weatherCode: code,
          conditionText: weatherCodeText(code),
          capturedAt,
        },
      });
      observations += 1;
    }

    this.logger.log(
      `weather sync game=${game.mlbGamePk} observations=${observations}`,
    );
    return { gameId, observations };
  }

  async listForGame(gameId: string, opts: { autoFetch?: boolean } = {}) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException('Game not found');

    let items = await this.prisma.weatherObservation.findMany({
      where: { gameId },
      orderBy: { observedAt: 'asc' },
    });

    if (opts.autoFetch && items.length === 0) {
      await this.syncGame(gameId, { force: true });
      items = await this.prisma.weatherObservation.findMany({
        where: { gameId },
        orderBy: { observedAt: 'asc' },
      });
    }

    const mapped = items.map((row) => ({
      observed_at: row.observedAt.toISOString(),
      relative_to_game: row.relativeToGame,
      temperature_f: row.temperatureF,
      apparent_temperature_f: row.apparentTemperatureF,
      humidity: row.humidity,
      dew_point_f: row.dewPointF,
      pressure_hpa: row.pressureHpa,
      precipitation_in: row.precipitationIn,
      cloud_cover: row.cloudCover,
      wind_speed_mph: row.windSpeedMph,
      wind_gusts_mph: row.windGustsMph,
      wind_direction_deg: row.windDirectionDeg,
      weather_code: row.weatherCode,
      condition_text: row.conditionText,
      source: row.source,
      captured_at: row.capturedAt.toISOString(),
    }));

    const live = mapped.find((i) => i.relative_to_game === 'live_window');
    const summary = live ?? mapped[0] ?? null;

    return {
      ok: true,
      game_id: gameId,
      mlb_game_pk: game.mlbGamePk,
      count: mapped.length,
      summary,
      observations: mapped,
    };
  }

  private async ensureVenueCoordinates(venue: {
    id: string;
    mlbVenueId: number;
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
  }) {
    if (venue.latitude != null && venue.longitude != null) return venue;
    try {
      const data = await this.mlb.fetchVenue(venue.mlbVenueId);
      const loc = data?.venues?.[0]?.location;
      const coords = loc?.defaultCoordinates;
      if (coords?.latitude == null || coords?.longitude == null) return venue;
      return this.prisma.venue.update({
        where: { id: venue.id },
        data: {
          latitude: Number(coords.latitude),
          longitude: Number(coords.longitude),
          city: loc?.city ?? venue.city,
          state: loc?.stateAbbrev ?? loc?.state ?? venue.state,
          country: loc?.country ?? venue.country,
        },
      });
    } catch (err) {
      this.logger.warn(
        `venue coords ${venue.mlbVenueId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return venue;
    }
  }
}

function parseOpenMeteoTime(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numAt(
  arr: Array<number | null> | undefined,
  index: number,
): number | null {
  if (!arr || index >= arr.length) return null;
  const v = arr[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
