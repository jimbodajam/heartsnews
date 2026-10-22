// Breaking news against the recording of Trabzonspor v Hearts (22 Oct 2026): 1-0 Salah pen 32', 2-0 Franculino 58',
// Sidny Cabral sent off (second yellow) 90'+5. Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData, BbcEvent } from '../../shared/bbc.ts';
import { type LiveMatch, liveMatch } from '../../shared/live.ts';
import { DESCRIPTION_WAIT_MS, EventTracker, type ReadyEvent } from '../src/breaking/detect.ts';
import { anchorLine, buildPackage, checkLine, plainLine, SIGN_OFF, spokenMinute, wordNumbers } from '../src/breaking/script.ts';
import type { Channel } from '../src/script/facts.ts';
import type { ScriptModel } from '../src/script/llm.ts';

const rec = JSON.parse(readFileSync(new URL('../../shared/test/fixtures/2026-10-22-trabzonspor-hearts.json', import.meta.url), 'utf8')) as {
  teamEvent: BbcEvent;
  snapshots: { at: string; page: BbcData }[];
};
const channel = JSON.parse(readFileSync(new URL('../../channel.json', import.meta.url), 'utf8')) as Channel;
const matchAt = (t: number): LiveMatch => {
  const snap = rec.snapshots.filter((s) => Date.parse(s.at) <= t).pop()!;
  return liveMatch(rec.teamEvent, 'heart-of-midlothian', snap.page);
};

/** Polls the recording every 20s, as the home PC would, from `from` (UTC) to the end; returns what was ready when. */
function replay(from = '16:30:00'): { at: string; ready: ReadyEvent }[] {
  const tracker = new EventTracker();
  const out: { at: string; ready: ReadyEvent }[] = [];
  const end = Date.parse(rec.snapshots[rec.snapshots.length - 1].at) + 5 * 60_000;
  for (let t = Date.parse(`2026-10-22T${from}Z`); t <= end; t += 20_000) {
    for (const ready of tracker.update(matchAt(t), t)) out.push({ at: new Date(t).toISOString().slice(11, 19), ready });
  }
  return out;
}

test('each goal and red card is ready once, as soon as BBC describes it', () => {
  const got = replay();
  assert.deepEqual(
    got.map((g) => [g.ready.event.player, g.at]),
    [
      // Two paragraphs straight away.
      ['Mohamed Salah', '17:19:20'],
      // "Goodness me, what a goal that is." on its own at 18:06:22; the description joins it at 18:07:22.
      ['Franculino Djú', '18:07:40'],
      // Seen at 18:42:00, described at 18:44:01: just past the two-minute wait, so whatever there is by then.
      ['Sidny Cabral', '18:44:00'],
    ],
  );
  assert.match(got[1].ready.text.join(' '), /nutmeg/);
  assert.equal(got[2].ready.text.length, 0); // the description came a second too late
});

test('starting mid-match, what has already happened is old news', () => {
  const got = replay('18:00:00');
  assert.deepEqual(got.map((g) => g.ready.event.player), ['Franculino Djú', 'Sidny Cabral']);
  const late = replay('18:30:00');
  assert.deepEqual(late.map((g) => g.ready.event.player), ['Sidny Cabral']);
});

test('an event with no description at all waits two minutes, then goes plain', () => {
  const tracker = new EventTracker();
  const t0 = Date.parse('2026-10-22T16:30:00Z');
  const pre = matchAt(t0);
  tracker.update(pre, t0);
  const m: LiveMatch = { ...pre, status: 'live', events: [{ kind: 'goal', side: 'away', player: 'Claudio Braga', minute: "71'" }] };
  assert.equal(tracker.update(m, t0 + 1000).length, 0);
  assert.equal(tracker.update(m, t0 + DESCRIPTION_WAIT_MS).length, 0);
  assert.equal(tracker.update(m, t0 + 1000 + DESCRIPTION_WAIT_MS).length, 1);
  assert.equal(tracker.update(m, t0 + 2 * DESCRIPTION_WAIT_MS).length, 0);
});

