// Breaking news against the recording of Trabzonspor v Hearts (22 Oct 2026): 1-0 Salah pen 32', 2-0 Franculino 58',
// Sidny Cabral sent off (second yellow) 90'+5; kick-off 16:47, half-time 17:37, second half 17:52, full time 18:43.
// Run with `npm test`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { BbcData, BbcEvent } from '../../shared/bbc.ts';
import type { Graphic } from '../../shared/bulletin.ts';
import { type LiveMatch, liveMatch } from '../../shared/live.ts';
import { DESCRIPTION_WAIT_MS, EventTracker, periodsReached, type ReadyEvent, type ReadyPeriod } from '../src/breaking/detect.ts';
import {
  anchorLine, buildPackage, buildPeriodPackage, checkLine, checkPeriodLine, gameReading, periodLine, plainLine, SIGN_OFF, spokenMinute, wordNumbers,
} from '../src/breaking/script.ts';
import { Cadence, stillWanted } from '../src/cadence.ts';
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

/**
 * Reads the recording every 20s from `from` (UTC) to the end; returns what was ready when. The tracker's state goes
 * through JSON between reads, as it does between runs of the Worker's clock.
 */
function replay(from = '16:30:00'): { at: string; ready: ReadyEvent }[] {
  let state = new EventTracker().state;
  const out: { at: string; ready: ReadyEvent }[] = [];
  const end = Date.parse(rec.snapshots[rec.snapshots.length - 1].at) + 5 * 60_000;
  for (let t = Date.parse(`2026-10-22T${from}Z`); t <= end; t += 20_000) {
    const tracker = new EventTracker(JSON.parse(JSON.stringify(state)));
    for (const ready of tracker.update(matchAt(t), t)) out.push({ at: new Date(t).toISOString().slice(11, 19), ready });
    state = tracker.state;
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

test("our read on the game, from the stats as they were at each break-in", () => {
  const got = replay();
  const [salah, dju, red] = got.map((g) => gameReading(g.ready.match, g.ready.event)?.text);
  // 32': 59% for Trabzonspor but six shots to three for Hearts. Mixed, so nobody is said to be on top.
  assert.equal(salah, "It's been a cagey one, with just two shots on target between them.");
  assert.equal(dju, 'Trabzonspor have been knocking on the door, with 61 per cent of the ball and four shots on target to one.');
  assert.equal(red, 'Trabzonspor have been on top, with 61 per cent of the ball and five shots on target to one.');
  const r = got[1].ready;
  assert.equal(
    plainLine(r.match, r.event, gameReading(r.match, r.event)),
    `It's a goal for Trabzonspor: Franculino Djú, on 58 minutes, and it's Trabzonspor 2, Hearts 0. ${dju} ${SIGN_OFF}`,
  );
});

test('half-time and full-time lines from the stats', () => {
  assert.equal(
    periodLine(matchAt(Date.parse('2026-10-22T17:37:15Z')), 'ht').text,
    `It's half-time here, and it's Trabzonspor 1, Hearts 0. Trabzonspor have had 57 per cent of the ball. On shots it's Trabzonspor six, Hearts eight, and three to one on target. ${SIGN_OFF}`,
  );
  const ft = periodLine(matchAt(Date.parse('2026-10-22T18:52:03Z')), 'ft');
  assert.match(ft.text, /^It's full time here, and it's Trabzonspor 2, Hearts 0\. On shots .* Trabzonspor have been on top, with 61 per cent/);
  assert.ok(ft.numbers.includes(61) && ft.numbers.includes(11));
  // Before BBC has stats, just the score.
  assert.equal(periodLine({ ...matchAt(Date.parse('2026-10-22T17:37:15Z')), stats: undefined }, 'ht').text, `It's half-time here, and it's Trabzonspor 1, Hearts 0. ${SIGN_OFF}`);
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
  // Stats only when they were given.
  const knocking = "Franculino Dju scores, and Trabzonspor have had 61% of the ball and four shots on target to one. It's Trabzonspor 2, Hearts 0.";
  assert.equal(checkLine(knocking, m, dju), undefined);
  assert.ok(checkLine(knocking, m, dju, [61, 4, 1]));
  assert.equal(checkLine(knocking.replace('61%', '65%'), m, dju, [61, 4, 1]), undefined);
});

/** Polls the recording every 20s like `replay`, for the kick-off, half-time and full-time break-ins. */
function replayPeriods(from = '16:30:00'): { at: string; ready: ReadyPeriod }[] {
  const tracker = new EventTracker();
  const out: { at: string; ready: ReadyPeriod }[] = [];
  const end = Date.parse(rec.snapshots[rec.snapshots.length - 1].at) + 5 * 60_000;
  for (let t = Date.parse(`2026-10-22T${from}Z`); t <= end; t += 20_000) {
    const m = matchAt(t);
    tracker.update(m, t);
    const ready = tracker.period(m, t);
    if (ready) out.push({ at: new Date(t).toISOString().slice(11, 19), ready });
  }
  return out;
}

test('kick-offs, half-time and full time are each ready once, with BBC posts when there are some', () => {
  const got = replayPeriods();
  assert.deepEqual(
    got.map((g) => [g.ready.period, g.at, g.ready.text.length]),
    [
      // Live at 16:47:04, with the pre-match team news post and "And we're off."
      ['ko1', '16:47:20', 4],
      // Half-time at 17:37:15 with an empty post; its two paragraphs come at 17:38:15.
      ['ht', '17:38:20', 2],
      // "We go again." on its own, first read at 17:53:00: it stands for 45s.
      ['ko2', '17:54:00', 1],
      // No full-time post in the recording: two minutes, then plain.
      ['ft', '18:45:40', 0],
    ],
  );
  assert.match(got[0].ready.text.join(' '), /Rogers Mato/);
  // Starting in the second half, only full time is still to come.
  assert.deepEqual(replayPeriods('18:00:00').map((g) => g.ready.period), ['ft']);
});

test('a period still waiting when the next comes round is dropped', () => {
  const tracker = new EventTracker();
  const t0 = Date.parse('2026-10-22T16:30:00Z');
  tracker.period(matchAt(t0), t0);
  const ht = { ...matchAt(Date.parse('2026-10-22T17:37:15Z')), posts: [] };
  assert.equal(tracker.period(ht, t0 + 1000), undefined); // ko1 is old news by now, and half-time waits for BBC
  assert.equal(periodsReached(ht).join(), 'ko1,ht');
  const ft = matchAt(Date.parse('2026-10-22T18:52:03Z'));
  assert.equal(tracker.period(ft, t0 + 2000), undefined);
  assert.equal(tracker.period(ft, t0 + 2000 + DESCRIPTION_WAIT_MS)?.period, 'ft');
  assert.ok(tracker.state.done.includes('period:ht') && tracker.state.done.includes('period:ko2'));
});

test('kick-off, half-time and full-time packages', async () => {
  const [ko1, ht, ko2, ft] = replayPeriods().map((g) => g.ready);
  const pkg = (r: ReadyPeriod, model?: ScriptModel) => buildPeriodPackage({ ...r, channel, model, now: new Date('2026-10-22T17:00:00Z') });

  const kick = await pkg(ko1);
  assert.equal(kick.flash, 'KICK-OFF');
  assert.deepEqual(kick.segments.map((s) => [s.scene, s.lines[0].text]), [
    ['desk', "We're under way in Trabzonspor against Hearts. Let's go to Gregor Moffat at Papara Park."],
    ['pitchside', `We're under way here at Papara Park: Trabzonspor against Hearts in the UEFA Conference League. ${SIGN_OFF}`],
  ]);
  assert.deepEqual(kick.segments[1].lines[0].graphic, {
    type: 'result', home: 'Trabzonspor', away: 'Hearts', homeScore: 0, awayScore: 0, competition: 'UEFA Conference League',
    status: 'KICK-OFF', homeScorers: [], awayScorers: [],
  });

  const second = await pkg(ko2);
  assert.equal(second.segments[1].lines[0].text, `The second half is under way here, and it's Trabzonspor 1, Hearts 0. ${SIGN_OFF}`);
  assert.deepEqual((second.segments[1].lines[0].graphic as { homeScorers: string[] }).homeScorers, ["Salah 32' pen"]);

  // The breaks: periodLine and the stats card.
  const half = await pkg(ht);
  assert.equal(half.flash, 'HALF TIME');
  assert.equal(half.segments[0].lines[0].text, "It's half-time in Trabzonspor against Hearts. Let's go to Gregor Moffat at Papara Park.");
  assert.equal(half.segments[1].lines[0].text, periodLine(ht.match, 'ht').text);
  const card = half.segments[1].lines[0].graphic as Extract<Graphic, { type: 'stats' }>;
  assert.equal(card.type, 'stats');
  assert.equal(card.status, 'HALF TIME');
  assert.deepEqual(card.rows[0], { label: 'POSSESSION', home: 57, away: 43, percent: true });
  const full = await pkg(ft);
  assert.equal(full.segments[0].strap, 'FULL TIME: Trabzonspor 2-0 Hearts');
  assert.match(full.segments[1].lines[0].text, /^It's full time here, and it's Trabzonspor 2, Hearts 0\./);
  assert.equal((full.segments[1].lines[0].graphic as { status: string }).status, 'FULL TIME');

  // AI lines from BBC's post: the stats it was given are allowed, invented numbers aren't.
  const said = (line: string): ScriptModel => ({ name: 'fake', generateJson: async () => ({ line }) });
  const good = "Hearts are still in this, but Salah's penalty is the difference, and it's Trabzonspor 1, Hearts 0. Trabzonspor have had 57 per cent of the ball.";
  assert.equal((await pkg(ht, said(good))).segments[1].lines[0].text, `${good} ${SIGN_OFF}`);
  assert.equal((await pkg(ht, said(good.replace('57', '67')))).segments[1].lines[0].text, periodLine(ht.match, 'ht').text);
  const ko = "We're off here, and Rogers Mato is at left-back for Hearts, up against Mo Salah.";
  assert.equal((await pkg(ko1, said(ko))).segments[1].lines[0].text, `${ko} ${SIGN_OFF}`);
  assert.equal(checkPeriodLine("Three changes for Hearts. It's nil-nil.", ko1.match), undefined);
});

test('programmes: on :00 and :30, none while the match is on, straight after half-time and full time', () => {
  const every = 30 * 60_000;
  const at = (hm: string) => Date.parse(`2026-10-22T${hm}:00Z`);
  // As the Worker's clock runs it: once a minute, the state carried over in JSON between runs.
  let state = { slot: at('16:00') };
  const feedAt = (t: number) => ({ updated: new Date(t).toISOString(), match: matchAt(t) });
  const due: [string, string][] = [];
  for (let t = at('16:30'); t <= at('19:30'); t += 60_000) {
    const cadence = new Cadence(every, JSON.parse(JSON.stringify(state)));
    cadence.see(feedAt(t), t);
    const why = cadence.due(t);
    if (why) due.push([new Date(t).toISOString().slice(11, 16), why]);
    state = cadence.state as typeof state;
  }
  assert.deepEqual(due, [
    ['16:30', 'regular'],
    // The 17:00 programme is held: kick-off was at 16:47.
    ['17:38', 'ht'],
    ['18:44', 'ft'],
    // The full-time programme took the 18:30 slot.
    ['19:00', 'regular'],
    ['19:30', 'regular'],
  ]);
  // A half-time programme that isn't ready until the second half is under way is dropped.
  assert.ok(stillWanted('ht', feedAt(at('17:45'))));
  assert.ok(!stillWanted('ht', feedAt(at('17:55'))));
  assert.ok(stillWanted('ft', feedAt(at('17:55'))));
  assert.ok(stillWanted('ht', undefined));
  // With no word from BBC for a while, programmes carry on as normal.
  const quiet = new Cadence(every, {});
  quiet.see(feedAt(at('17:10')), at('17:10'));
  assert.equal(quiet.due(at('17:15')), undefined);
  assert.equal(quiet.due(at('17:25')), 'regular');
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
  assert.equal(plain.segments[1].lines[0].text, plainLine(m, salah, gameReading(m, salah)));
});
