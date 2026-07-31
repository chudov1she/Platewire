import { Injectable, Logger } from '@nestjs/common';

const OPEN_METEO_BASE = 'https://api.open-meteo.com';

export type OpenMeteoHourly = {
  time?: string[];
  temperature_2m?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
  dew_point_2m?: Array<number | null>;
  apparent_temperature?: Array<number | null>;
  precipitation?: Array<number | null>;
  rain?: Array<number | null>;
  weather_code?: Array<number | null>;
  pressure_msl?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
};

export type OpenMeteoForecast = {
  latitude?: number;
  longitude?: number;
  hourly?: OpenMeteoHourly;
};

@Injectable()
export class OpenMeteoClient {
  private readonly logger = new Logger(OpenMeteoClient.name);

  async forecast(
    latitude: number,
    longitude: number,
    startDate: string,
    endDate: string,
  ): Promise<OpenMeteoForecast> {
    const url = new URL(`${OPEN_METEO_BASE}/v1/forecast`);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('timezone', 'UTC');
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
    url.searchParams.set(
      'hourly',
      [
        'temperature_2m',
        'relative_humidity_2m',
        'dew_point_2m',
        'apparent_temperature',
        'precipitation',
        'rain',
        'weather_code',
        'pressure_msl',
        'cloud_cover',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
      ].join(','),
    );

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Open-Meteo ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    return (await res.json()) as OpenMeteoForecast;
  }
}

export function weatherCodeText(code: number | null | undefined): string | null {
  if (code == null) return null;
  return (
    {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      71: 'Slight snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      95: 'Thunderstorm',
    }[code] ?? `Weather code ${code}`
  );
}

export function relativeToGame(
  startsAt: Date,
  observedAt: Date,
): 'pregame' | 'live_window' | 'postgame' {
  const deltaHours =
    (observedAt.getTime() - startsAt.getTime()) / (3600 * 1000);
  if (deltaHours < -1) return 'pregame';
  if (deltaHours <= 4) return 'live_window';
  return 'postgame';
}
