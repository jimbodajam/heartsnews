// A long article read once (issue #52): its quotes kept only when they're word for word, the summary kept with the item
// and read by the build, and the ingest's step held back when the day's Workers AI use is high. Through the real
// migrations on an in-memory SQLite. Run with `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store as endpoint } from '../../worker/src/store.ts';
import { normaliseQuote, parseArticleSummary, SUMMARISE_UNTIL, summariseArticles } from '../src/article-summary.ts';
import { renderArticleSummary } from '../src/summary-text.ts';
import { connectStore, ingestItems, loadArticlesToSummarise, loadOnAir, saveFetches } from '../src/store.ts';
import type { Item } from '../src/types.ts';
import { memoryD1 } from './d1.ts';

const NOW = new Date('2026-10-27T12:00:00Z');
const BODY = [
  'Hearts head coach Wouter Vrancken says Harry Milne faces around six weeks out with a hamstring injury.',
  '“We have to be careful with Harry, he’s been our most consistent player,” said Vrancken.',
  'Milne has started every league game this season. '.repeat(60),
].join('\n');

function setUp() {
  const d1 = memoryD1();
  const env = { DB: d1, STORE_TOKEN: 't' };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => endpoint(new Request(url, init), env)) as typeof fetch;
  return { d1, store: connectStore('t', 'https://store.test/store', fetchFn) };
}

const article = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  sourceId: 'daily-record',
  sourceName: 'Daily Record',
  kind: 'press',
  title: `Article ${id}`,
  summary: '',
  url: `https://example.com/${id}`,
  publishedAt: '2026-10-27T08:00:00.000Z',
  ...extra,
});

const REPLY = {
  news: ['Milne is out for about six weeks with a hamstring injury'],
  quotes: [
    { text: "We have to be careful with Harry, he's been our most consistent player", speaker: 'Wouter Vrancken, head coach' },
    { text: 'Harry will be back stronger than ever', speaker: 'Wouter Vrancken' },
  ],
  background: ['Milne has started every league game this season'],
};

test('a quote is kept only when it is in the article word for word, curly quotes and all', () => {
  const s = parseArticleSummary(REPLY, BODY);
  assert.deepEqual(s.quotes.map((q) => q.text), ["We have to be careful with Harry, he's been our most consistent player"]);
  assert.equal(normaliseQuote('“Don’t  panic…”'), "don't panic...");
  const text = renderArticleSummary(s);
  assert.match(text, /What it reports:\n- Milne is out/);
  assert.match(text, /Wouter Vrancken, head coach: "We have to be careful/);
  assert.match(text, /Background \(context, not news\)/);
  assert.deepEqual(parseArticleSummary({ news: 'oops', quotes: [{}] }, BODY), { news: [], quotes: [], background: [] });
});

test('the ingest summarises a long new article once, leaves short ones, and the build reads the summary', async () => {
  const s = setUp();
  await ingestItems(s.store, [article('long'), article('short'), article('old', { publishedAt: '2026-10-20T08:00:00.000Z' })], [], new Map(), NOW);
  await saveFetches(s.store, [{ id: 'long', text: BODY }, { id: 'short', text: 'A short news item. '.repeat(20) }, { id: 'old', text: BODY }], NOW);
  // Seen five days ago and behind no storyline: the backfill takes it, the ingest doesn't.
  s.d1.db.exec(`UPDATE items SET first_seen = '2026-10-22T08:00:00.000Z' WHERE id = 'old'`);
  assert.deepEqual((await loadArticlesToSummarise(s.store, NOW, 10)).map((a) => a.id), ['long', 'old']);
  assert.deepEqual((await loadArticlesToSummarise(s.store, NOW, 10, 2)).map((a) => a.id), ['long']);

  let asked = 0;
  const model = { async generateJson() { asked++; return REPLY; }, neurons: 0, name: 'test' };
  assert.equal(await summariseArticles({ store: s.store, model, used: SUMMARISE_UNTIL, now: NOW, log: () => {} }), 0, 'too much used today');
  assert.equal(asked, 0);
  assert.equal(await summariseArticles({ store: s.store, model, used: 1_000, now: NOW, log: () => {} }), 1);
  assert.equal(await summariseArticles({ store: s.store, model, used: 1_000, now: NOW, log: () => {} }), 0);
  assert.equal(asked, 1);

  // On air: the summary for the writer, and the whole text (past the old 4,000 characters) for checking quotes.
  s.d1.db.exec(`INSERT INTO storylines (id, kind, title, status, opened_at, updated_at) VALUES (1, 'person', 'Milne injury', 'open', '${NOW.toISOString()}', '${NOW.toISOString()}')`);
  s.d1.db.exec(`INSERT INTO claims (id, storyline_id, text, status, first_seen) VALUES (1, 1, 'Milne out six weeks', 'reported', '${NOW.toISOString()}')`);
  s.d1.db.exec(`INSERT INTO claim_sources (claim_id, item_id, corroboration, at) VALUES (1, 'long', 0, '${NOW.toISOString()}')`);
  const desk = await loadOnAir(s.store, [], NOW);
  const long = desk.items.get('long')!;
  assert.match(long.digest ?? '', /Milne is out for about six weeks/);
  assert.equal(long.text, BODY);
});
