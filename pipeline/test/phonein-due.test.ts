// Issue #9: which phone-in is due when. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueNow } from '../src/phonein-run.ts';
import type { Fixture } from '../src/types.ts';

// Hearts v Rangers, 28 Oct 2026, 19:45 (GMT): full time about 21:40.
const game: Fixture = { date: '2026-10-28T19:45:00.000Z', home: 'Hearts', away: 'Rangers', competition: 'Premiership', homeScore: 2, awayScore: 2, status: 'done' };
const at = (s: string) => new Date(s);

test('nothing is due until two hours after full time', () => {
  assert.equal(dueNow(game, at('2026-10-28T21:30:00Z'), new Set()), undefined);
  assert.equal(dueNow(game, at('2026-10-28T23:30:00Z'), new Set()), undefined);
});

test('the evening one is due from two hours after full time, once', () => {
  const due = dueNow(game, at('2026-10-28T23:45:00Z'), new Set());
  assert.equal(due?.kind, 'evening');
  assert.equal(due?.from.toISOString(), '2026-10-28T21:40:00.000Z');
  assert.equal(dueNow(game, at('2026-10-28T23:45:00Z'), new Set([due!.key])), undefined);
});

test('the evening one gives up after eight hours', () => {
  assert.equal(dueNow(game, at('2026-10-29T06:00:00Z'), new Set()), undefined);
});

test('the morning one is due next morning between seven and noon, weighted on later posts', () => {
  assert.equal(dueNow(game, at('2026-10-29T06:30:00Z'), new Set()), undefined);
  const due = dueNow(game, at('2026-10-29T07:00:00Z'), new Set([`phonein:${game.date}:evening`]));
  assert.equal(due?.kind, 'morning');
  assert.equal(due?.from.toISOString(), '2026-10-28T23:40:00.000Z');
  assert.equal(dueNow(game, at('2026-10-29T12:00:00Z'), new Set()), undefined);
  assert.equal(dueNow(game, at('2026-10-30T08:00:00Z'), new Set()), undefined);
});

test('a game with no score yet has none', () => {
  assert.equal(dueNow({ ...game, homeScore: undefined }, at('2026-10-28T23:45:00Z'), new Set()), undefined);
});
