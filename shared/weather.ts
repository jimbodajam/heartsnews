// The weather at a ground, for the pitchside reporter's colour (and, later, the pitchside scene). Nothing here knows
// about a club or a place: it's a small description of conditions, built from Open-Meteo's current reading.

export type Sky = 'clear' | 'overcast' | 'rain' | 'snow' | 'fog';

export interface Weather {
  sky: Sky;
  windy: boolean;
  tempC: number;
  /** Where it's for, e.g. "Tynecastle Park". */
  place: string;
  /** When it was read, ISO. */
  at: string;
  /** What the reporter may say, e.g. "grey and overcast, 7 degrees and a stiff breeze". */
  phrase: string;
  /** The numbers in `phrase`, for the line checks. */
  numbers: number[];
}

/** Open-Meteo's weather codes (WMO) to the sky we draw and talk about. */
export function skyOf(code: number): Sky {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain';
}

/** Wind at or above this (mph) is worth a mention. */
export const WINDY_MPH = 20;

const SKY_WORDS: Record<Sky, string> = {
  clear: 'dry and bright',
  overcast: 'grey and overcast',
  rain: 'raining',
  snow: 'snowing',
  fog: 'foggy',
};

export interface Conditions {
  code: number;
  tempC: number;
  windMph: number;
  /** Rain in the last hour, mm. */
  precipMm?: number;
}

/** The weather record for a reading at a place. */
export function describeWeather(c: Conditions, place: string, at: Date): Weather {
  const sky = skyOf(c.code);
  const windy = c.windMph >= WINDY_MPH;
  const temp = Math.round(c.tempC);
  const heavy = sky === 'rain' && (c.precipMm ?? 0) >= 2.5;
  const words = heavy ? 'pouring down' : SKY_WORDS[sky];
  const cold = temp < 0 ? 'below freezing' : `${temp} degrees`;
  return {
    sky,
    windy,
    tempC: c.tempC,
    place,
    at: at.toISOString(),
    phrase: `${words}, ${cold}${windy ? ' and a stiff breeze' : ''}`,
    numbers: temp < 0 ? [] : [temp],
  };
}
