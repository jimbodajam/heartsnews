import { normaliseTitle } from '../text.ts';
import type { ClubConfig, Item, MatchData, SourceConfig, SourceKind } from '../types.ts';
import { collectIpsForum } from './ips-forum.ts';
import { collectSource } from './sources.ts';
import { collectMatchData } from './sportsdb.ts';

export interface SourceReport {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Collection {
  items: Item[];
  match?: MatchData;
  report: SourceReport[];
}

// When the same story appears more than once, keep the copy from the most authoritative kind of source.
const KIND_RANK: Record<SourceKind, number> = { official: 0, press: 1, video: 2, podcast: 3, aggregator: 4, forum: 5 };

function dedupe(items: Item[]): Item[] {
  const byKey = new Map<string, Item>();
  for (const item of items) {
    const key = item.kind === 'forum' ? item.id : normaliseTitle(item.title);
    const existing = byKey.get(key);
    if (!existing || KIND_RANK[item.kind] < KIND_RANK[existing.kind]) byKey.set(key, item);
  }
  return [...byKey.values()];
}

let redditChain: Promise<unknown> = Promise.resolve();
function redditQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = redditChain.then(() => new Promise((r) => setTimeout(r, 2500))).then(task);
  redditChain = run.catch(() => undefined);
  return run;
}

function collectOne(src: SourceConfig, club: ClubConfig, now: Date): Promise<Item[]> {
  if (src.type === 'ips-forum') return collectIpsForum(src, now);
  // Reddit rate-limits bursts from one IP, so its feeds go one at a time.
  if (src.type === 'reddit') return redditQueue(() => collectSource(src, club, now));
  return collectSource(src, club, now);
}

/** Pull every enabled source plus fixtures/table. Failing sources are reported, never fatal. */
export async function collectAll(club: ClubConfig, now = new Date()): Promise<Collection> {
  const sources = club.sources.filter((s) => s.enabled !== false && s.url);
  const results = await Promise.allSettled(sources.map((s) => collectOne(s, club, now)));

  const items: Item[] = [];
  const report: SourceReport[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
      report.push({ name: sources[i].name, ok: true, detail: `${r.value.length} items` });
    } else {
      report.push({ name: sources[i].name, ok: false, detail: (r.reason as Error).message });
    }
  });

  let match: MatchData | undefined;
  try {
    match = await collectMatchData(club, now);
    report.push({ name: 'TheSportsDB', ok: true, detail: `${match.next.length} next, ${match.last.length} last, ${match.table.length} table rows` });
  } catch (err) {
    report.push({ name: 'TheSportsDB', ok: false, detail: (err as Error).message });
  }

  return { items: dedupe(items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), match, report };
}

export function printReport(report: SourceReport[]): void {
  for (const r of report) console.log(`  ${r.ok ? '✔' : '✘'} ${r.name.padEnd(30)} ${r.detail}`);
}
