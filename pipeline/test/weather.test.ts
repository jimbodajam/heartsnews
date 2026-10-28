// The weather at the ground: Open-Meteo's codes boiled down, where a match's weather is read, and the reporter's
// period lines allowing the weather (and only the weather) as a fact. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { liveMatch } from '../../shared/live.ts';
import { describeWeather, skyOf } from '../../shared/weather.ts';
import { checkPeriodLine, periodColourLine } from '../src/breaking/script.ts';
import type { Channel } from '../src/script/facts.ts';
import type { ScriptModel } from '../src/script/llm.ts';
import { pageAt, type Recording } from '../src/trim-recording.ts';
import { getWeather, groundLocation, matchWeather } from '../src/weather.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as Recording;
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const away = liveMatch(rec.teamEvent, 'heart-of-midlothian', pageAt(rec, Date.parse('2026-10-22T16:50:00Z')));
const home = { ...away, us: 'home' as const };
const ground = { name: 'Tynecastle Park', lat: 55.9393, lon: -3.2325 };
const reporter = channel.presenters.find((p) => p.id === channel.cast.pitchside)!;
const now = new Date('2026-10-28T15:00:00Z');

test('weather codes become a sky, and a phrase the reporter can say', () => {
  assert.deepEqual([0, 2, 45, 61, 80, 73, 95].map(skyOf), ['clear', 'overcast', 'fog', 'rain', 'rain', 'snow', 'rain']);
  const w = describeWeather({ code: 3, tempC: 6.6, windMph: 24 }, 'Tynecastle Park', now);
  assert.equal(w.phrase, 'grey and overcast, 7 degrees and a stiff breeze');
  assert.deepEqual([w.sky, w.windy, w.numbers], ['overcast', true, [7]]);
  assert.equal(describeWeather({ code: 61, tempC: 9, windMph: 5, precipMm: 4 }, 'x', now).phrase, 'pouring down, 9 degrees');
  const frozen = describeWeather({ code: 71, tempC: -2.4, windMph: 5 }, 'x', now);
  assert.deepEqual([frozen.phrase, frozen.numbers], ['snowing, below freezing', []]);
});

test('weather is read for our ground at home only', async () => {
  assert.equal(groundLocation(away, { ground }), undefined);
  assert.equal(groundLocation(home, { ground }), ground);
  assert.equal(groundLocation(home, {}), undefined);

  const urls: string[] = [];
  const ok = (async (url: string) => {
    urls.push(url);
    return Response.json({ current: { temperature_2m: 8.2, precipitation: 0, weather_code: 3, wind_speed_10m: 10 } });
  }) as unknown as typeof fetch;
  const w = await getWeather(ground, now, ok);
  assert.equal(w.place, 'Tynecastle Park');
  assert.match(urls[0], /latitude=55\.9393&longitude=-3\.2325/);

  assert.equal(await matchWeather(away, { ground }, now, ok), undefined);
  assert.equal(urls.length, 1, 'no read for an away game');
  const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
  assert.equal(await matchWeather(home, { ground }, now, down), undefined, 'a failed read means no weather, not a failed package');
});

test('period lines may carry the weather, and nothing else new', async () => {
  const w = describeWeather({ code: 3, tempC: 6.6, windMph: 5 }, 'Tynecastle Park', now);
  let prompt = '';
  const said = (line: string): ScriptModel => ({ name: 'fake', generateJson: async (p) => ((prompt = p), { line }) });
  const good = "We're under way here, grey and overcast and 7 degrees, and the home fans are loud.";
  assert.equal(await periodColourLine(said(good), reporter, home, 'ko1', ['Kick-off!'], w), `${good} Back to you in the studio.`);
  assert.match(prompt, /You may mention the weather[^]*grey and overcast, 7 degrees/);
  // Without weather, the prompt still bans it.
  await periodColourLine(said(good), reporter, home, 'ko1', ['Kick-off!']);
  assert.doesNotMatch(prompt, /You may mention the weather/);
  assert.match(prompt, /weather or crowd|, weather\./);
  // An invented temperature is still rejected; the real one isn't.
  assert.equal(await periodColourLine(said("We're under way here, and it's 12 degrees."), reporter, home, 'ko1', ['Kick-off!'], w), undefined);
  assert.ok(checkPeriodLine("It's 7 degrees here.", home, w.numbers));
});
