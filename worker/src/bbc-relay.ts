// BBC pages from home (5 Nov 2026). BBC Sport started answering the Worker with HTTP 403 (Cloudflare's addresses, it
// seems: the same request from a home connection gets the page), which leaves live.json, and with it the team news and
// match break-ins, with nothing. So when the Worker can't read a page itself it asks for it in the store, and the home
// agent (pipeline/src/bbc-relay.ts) fetches it and stores the parts the live feed reads:
//   state 'bbc_want:<path>'  written here when BBC refuses the Worker, at most every WANT_EVERY_MS per path
//   state 'bbc_page:<path>'  written by the agent: the page's live blocks (shared/bbc.ts liveBlocks)
//   state 'bbc_refused'      written here when BBC refuses (403 or 429): until when the Worker doesn't try BBC itself
// After a refusal the Worker goes straight to the home copy for REFUSED_FOR_MS (6 Nov 2026), so BBC isn't sent a
// refused request alongside every relayed one. Then it tries once more, so this still goes quiet by itself if BBC lets
// the Worker back in.

import type { BbcData } from '../../shared/bbc.ts';
import type { D1Database } from './store.ts';

/** A relayed page older than this isn't served. */
export const RELAY_FRESH_MS = 10 * 60_000;
const WANT_EVERY_MS = 15_000;

type Rows = Record<string, unknown>[];
const run = async (db: D1Database, sql: string, ...params: unknown[]): Promise<Rows> =>
  ((await db.batch([db.prepare(sql).bind(...params)]))[0]?.results ?? []) as Rows;

/** After BBC refuses the Worker, it doesn't try BBC itself again for this long. */
export const REFUSED_FOR_MS = 30 * 60_000;
/** A refusal, as opposed to a timeout or BBC having a bad minute. */
const refusal = (err: Error) => /HTTP (403|429)\b/.test(err.message);

interface Refused {
  until: number;
  /** BBC's answer, e.g. "HTTP 403". */
  said: string;
}

export function relayed(read: (path: string) => Promise<BbcData>, database: () => D1Database | undefined, now = Date.now) {
  const asked = new Map<string, number>();
  /** Undefined until looked up in the store: a fresh instance learns from the others. */
  let refused: Refused | null | undefined;
  return async (path: string): Promise<BbcData> => {
    const db = database();
    if (refused === undefined) {
      const [row] = db ? await run(db, `SELECT value FROM state WHERE key = 'bbc_refused'`).catch(() => [] as Rows) : [];
      refused = row ? (JSON.parse(String(row.value)) as Refused) : null;
    }
    let err: Error;
    if (!refused || now() >= refused.until) {
      try {
        return await read(path);
      } catch (e) {
        err = e as Error;
        if (refusal(err)) {
          refused = { until: now() + REFUSED_FOR_MS, said: err.message.match(/HTTP \d+/)![0] };
          if (db)
            await run(
              db,
              `INSERT INTO state (key, value, updated_at) VALUES ('bbc_refused', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              JSON.stringify(refused),
              new Date(now()).toISOString(),
            ).catch(() => undefined);
        }
      }
    } else {
      err = new Error(`BBC ${path}: ${refused.said} (refused earlier; the Worker tries again at ${new Date(refused.until).toISOString()})`);
    }
    // Asked for from home, and served from the home copy while it's fresh.
    if (!db) throw err;
    const t = now();
    if (t - (asked.get(path) ?? 0) >= WANT_EVERY_MS) {
      asked.set(path, t);
      const at = new Date(t).toISOString();
      await run(
        db,
        `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        `bbc_want:${path}`,
        JSON.stringify(err.message),
        at,
      ).catch(() => undefined);
    }
    const [row] = await run(db, 'SELECT value, updated_at FROM state WHERE key = ?', `bbc_page:${path}`).catch(() => [] as Rows);
    if (!row || t - Date.parse(String(row.updated_at)) > RELAY_FRESH_MS) throw err;
    return JSON.parse(String(row.value)) as BbcData;
  };
}
