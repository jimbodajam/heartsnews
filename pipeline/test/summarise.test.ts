// A long show read once (issue #49): split and merged, rendered for each reader, kept with the item, and never trusted
// more than a show deserves. Through the real migrations on an in-memory SQLite. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { mergePrompt, splitTranscript, summariseTranscript, summariseVideos, WHOLE_CHARS } from '../src/summarise.ts';
import { renderSummary, videoText } from '../src/summary-text.ts';
import { connectStore, ingestItems, loadStoryDesk, loadVideosToSummarise, loadVideoSummaries } from '../src/store.ts';
import { planSift, type Storyline } from '../src/storylines.ts';
import type { Item, VideoSummary } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const NOW = new Date('2026-10-27T12:00:00Z');
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

const SUMMARY: VideoSummary = {
  points: ['Milne injury update', 'Who starts against Rangers'],
  claims: [{ text: 'Milne is out for six weeks', speaker: 'guest', kind: 'injury' }],
  takes: [{ text: 'Shankland should start', speaker: 'host' }],
};

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 't' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('t', 'https://store.test/store', fetchFn) };
}

const show = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId: 'hearts-standard',
  sourceName: 'Hearts Standard (YouTube)',
  kind: 'video',
  title: `Show ${id}`,
  summary: '',
  url: `https://www.youtube.com/watch?v=${id}`,
  publishedAt: '2026-10-27T08:00:00.000Z',
  transcript: words(1_500),
  ...extra,
});

test('a short transcript goes in whole; a long one is split with a little overlap, at word boundaries', () => {
  assert.equal(splitTranscript(words(100)).length, 1);
  const text = words(9_000);
  assert.ok(text.length > WHOLE_CHARS * 2);
  const parts = splitTranscript(text);
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.length <= 18_000 && /^word\d+( |$)/.test(p) && /word\d+$/.test(p));
  // The end of one part starts the next, and the last word of the show is in the last part.
  const tail = parts[0].split(' ').slice(-3).join(' ');
  assert.ok(parts[1].includes(tail));
  assert.ok(parts.at(-1)!.endsWith('word8999'));
});

test('a long show is summarised in parts and merged; a failed merge joins the parts instead', async () => {
  const prompts: string[] = [];
  const reply = (n: number): VideoSummary => ({ points: [`point ${n}`], claims: [{ text: 'same claim' }], takes: [] });
  let call = 0;
  const model = {
    async generateJson(prompt: string) {
      prompts.push(prompt);
      return reply(++call);
    },
  };
  const parts = splitTranscript(words(9_000)).length;
  const out = await summariseTranscript(model, { title: 't', source: 's' }, words(9_000));
  assert.equal(prompts.length, parts + 1);
  assert.match(prompts.at(-1)!, /Merge them into one summary/);
  assert.ok(out.points.length > 0);

  let n = 0;
  const flaky = {
    async generateJson() {
      if (++n > parts) throw new Error('boom');
      return reply(n);
    },
  };
  const joined = await summariseTranscript(flaky, { title: 't', source: 's' }, words(9_000));
  assert.equal(joined.claims.length, 1);
  assert.deepEqual(joined.points.slice(0, 2), ['point 1', 'point 2']);
  assert.match(mergePrompt({ title: 't', source: 's' }, [reply(1)]), /part 1/);
});

test('each reader gets the part of the summary it should: no takes in the storylines, no news stated as fact in the Fan Zone', () => {
  const claims = renderSummary(SUMMARY, 'claims');
  assert.match(claims, /Milne is out for six weeks/);
  assert.doesNotMatch(claims, /Shankland/);
  const fan = renderSummary(SUMMARY, 'fan');
  assert.match(fan, /Shankland should start/);
  assert.match(fan, /talk, not reported fact/);
  assert.match(renderSummary(SUMMARY, 'full'), /Opinions and predictions/);
});

test('a video with no summary falls back to the start of its transcript', () => {
  assert.ok(videoText(undefined, words(2_000), 'fan', 2_500).length <= 2_500);
  assert.match(videoText(undefined, words(2_000), 'fan', 2_500), /^word0 word1/);
  assert.match(videoText(SUMMARY, 'a'.repeat(5_000), 'fan', 2_500), /Milne injury update/);
  assert.equal(videoText({ points: [], claims: [], takes: [] }, 'abc', 'fan', 10), 'abc');
});

