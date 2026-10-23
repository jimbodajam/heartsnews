// Story engine stage 1b (issue #30): get every press and official article into the store once, in full, and tagged
// from its text. Collects the latest news, writes every item (aggregators and videos too, headline-tagged), then
// fetches each article the store has no text for, retrying a page that fails a few times before giving up on it.
// Separate from building a bulletin: GitHub runs it on the clock (.github/workflows/ingest.yml).
// Then reads the new articles into claims and storylines (storylines.ts, issue #25).
// Usage: npm run ingest. Needs STORE_TOKEN, and CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (with Workers AI) for
// the storylines (in .env or the GitHub secrets).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleText } from './collectors/article.ts';
import { collectAll, printReport } from './collectors/index.ts';
import { collectPlayers } from './collectors/sportsdb.ts';
import { attachTranscripts, loadTranscripts, TRANSCRIPT_CACHE } from './collectors/transcripts.ts';
import { seedEntities } from './entities.ts';
import { loadFaces } from './script/faces.ts';
import { ingestItems, neuronsToday, saveFetches, saveTextTags, storeFromEnv, untaggedArticles, type ArticleToFetch, type Fetched } from './store.ts';
import { updateStorylines } from './storylines.ts';
import { tagItems } from './tags.ts';
import type { ClubConfig } from './types.ts';
import { DEFAULT_BUDGET, workersAiFromEnv } from './workers-ai.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Less than this isn't an article: a cookie wall, a video page, a "subscribe to read". */
const MIN_TEXT = 300;
/** Pages fetched at once. */
const PARALLEL = 6;
/** Fetch results written to the store this many at a time, so a long first backfill keeps what it's got. */
const SAVE_EVERY = 25;
/** Articles re-tagged from their text per store read. */
const TAG_BATCH = 100;

async function fetchArticle(url: string, fetchText = fetchArticleText): Promise<Omit<Fetched, 'id'>> {
  try {
    const text = await fetchText(url, Infinity);
    return text.length >= MIN_TEXT ? { text } : { error: `only ${text.length} chars of text` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function main() {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const store = storeFromEnv();
  if (!store) throw new Error('No STORE_TOKEN set: nothing to ingest into.');
  const now = new Date();
  const club = JSON.parse(await readFile(resolve(ROOT, 'clubs/hearts.json'), 'utf8')) as ClubConfig;

  console.log(`Collecting for ${club.name}…`);
  const { items, match, report } = await collectAll(club, now, resolve(ROOT, 'snapshots'));
  printReport(report);
  const transcripts = await loadTranscripts(resolve(ROOT, 'snapshots/transcripts.json'), TRANSCRIPT_CACHE);
  console.log(`Video transcripts: ${attachTranscripts(items, transcripts)} attached`);

  const players = await collectPlayers(club).catch((err) => {
    console.warn(`Couldn't read the squad from SportsDB: ${(err as Error).message}`);
    return [];
  });
  const entities = seedEntities(club, match, [loadFaces(), players]);

  const queue = await ingestItems(store, items, entities, tagItems(items, entities), now);
  console.log(`\nStored ${items.length} items. ${queue.length} articles to fetch.`);

  // Fetch the lot, a few at a time, saving as we go.
  let ok = 0;
  let pending: Fetched[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    await saveFetches(store, batch, new Date());
  };
  const next = [...queue];
  const worker = async () => {
    for (let a: ArticleToFetch | undefined; (a = next.shift()); ) {
      const result = await fetchArticle(a.url);
      if (result.text) ok++;
      else console.log(`  ✗ ${a.url} (${result.error})`);
      pending.push({ id: a.id, ...result });
      if (pending.length >= SAVE_EVERY) await flush();
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  await flush();
  console.log(`Fetched ${ok} of ${queue.length} articles.`);

  // Tag every article with text from that text: the ones just fetched, and any a newer tagger hasn't seen.
  let retagged = 0;
  for (;;) {
    const articles = await untaggedArticles(store, TAG_BATCH);
    if (!articles.length) break;
    const tags = tagItems(
      articles.map((a) => a.item),
      entities,
      new Map(articles.map((a) => [a.item.id, a.body])),
    );
    await saveTextTags(store, tags, new Date());
    retagged += articles.length;
    if (articles.length < TAG_BATCH) break;
  }
  console.log(`Tagged ${retagged} articles from their full text.`);

  // What the articles say, filed under storylines with a brief on each (issue #25).
  console.log('\nStorylines…');
  const at = new Date();
  const model = workersAiFromEnv({ used: await neuronsToday(store, at), ...DEFAULT_BUDGET });
  await updateStorylines({
    store,
    model,
    entities,
    match,
    names: new Map(club.sources.map((s) => [s.id, s.name.replace(/ \(.*\)$/, '')])),
    club: club.name,
    now: at,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