test('plain lines: who, when and the score, neutral', () => {
  const m = matchAt(Date.parse('2026-10-22T18:44:01Z'));
  const [salah, dju, red] = m.events;
  assert.equal(plainLine(m, salah), `It's a goal for Trabzonspor: Mohamed Salah from the penalty spot, on 32 minutes, and it's Trabzonspor 1, Hearts 0. ${SIGN_OFF}`);
  assert.match(plainLine(m, dju), /Trabzonspor 2, Hearts 0/);
  assert.equal(
    plainLine(m, red),
    `Trabzonspor are down to ten men: Sidny Cabral is sent off for a second yellow card in the fifth minute of added time. It's Trabzonspor 2, Hearts 0. ${SIGN_OFF}`,
  );
  assert.equal(anchorLine(m, salah, channel.presenters.find((p) => p.id === 'gregor')!), "We're getting news of a goal in Trabzonspor against Hearts. Let's go straight to Gregor Moffat at Papara Park.");
  assert.equal(spokenMinute("45'+2"), 'in the second minute of added time');
});

test('AI lines must name the player and use no numbers but the score and minute', () => {
  const m = matchAt(Date.parse('2026-10-22T18:44:01Z'));
  const dju = m.events[1];
  assert.equal(
    checkLine("What a goal from Franculino Dju, nutmeg and all, and it's Trabzonspor 2, Hearts 0", m, dju),
    `What a goal from Franculino Dju, nutmeg and all, and it's Trabzonspor 2, Hearts 0. ${SIGN_OFF}`,
  );
  assert.equal(checkLine(`Salah again! Trabzonspor 2, Hearts 0. ${SIGN_OFF}`, m, dju), undefined); // wrong player
  assert.equal(checkLine(`Franculino from 25 yards! Trabzonspor 2, Hearts 0. ${SIGN_OFF}`, m, dju), undefined); // invented detail
  assert.equal(checkLine(42, m, dju), undefined);
  // In words as well.
  assert.ok(checkLine("Franculino Dju on fifty-eight minutes, one of the goals of the night. It's two-nil.", m, dju));
  assert.equal(checkLine("Franculino Dju from twenty yards! It's two-nil.", m, dju), undefined);
  assert.deepEqual(wordNumbers('thirty-two minutes, one-nil, ninety, hundred'), [32, 1, 0, 90, 100]);
});

test('a package: anchor at the desk, reporter at the ground with the score card', async () => {
  const m = matchAt(Date.parse('2026-10-22T18:44:01Z'));
  const salah = m.events[0];
  const model: ScriptModel = { name: 'fake', generateJson: async () => ({ line: "Cool as you like from Mohamed Salah, down the middle. It's Trabzonspor 1, Hearts 0." }) };
  const pkg = await buildPackage({ key: 'goal:home:Mohamed Salah:1', match: m, event: salah, text: ['Cool as you like.'], channel, model, now: new Date('2026-10-22T17:20:00Z') });
  assert.equal(pkg.flash, 'GOAL');
  assert.deepEqual(pkg.segments.map((s) => [s.scene, s.presenters[0]]), [['desk', 'isla'], ['pitchside', 'gregor']]);
  const line = pkg.segments[1].lines[0];
  assert.equal(line.text, `Cool as you like from Mohamed Salah, down the middle. It's Trabzonspor 1, Hearts 0. ${SIGN_OFF}`);
  // The card has the score as it was after this goal, not the final score.
  assert.deepEqual(line.graphic, {
    type: 'result', home: 'Trabzonspor', away: 'Hearts', homeScore: 1, awayScore: 0, competition: 'UEFA Conference League',
    status: "LIVE 32'", homeScorers: ["Salah 32' pen"], awayScorers: [],
  });
  // A model that fails leaves the plain line.
  const broken: ScriptModel = { name: 'broken', generateJson: async () => { throw new Error('busy'); } };
  const plain = await buildPackage({ key: 'k', match: m, event: salah, text: ['x'], channel, model: broken });
  assert.equal(plain.segments[1].lines[0].text, plainLine(m, salah));
});
