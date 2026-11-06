import { mentionsAny } from './text.ts';
import type { Row, Store } from './store.ts';

// The papers round-up's raw material (#110): the past day's headlines from each paper, as the pipeline already
// ingests them from the feeds in clubs/hearts.json. Headlines only: nothing here fetches a page, and the Evening News
// and Scotsman (`pages: false`) stay headline-only. The Herald has no feed in the config, so it is absent until one is
// added there (its robots.txt lists Claude bots, so it would stay headline-only too).

/** The outlets of the round-up: source ids from clubs/hearts.json. */
export const PAPERS = ['daily-record', 'herald', 'scotsman', 'evening-news'] as const;
export type Paper = (typeof PAPERS)[number];

export interface PaperHeadline {
  id: string;
  outlet: Paper;
  title: string;
  url: string;
  publishedAt: string;
  /** The headline or feed summary names the club (its keywords), so it is about Hearts and not a general sport story. */
  hearts: boolean;
}

/** Each paper's headlines from the window ending `now` (24 hours by default), newest first; a paper with none has an empty list. */
export async function loadPapersRoundup(store: Store, keywords: string[], now: Date, hours = 24): Promise<Record<Paper, PaperHeadline[]>> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const [rows] = await store.batch([
    {
      sql: `SELECT id, source, title, summary, url, COALESCE(published_at, first_seen) AS at FROM items
            WHERE source IN (SELECT value FROM json_each(?)) AND COALESCE(published_at, first_seen) >= ? AND COALESCE(published_at, first_seen) <= ?
            ORDER BY at DESC, id`,
      params: [JSON.stringify(PAPERS), since, now.toISOString()],
    },
  ]);
  const out = Object.fromEntries(PAPERS.map((p) => [p, [] as PaperHeadline[]])) as Record<Paper, PaperHeadline[]>;
  for (const r of rows as Row[]) {
    out[r.source as Paper].push({
      id: String(r.id),
      outlet: r.source as Paper,
      title: String(r.title),
      url: String(r.url ?? ''),
      publishedAt: String(r.at),
      hearts: mentionsAny(`${r.title} ${r.summary ?? ''}`, keywords),
    });
  }
  return out;
}
