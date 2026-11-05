// BBC pages from home (5 Nov 2026). BBC Sport started answering the Worker with HTTP 403 (Cloudflare's addresses, it
// seems: the same request from a home connection gets the page), which leaves live.json, and with it the team news and
// match break-ins, with nothing. So when the Worker can't read a page itself it asks for it in the store, and the home
// agent (pipeline/src/bbc-relay.ts) fetches it and stores the parts the live feed reads:
//   state 'bbc_want:<path>'  written here when BBC refuses the Worker, at most every WANT_EVERY_MS per path
//   state 'bbc_page:<path>'  written by the agent: the page's live blocks (shared/bbc.ts liveBlocks)
// The Worker's own read is always tried first, so this goes quiet by itself if BBC lets the Worker back in.

import type { BbcData } from '../../shared/bbc.ts';
import type { D1Database } from './store.ts';

/** A relayed page older than this isn't served. */
export const RELAY_FRESH_MS = 10 * 60_000;
const WANT_EVERY_MS = 15_000;

type Rows = Record<string, unknown>[];
const run = async (db: D1Database, sql: string, ...params: unknown[]): Promise<Rows> =>
  ((await db.batch([db.prepare(sql).bind(...params)]))[0]?.results ?? []) as Rows;

export function relayed(read: (path: string) => Promise<BbcData>, database: () => D1Database | undefined, now = Date.now) {
  const asked = new Map<string, number>();
  return async (path: string): Promise<BbcData> => {
    try {
      return await read(path);
    } catch (err) {
      const db = database();
      if (!db) throw err;
      const t = now();
      if (t - (asked.get(path) ?? 0) >= WANT_EVERY_MS) {
        asked.set(path, t);
        const at = new Date(t).toISOString();
        await run(
          db,
          `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          `bbc_want:${path}`,
          JSON.stringify((err as Error).message),
          at,
        ).catch(() => undefined);
      }
      const [row] = await run(db, 'SELECT value, updated_at FROM state WHERE key = ?', `bbc_page:${path}`).catch(() => [] as Rows);
      if (!row || t - Date.parse(String(row.updated_at)) > RELAY_FRESH_MS) throw err;
      return JSON.parse(String(row.value)) as BbcData;
    }
  };
}
