import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

export function collectOne(src: SourceConfig, club: ClubConfig, now: Date): Promise<Item[]> {
  if (src.type === 'ips-forum') return collectIpsForum(src, now);
  // Reddit rate-limits bursts from one IP, so its feeds go one at a time.
  if (src.type === 'reddit') return redditQueue(() => collectSource(src, club, now));
  return collectSource(src, club, now);
}

export interface Snapshot {
  collectedAt: string;
  items: Item[];
}

const SNAPSHOT_MAX_AGE_MS = 24 * 3_600_000;

/** Items from the home-collected snapshot, if there is a recent one. */
async function fromSnapshot(src: SourceConfig, dir: string, now: Date): Promise<{ items: Item[]; ageHours: number } | undefined> {
  const path = resolve(dir, `${src.id}.json`);
  if (!existsSync(path)) return undefined;
  const snap = JSON.parse(await readFile(path, 'utf8')) as Snapshot;
  const age = now.getTime() - new Date(snap.collectedAt).getTime();
  if (age > SNAPSHOT_MAX_AGE_MS) return undefined;
  const oldest = now.getTime() - (src.maxAgeDays ?? 2) * 86_400_000;
  return { items: snap.items.filter((it) => new Date(it.publishedAt).getTime() >= oldest), ageHours: age / 3_600_000 };
}

/**
 * Pull every enabled source plus fixtures/table. Failing sources are reported, never fatal.
 * Sources marked `snapshot` fall back to the home-collected copy in `snapshotDir` when the live fetch fails.
 */
export async function collectAll(club: ClubConfig, now = new Date(), snapshotDir?: string): Promise<Collection> {
  const sources = club.sources.filter((s) => s.enabled !== false && s.url);
  const results = await Promise.allSettled(
    sources.map(async (s): Promise<{ items: Item[]; note?: string }> => {
      try {
        return { items: await collectOne(s, club, now) };
      } catch (err) {
        const snap = s.snapshot && snapshotDir ? await fromSnapshot(s, snapshotDir, now) : undefined;
        if (!snap) throw err;
        return { items: snap.items, note: `(${(err as Error).message}, used home snapshot from ${snap.ageHours.toFixed(1)}h ago)` };
      }
    }),
  );

  const items: Item[] = [];
  const report: SourceReport[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value.items);
      report.push({ name: sources[i].name, ok: true, detail: `${r.value.items.length} items ${r.value.note ?? ''}`.trim() });
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
