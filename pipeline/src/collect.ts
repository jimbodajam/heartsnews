// Milestone 2: pull every enabled source for a club and dump the raw material to pipeline/out/.
// Usage: npm run collect [-- clubs/hearts.json]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSource } from './collectors/sources.ts';
import { collectMatchData } from './collectors/sportsdb.ts';
import { normaliseTitle } from './text.ts';
import type { ClubConfig, Item, SourceKind } from './types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'pipeline/out');

// When the same story appears more than once, keep the copy from the most authoritative kind of source.
const KIND_RANK: Record<SourceKind, number> = { official: 0, press: 1, video: 2, podcast: 3, aggregator: 4, forum: 5 };

let redditChain: Promise<unknown> = Promise.resolve();
function redditQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = redditChain.then(() => new Promise((r) => setTimeout(r, 2500))).then(task);
  redditChain = run.catch(() => undefined);
  return run;
}

function dedupe(items: Item[]): Item[] {
  const byKey = new Map<string, Item>();
  for (const item of items) {
    const key = item.kind === 'forum' ? item.id : normaliseTitle(item.title);
    const existing = byKey.get(key);
    if (!existing || KIND_RANK[item.kind] < KIND_RANK[existing.kind]) byKey.set(key, item);
  }
  return [...byKey.values()];
}

async function main() {
  const clubPath = resolve(ROOT, process.argv[2] ?? 'clubs/hearts.json');
  const club = JSON.parse(await readFile(clubPath, 'utf8')) as ClubConfig;
  const sources = club.sources.filter((s) => s.enabled !== false && s.url);

  console.log(`Collecting for ${club.name} from ${sources.length} sources…\n`);

  // Reddit rate-limits bursts from one IP, so its feeds go one at a time after everything else.
  const results = await Promise.allSettled(sources.map((s) => (s.type === 'reddit' ? redditQueue(() => collectSource(s, club)) : collectSource(s, club))));
  const items: Item[] = [];
  results.forEach((r, i) => {
    const name = sources[i].name.padEnd(30);
    if (r.status === 'fulfilled') {
      items.push(...r.value);
      console.log(`  ✔ ${name} ${r.value.length} items`);
    } else {
      console.log(`  ✘ ${name} ${(r.reason as Error).message}`);
    }
  });

  let match;
  try {
    match = await collectMatchData(club);
    console.log(`  ✔ ${'TheSportsDB'.padEnd(30)} ${match.next.length} next, ${match.last.length} last, ${match.table.length} table rows`);
  } catch (err) {
    console.log(`  ✘ ${'TheSportsDB'.padEnd(30)} ${(err as Error).message}`);
  }

  const unique = dedupe(items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, 'items.json'), JSON.stringify(unique, null, 2));
  if (match) await writeFile(resolve(OUT, 'match.json'), JSON.stringify(match, null, 2));

  console.log(`\n${unique.length} unique items (${items.length - unique.length} duplicates dropped) → pipeline/out/items.json`);
  console.log('\nLatest:');
  for (const it of unique.slice(0, 12)) {
    console.log(`  ${it.publishedAt.slice(0, 16).replace('T', ' ')}  [${it.sourceId}] ${it.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
