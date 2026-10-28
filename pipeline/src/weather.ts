// The weather at a place, from Open-Meteo (free, no key). The only code that talks to it; getWeather takes any
// coordinates, and groundLocation is the one place that decides where a match's weather is for.

import type { LiveMatch } from '../../shared/live.ts';
import { describeWeather, type Weather } from '../../shared/weather.ts';

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Where to read the weather for a match: our ground for a home game. Away grounds would be a lookup from the venue
 * name to coordinates, here, and nothing else would change.
 */
export function groundLocation(m: LiveMatch, club: { ground?: Place }): Place | undefined {
  return m.us === 'home' ? club.ground : undefined;
}

/** The current conditions at a place. Throws if Open-Meteo can't be read; callers carry on without weather. */
export async function getWeather(place: Place, now = new Date(), fetcher: typeof fetch = fetch): Promise<Weather> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=temperature_2m,precipitation,weather_code,wind_speed_10m&wind_speed_unit=mph';
  const res = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  const { current: c } = (await res.json()) as {
    current?: { temperature_2m: number; precipitation: number; weather_code: number; wind_speed_10m: number };
  };
  if (!c) throw new Error('Open-Meteo: no current conditions');
  return describeWeather({ code: c.weather_code, tempC: c.temperature_2m, windMph: c.wind_speed_10m, precipMm: c.precipitation }, place.name, now);
}

/** The weather for a match, or undefined if it's not somewhere we read it for, or the read fails. */
export async function matchWeather(m: LiveMatch, club: { ground?: Place }, now = new Date(), fetcher?: typeof fetch): Promise<Weather | undefined> {
  const place = groundLocation(m, club);
  if (!place) return undefined;
  try {
    return await getWeather(place, now, fetcher);
  } catch (err) {
    console.log(`[breaking] No weather (${(err as Error).message}); carrying on without`);
    return undefined;
  }
}
