// The breakfast papers round-up (#111): only 06:00-10:00 UK, only Hearts headlines, each paper credited by name, skipped
// cleanly when empty. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bulletin } from '../../shared/bulletin.ts';
import type { Paper, PaperHeadline } from '../src/papers.ts';
import { runningOrder, type Facts } from '../src/script/facts.ts';
import { inPapersWindow, papersDraft, papersPicks, papersSegment } from '../src/script/papers.ts';
import { quietSlot } from '../src/script/quiet.ts';

const h = (id: string, outlet: Paper, title: string, hearts = true): PaperHeadline => ({ id, outlet, title, url: '', publishedAt: '2026-11-06T06:00:00.000Z', hearts });
const roundup = (...xs: PaperHeadline[]) => {
  const out = { 'daily-record': [], herald: [], scotsman: [], 'evening-news': [] } as Record<Paper, PaperHeadline[]>;
  for (const x of xs) out[x.outlet].push(x);
  return out;
};
const morning = new Date('2026-11-06T08:00:00Z'); // 08:00 UK
const club = { shortName: 'Hearts' };
const cast = { anchors: ['isla', 'fraser'], analyst: 'ross', transfers: 'ross' };

test('the window is 06:00 to 10:00 UK time, in summer and winter', () => {
  assert.equal(inPapersWindow(new Date('2026-11-06T05:59:00Z')), false);
  assert.equal(inPapersWindow(new Date('2026-11-06T06:00:00Z')), true);
  assert.equal(inPapersWindow(new Date('2026-11-06T09:59:00Z')), true);
  assert.equal(inPapersWindow(new Date('2026-11-06T10:00:00Z')), false);
  assert.equal(inPapersWindow(new Date('2026-07-06T05:30:00Z')), true); // 06:30 BST is in
  assert.equal(inPapersWindow(new Date('2026-07-06T04:30:00Z')), false); // 05:30 BST is out
});

test('picks: Hearts-only, never outside the window, at most two a paper and four in all, repeats once', () => {
  const r = roundup(
    h('1', 'daily-record', 'Hearts boss on injury boost'),
    h('2', 'daily-record', 'Rangers eye striker', false),
    h('3', 'daily-record', 'Hearts: striker wanted'),
    h('4', 'daily-record', 'Hearts third story'),
    h('5', 'herald', 'Tynecastle plans'),
    h('6', 'scotsman', 'hearts boss on injury boost'),
    h('7', 'evening-news', 'Jambos latest'),
  );
  const picks = papersPicks(r, morning);
  assert.deepEqual(picks.map((x) => x.id), ['1', '5', '7', '3']);
  assert.ok(!picks.some((x) => !x.hearts));
  assert.deepEqual(papersPicks(r, new Date('2026-11-06T13:00:00Z')), []);
  assert.deepEqual(papersPicks(undefined, morning), []);
});

test('draft: each outlet credited by name with its headline only; nothing when there are no items', () => {
  const picks = papersPicks(roundup(h('1', 'daily-record', 'Hearts boss on injury boost.'), h('2', 'scotsman', 'Tynecastle plans')), morning);
  const d = papersDraft({ club, papers: picks } as unknown as Facts);
  assert.ok(d);
  assert.match(d.items[0].text, /^The Daily Record says: Hearts boss on injury boost\. /);
  assert.match(d.items[1].text, /^The Scotsman says: Tynecastle plans\. /);
  assert.equal(papersDraft({ club } as unknown as Facts), undefined);
  assert.equal(papersDraft({ club, papers: [] } as unknown as Facts), undefined);
});

test('segment: Fraser at the desk, a headline card per item; running order places it after the headlines', () => {
  const picks = papersPicks(roundup(h('1', 'herald', 'Hearts latest')), morning);
  const f = { club, papers: picks, channel: { cast, presenters: [] } } as unknown as Facts;
  const seg = papersSegment(f, papersDraft(f)!);
  assert.ok(seg);
  assert.equal(seg.kind, 'papers');
  assert.deepEqual(seg.presenters, ['fraser']);
  assert.equal(seg.lines.length, 2);
  assert.deepEqual(seg.lines[1].graphic, { type: 'frontpage', outlet: 'herald', paper: 'Herald', headline: 'Hearts latest' });
  const ids = (papers: boolean) => runningOrder(f, { features: [], debate: false, match: false, papers }).map((s) => s.id);
  assert.deepEqual(ids(true), ['headlines', 'papers', 'transfers', 'fans']);
  assert.deepEqual(ids(false), ['headlines', 'transfers', 'fans']);
  // Ross's casting is untouched: he is never the papers presenter.
  assert.ok(!seg.presenters.includes('ross'));
});

test('quiet slot: the papers coming in or going out forces a full build', () => {
  const base = { pool: [{ id: 'a', title: 'A', storyline: { isNew: false } }], features: [], transfers: [], phase: { kind: 'normal' }, now: morning } as unknown as Facts;
  const desk = { features: [], top: ['a'], lead: 'a', transfers: [], aired: ['a'], phase: 'normal', day: '2026-11-06', kind: 'full' as const };
  const prev = (withPapers: boolean) =>
    ({ version: 1, generatedAt: '', generatedBy: '', segments: withPapers ? [{ id: 'papers', kind: 'papers' }] : [], desk }) as unknown as Bulletin;
  const withP = { ...base, papers: [h('1', 'herald', 'Hearts latest')] } as Facts;
  assert.equal(quietSlot(prev(false), withP).partial, false);
  assert.equal(quietSlot(prev(true), base).partial, false);
  assert.equal(quietSlot(prev(true), withP).partial, true);
});
