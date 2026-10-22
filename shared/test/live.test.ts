// The live.json parser against a trimmed recording of Trabzonspor v Hearts (22 Oct 2026): 1-0 Salah pen 32',
// 2-0 Franculino 58', Sidny Cabral sent off (second yellow) 90'+5. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData, BbcEvent } from '../bbc.ts';
import { type LiveMatch, liveMatch, todaysEvent } from '../live.ts';

const TEAM = 'heart-of-midlothian';
const rec = JSON.parse(readFileSync(new URL('fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as {
  teamEvent: BbcEvent;
  snapshots: { at: string; page: BbcData }[];
};

/** live.json as it was at a UTC time ("17:18:41"), from the latest snapshot at or before it. */
function at(time: string): LiveMatch {
  const snap = rec.snapshots.filter((s) => s.at <= `2026-10-22T${time}Z`).pop();
  assert.ok(snap, `no snapshot by ${time}`);
  return liveMatch(rec.teamEvent, TEAM, snap.page);
}

const score = (m: LiveMatch) => `${m.home.score}-${m.away.score}`;

test('finds the match on its UK date only', () => {
  assert.equal(todaysEvent([rec.teamEvent], TEAM, new Date('2026-10-22T08:00:00Z')), rec.teamEvent);
  assert.equal(todaysEvent([rec.teamEvent], TEAM, new Date('2026-10-22T23:30:00Z')), undefined); // 00:30 on the 23rd in the UK
  assert.equal(todaysEvent([rec.teamEvent], 'celtic', new Date('2026-10-22T12:00:00Z')), undefined);
});

test('before kick-off', () => {
  const m = at('16:30:00');
  assert.equal(m.status, 'pre');
  assert.equal(m.home.score, undefined);
  assert.equal(m.us, 'away');
  assert.equal(m.kickOff, '2026-10-22T16:45:00.000Z');
  assert.equal(m.competition, 'UEFA Conference League');
  assert.equal(m.venue, 'Papara Park');
  assert.deepEqual(m.events, []);
});

test('kick-off', () => {
  const m = at('16:47:04');
  assert.equal(m.status, 'live');
  assert.equal(m.clock, "1'");
  assert.equal(score(m), '0-0');
  assert.equal(m.posts[0].code, 'KICK_OFF');
});

test('first goal: score straight away, post text a little later', () => {
  let m = at('17:18:41');
  assert.equal(score(m), '1-0');
  assert.deepEqual(
    m.events.map(({ kind, side, player, minute, detail }) => ({ kind, side, player, minute, detail })),
    [{ kind: 'goal', side: 'home', player: 'Mohamed Salah', minute: "32'", detail: 'Penalty' }],
  );
  assert.equal(m.events[0].post?.header, 'Mo Salah (pen)');
  assert.deepEqual(m.events[0].post?.text, []); // posted with an empty body
  assert.equal(m.events[0].post?.at, '2026-10-22T17:17:44.000Z');

  m = at('17:20:11');
  assert.match(m.events[0].post!.text[0], /Cool as you like/);
  assert.equal(m.events[0].post!.minute, "32'");
});

test('half-time', () => {
  const m = at('17:37:15');
  assert.equal(m.status, 'ht');
  assert.equal(m.clock, undefined);
  assert.equal(m.posts[0].code, 'HALF_TIME');
});

test('a pending goal is flagged and not in the score', () => {
  const m = at('18:05:52');
  assert.equal(score(m), '1-0');
  const pending = m.events.find((e) => e.unconfirmed);
  assert.equal(pending?.player, 'Franculino Djú');
});

test('second goal is matched to its own post', () => {
  const m = at('18:10:23');
  assert.equal(score(m), '2-0');
  // The first goal's post has dropped out of BBC's latest 20 by now: it mustn't be given the second goal's.
  assert.deepEqual(
    m.events.map((e) => [e.player, e.post?.header]),
    [
      ['Mohamed Salah', undefined],
      ['Franculino Djú', 'Franculino Dju'],
    ],
  );
});

test('red card (second yellow), with its post once it arrives', () => {
  let red = at('18:42:00').events.find((e) => e.kind === 'red');
  assert.deepEqual({ ...red }, { kind: 'red', side: 'home', player: 'Sidny Cabral', minute: "90'+5", detail: 'Two Yellow Cards' });

  red = at('18:44:01').events.find((e) => e.kind === 'red');
  assert.equal(red?.post?.headline, 'RED CARD - Lopes Cabral (Trabzonspor)');
  assert.match(red!.post!.text[0], /second yellow/);
});

test('full time, and posts about other games are left out', () => {
  const m = at('23:59:59');
  assert.equal(m.status, 'ft');
  assert.equal(score(m), '2-0');
  assert.deepEqual(
    m.events.map((e) => `${e.kind} ${e.player} ${e.minute}`),
    ["goal Mohamed Salah 32'", "goal Franculino Djú 58'", "red Sidny Cabral 90'+5"],
  );
  for (const s of rec.snapshots) {
    for (const p of liveMatch(rec.teamEvent, TEAM, s.page).posts) assert.doesNotMatch(`${p.headline} ${p.header}`, /Celtic/);
  }
});

test('without the match page, falls back to the team page', () => {
  const m = liveMatch(rec.teamEvent, TEAM);
  assert.equal(m.status, 'pre');
  assert.deepEqual(m.posts, []);
});
