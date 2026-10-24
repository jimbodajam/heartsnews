// Big games: Hibs, Celtic, Rangers, Europe and cup semi-finals and finals get a longer, stronger build-up and a
// script that knows what's riding on them. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bigGame, bigGameFor, detectPhase } from '../src/matchday.ts';
import { liveness } from '../src/onair.ts';
import { boostStories, type Story } from '../src/stories.ts';
import type { Storyline } from '../src/storylines.ts';
import type { ClubConfig, Fixture } from '../src/types.ts';

const club = JSON.parse(readFileSync(new URL('../../clubs/hearts.json', import.meta.url), 'utf8')) as ClubConfig;
const fixture = (away: string, competition = 'Scottish Premiership', date = '2026-10-31T15:00:00.000Z'): Fixture => ({ date, home: 'Hearts', away, competition });

test('the derby, Celtic, Rangers and Europe are big games; Motherwell and Berwick Rangers are not', () => {
  assert.equal(bigGame(club, fixture('Hibernian')), 'the Edinburgh derby');
  assert.equal(bigGame(club, { home: 'Hibs', away: 'Hearts' }), 'the Edinburgh derby');
  assert.equal(bigGame(club, fixture('Celtic')), 'a big one against Celtic');
  assert.equal(bigGame(club, fixture('Rangers', 'League Cup')), 'a big one against Rangers');
  assert.equal(bigGame(club, fixture('Trabzonspor', 'UEFA Conference League')), 'a European night');
  assert.equal(bigGame(club, fixture('Motherwell')), undefined);
  assert.equal(bigGame(club, fixture('Berwick Rangers', 'Scottish Cup')), undefined);
});

test("a cup's semi-final and final are big, from the news, but not the final whistle", () => {
  const cup = fixture('Aberdeen', 'Scottish Cup');
  assert.equal(bigGame(club, cup, 'Hearts face Aberdeen in the Scottish Cup semi-final at Hampden'), 'the Scottish Cup semi-final');
  assert.equal(bigGame(club, cup, 'Tickets for the cup final go on sale'), 'the Scottish Cup final');
  assert.equal(bigGame(club, cup, 'Hearts held on until the final whistle'), undefined);
  assert.equal(bigGame(club, fixture('Aberdeen'), 'Aberdeen reached the cup final last year'), undefined, 'a league game');
  // A storyline's fixture has no competition: the news has to name the cup.
  assert.equal(bigGame(club, { home: 'Hearts', away: 'Aberdeen' }, 'Ahead of the League Cup semi-final'), 'the League Cup semi-final');
});

test('a big game gets its build-up from three days out, before the bulletin turns to the preview', () => {
  const derby = fixture('Hibernian');
  const midweek = fixture('Motherwell', 'Scottish Premiership', '2026-10-28T19:45:00.000Z');
  const match = { last: [], next: [midweek, derby], table: [] } as never;
  const tue = new Date('2026-10-28T09:00:00Z'); // the derby is 3 days 6 hours away
  const thu = new Date('2026-10-29T12:00:00Z'); // just over two days
  assert.equal(bigGameFor(club, detectPhase(match, tue), [midweek, derby], tue), undefined);
  const big = bigGameFor(club, detectPhase(match, thu), [derby], thu);
  assert.equal(big?.billing, 'the Edinburgh derby');
  assert.equal(big?.fixture, derby);
});

test('a big match storyline leads earlier, weighs more, and its fallout lasts longer', () => {
  const s: Storyline = {
    id: 1,
    kind: 'match',
    title: 'Hearts v Hibernian',
    fixture: '2026-10-31|Hearts|Hibernian',
    kickOff: '2026-10-31T15:00:00.000Z',
    status: 'open',
    openedAt: '2026-10-25T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    claims: [],
  };
  const at = (iso: string) => new Date(iso);
  // 60 hours before: early for an ordinary game, already leading for a big one.
  assert.equal(liveness(s, s.updatedAt, undefined, [], at('2026-10-29T03:00:00Z')), 0.4);
  assert.equal(liveness(s, s.updatedAt, undefined, [], at('2026-10-29T03:00:00Z'), true), 2.2);
  // 30 hours after: an ordinary game is quiet without news; a big one still leads.
  assert.equal(liveness(s, s.updatedAt, undefined, [], at('2026-11-01T21:00:00Z')), 0.08);
  assert.equal(liveness(s, s.updatedAt, undefined, [], at('2026-11-01T21:00:00Z'), true), 2.2);
  // Fallout from a claim a day old halves for an ordinary game, but only drops a quarter for a big one.
  const fallout = at('2026-11-02T12:00:00Z');
  assert.equal(liveness(s, s.updatedAt, '2026-11-01T12:00:00.000Z', [], fallout), 0.5);
  assert.ok(Math.abs(liveness(s, s.updatedAt, '2026-11-01T12:00:00.000Z', [], fallout, true) - 0.5 ** 0.5) < 1e-9);
});

test("stories naming a big game's opponent, by any of its names, get a bigger boost", () => {
  const story = (title: string): Story => ({ id: title, title, summary: '', category: 'match', sources: [], latest: '', score: 1, items: [], people: [] });
  const stories = [story('Hibs injury blow ahead of derby'), story('Hibernian boss on Tynecastle'), story('Motherwell win again')];
  boostStories(stories, { opponent: ['Hibernian', 'Hibs'], big: true, fanThreads: [] });
  assert.deepEqual(stories.map((s) => s.score), [1.5, 1.5, 1]);
});
