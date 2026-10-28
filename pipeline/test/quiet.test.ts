// Quiet slots (issue #50): when nothing on the desk has changed, only the links are rewritten. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bulletin } from '../../shared/bulletin.ts';
import { quietSlot, swapLinks } from '../src/script/quiet.ts';
import type { Facts } from '../src/script/facts.ts';
import type { Phase } from '../src/matchday.ts';

const story = (id: string, isNew = false) => ({ id, title: `Story ${id}`, storyline: { isNew } });
const fixture = { date: '2026-10-31T15:00:00.000Z', home: 'Hearts', away: 'Celtic', competition: 'Scottish Premiership' };

function desk(over: { pool?: ReturnType<typeof story>[]; features?: ReturnType<typeof story>[]; transfers?: ReturnType<typeof story>[]; phase?: Phase; now?: string } = {}): Facts {
  return {
    pool: over.pool ?? ['a', 'b', 'c', 'd', 'e'].map((id) => story(id)),
    features: over.features ?? [story('a'), story('b')],
    transfers: over.transfers ?? [story('t1')],
    phase: over.phase ?? { kind: 'normal' },
    now: new Date(over.now ?? '2026-10-27T10:00:00Z'),
  } as unknown as Facts;
}

/** The last programme, as built from `desk()`. */
function last(f: Facts, over: Partial<Bulletin> = {}): Bulletin {
  return {
    version: 1,
    generatedAt: '2026-10-27T09:30:00Z',
    generatedBy: 'Gemini (gemini-flash-latest)',
    segments: [],
    desk: {
      features: f.features.map((s) => s.id),
      top: f.pool.slice(0, 4).map((s) => s.id),
      lead: f.pool[0].id,
      transfers: f.transfers.map((s) => s.id),
      aired: ['a', 'b', 'c', 't1'],
      phase: 'normal',
      day: '2026-10-27',
      kind: 'full',
    },
    ...over,
  } as Bulletin;
}

const isFull = (d: ReturnType<typeof quietSlot>, reason: RegExp) => {
  assert.equal(d.partial, false);
  assert.match((d as { reason: string }).reason, reason);
};

test('an unchanged desk gets a partial rewrite', () => {
  const f = desk();
  assert.equal(quietSlot(last(f), f).partial, true);
});

test('a new claim on a top story, a package or a transfer forces a full build', () => {
  const prev = last(desk());
  isFull(quietSlot(prev, desk({ pool: [story('a'), story('b', true), story('c'), story('d'), story('e')] })), /new claim/);
  isFull(quietSlot(prev, desk({ features: [story('a', true), story('b')] })), /new claim/);
  isFull(quietSlot(prev, desk({ transfers: [story('t1', true)] })), /new claim/);
});

test('a story turning new outside the running order does not', () => {
  const f = desk({ pool: [...['a', 'b', 'c', 'd'].map((id) => story(id)), story('e', true), story('f', true)] });
  assert.equal(quietSlot(last(desk()), f).partial, true);
});

test('a changed running order forces a full build', () => {
  const prev = last(desk());
  assert.equal(quietSlot(prev, desk({ features: [story('c'), story('b')] })).partial, true, 'a different package pick is not news');
  isFull(quietSlot(prev, desk({ pool: ['b', 'a', 'c', 'd', 'e'].map((id) => story(id)) })), /lead/);
  isFull(quietSlot(prev, desk({ pool: ['a', 'b', 'c', 'e', 'd'].map((id) => story(id)) })), /top stories/);
  isFull(quietSlot(prev, desk({ transfers: [story('t1'), story('t2')] })), /transfer/);
});

test('a story the last programme aired dropping out of the pool forces a full build', () => {
  const prev = last(desk());
  prev.desk!.aired.push('gone');
  isFull(quietSlot(prev, desk()), /dropped out/);
});

test('a phase change, a new result, a live match or a new UK day forces a full build', () => {
  const normal = desk();
  const prev = last(normal);
  isFull(quietSlot(prev, desk({ phase: { kind: 'preview', fixture } })), /phase/);
  isFull(quietSlot(prev, desk({ phase: { kind: 'live', fixture } })), /live/);
  isFull(quietSlot(prev, desk({ now: '2026-10-28T00:30:00Z' })), /new UK day/);

  const result = { ...fixture, homeScore: 2, awayScore: 0 };
  const reaction = desk({ phase: { kind: 'reaction', result } });
  const afterGame = last(reaction);
  afterGame.desk!.phase = `reaction ${fixture.date} Hearts v Celtic 2-0`;
  assert.equal(quietSlot(afterGame, reaction).partial, true, 'the same result is quiet');
  isFull(quietSlot(afterGame, desk({ phase: { kind: 'reaction', result: { ...result, homeScore: 3 } } })), /phase/);
});

test('no last programme, no running order recorded or a forcing flag all give a full build', () => {
  const f = desk();
  isFull(quietSlot(undefined, f), /no last programme/);
  isFull(quietSlot(last(f, { desk: undefined }), f), /running order/);
  isFull(quietSlot(last(f), f, { forced: '--full' }), /--full/);
});

test('swapping links keeps every other line and its clip exactly as it was', () => {
  const prev = {
    ...last(desk()),
    segments: [
      {
        id: 'headlines',
        presenters: ['isla', 'fraser'],
        lines: [
          { speaker: 'isla', text: 'Good morning.', link: 'welcome', audio: 'audio/w.wav' },
          { speaker: 'fraser', text: 'Halkett is out.', audio: 'audio/h.wav', graphic: { type: 'headline', title: 'Halkett' } },
          { speaker: 'isla', text: 'Still to come: the debate.', link: 'comingUp', audio: 'audio/c.wav' },
          { speaker: 'isla', text: 'Over to the debate.', link: 'handover', audio: 'audio/o.wav' },
        ],
      },
      { id: 'debate', presenters: ['fraser', 'ross'], lines: [{ speaker: 'ross', text: 'Argue.', audio: 'audio/d.wav' }, { speaker: 'fraser', text: 'That is all.', link: 'outro', audio: 'audio/x.wav' }] },
    ],
  } as unknown as Bulletin;
  const before = structuredClone(prev);

  const { bulletin, changed } = swapLinks(prev, {
    welcome: 'Good afternoon.',
    comingUp: 'Later: the debate.',
    handovers: [{ to: 'debate', text: 'Time for the debate.', speaker: 'fraser' }, { to: 'nowhere', text: 'ignored' }],
    outro: undefined,
  });

  assert.deepEqual(prev, before, 'the last bulletin is not touched');
  const [head, debate] = bulletin.segments;
  assert.equal(head.lines[0].text, 'Good afternoon.');
  assert.equal(head.lines[0].audio, undefined, 'a reworded line loses its clip');
  assert.deepEqual(head.lines[1], before.segments[0].lines[1], 'news lines are identical, graphic and clip included');
  assert.equal(head.lines[3].text, 'Time for the debate.');
  assert.equal(head.lines[3].speaker, 'fraser', 'someone on screen can take the hand-over');
  assert.deepEqual(debate.lines[0], before.segments[1].lines[0]);
  assert.deepEqual(debate.lines[1], before.segments[1].lines[1], 'a link with no new wording is kept');
  assert.equal(changed.length, 3);
});

test('a programme written by templates (Gemini out of quota) is reused like any other', () => {
  const f = desk();
  assert.equal(quietSlot(last(f, { generatedBy: 'templates' }), f).partial, true);
});