test('the ingest summarises a waiting video once, keeps it past the transcript, and the reading uses it', async () => {
  const s = setUp();
  await ingestItems(s.store, [show('long'), show('clip', { transcript: words(200) })], [], new Map(), NOW);

  // Nothing summarised yet: the long show waits (for up to 12 hours), the short clip is ready as it is.
  let desk = await loadStoryDesk(s.store, NOW, { articles: 30, headlines: 10 });
  assert.deepEqual(desk.articles.map((a) => a.id), ['clip']);

  const waiting = await loadVideosToSummarise(s.store, NOW, 6);
  assert.deepEqual(waiting.map((v) => v.id), ['long']);

  let asked = 0;
  const model = {
    async generateJson() {
      asked++;
      return SUMMARY;
    },
    neurons: 12,
    name: 'test',
  };
  assert.equal(await summariseVideos({ store: s.store, model, now: NOW, log: () => {} }), 1);
  assert.equal(await summariseVideos({ store: s.store, model, now: NOW, log: () => {} }), 0);
  assert.equal(asked, 1);

  desk = await loadStoryDesk(s.store, NOW, { articles: 30, headlines: 10 });
  const long = desk.articles.find((a) => a.id === 'long');
  assert.ok(long?.text?.includes('Milne is out for six weeks'));
  assert.ok(!long?.text?.includes('Shankland'));

  assert.deepEqual((await loadVideoSummaries(s.store, ['long', 'clip'])).get('long'), SUMMARY);

  // Pruning the transcript leaves the summary.
  s.d1.db.exec(`UPDATE items SET transcript = NULL WHERE id = 'long'`);
  assert.deepEqual((await loadVideoSummaries(s.store, ['long'])).get('long'), SUMMARY);
});

test('a show whose summary never came is read from its transcript after 12 hours', async () => {
  const s = setUp();
  await ingestItems(s.store, [show('long')], [], new Map(), NOW);
  const later = new Date(NOW.getTime() + 13 * 3_600_000);
  const desk = await loadStoryDesk(s.store, later, { articles: 30, headlines: 10 });
  assert.deepEqual(desk.articles.map((a) => a.id), ['long']);
  assert.ok(desk.articles[0].text?.startsWith('word0'));
});

const articles = [{ id: 'v1', source: 'hearts-standard', kind: 'video' as const, title: 'Show', publishedAt: '2026-10-27T08:00:00.000Z', text: 'x' }];
const open: Storyline[] = [
  {
    id: 7,
    kind: 'club',
    title: 'Stadium',
    status: 'open',
    openedAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    claims: [{ id: 3, text: 'Stand to close', status: 'reported', firstSeen: '2026-10-20T00:00:00.000Z', sources: [] }],
  },
];

test('a claim backed only by shows never confirms another; backed by anyone else it does', () => {
  const reply = { storylines: [], claims: [{ text: 'Stand to close', storyline: 's7', sources: ['a1'], relation: 'confirms' as const, target: 'c3' }] };
  const args = [articles, open, [], [], { storyline: 1, claim: 10 }, NOW] as const;
  const fromShow = planSift(reply, ...args, new Set(['hearts-standard']));
  assert.deepEqual(fromShow.statuses, []);
  assert.deepEqual(fromShow.sources, [{ claimId: 3, itemId: 'v1' }]);
  assert.deepEqual(planSift(reply, ...args).statuses, [{ id: 3, status: 'confirmed' }]);
});

test('a new claim from a show starts as reported, credited to the show', () => {
  const reply = { storylines: [], claims: [{ text: 'Stand to reopen', storyline: 's7', sources: ['a1'], relation: 'new' as const }] };
  const plan = planSift(reply, articles, open, [], [], { storyline: 1, claim: 10 }, NOW, new Set(['hearts-standard']));
  assert.equal(plan.claims[0].status, 'reported');
  assert.deepEqual(plan.sources, [{ claimId: 10, itemId: 'v1' }]);
});
