// BBC pages for the Worker, fetched from home (5 Nov 2026). BBC Sport answers the Worker with HTTP 403 but serves a home
// connection, so when the Worker can't read a page it asks for it in the store (worker/src/bbc-relay.ts), and the agent
// fetches it here and stores the blocks the live feed reads. It fetches a page only when the Worker has asked for it
// since the last copy was stored, so it runs at the Worker's own pace (every 20s in a match, every few minutes on a
// quiet day) and does nothing at all while BBC lets the Worker in.

import { initialData, liveBlocks } from '../../shared/bbc.ts';
import type { Store } from './store.ts';

const UA = 'Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)';
/** Requests older than this are forgotten: the Worker stopped asking (BBC let it back in, or the match is over). */
const WANT_FOR_MS = 10 * 60_000;

/** Paths the Worker wants and has no copy as new as its request. */
export async function wanted(store: Store, now: Date): Promise<string[]> {
  const [rows] = await store.batch([
    {
      sql: `SELECT substr(w.key, 10) AS path FROM state w
            LEFT JOIN state p ON p.key = 'bbc_page:' || substr(w.key, 10)
            WHERE w.key LIKE 'bbc_want:%' AND w.updated_at > ? AND (p.updated_at IS NULL OR p.updated_at < w.updated_at)`,
      params: [new Date(now.getTime() - WANT_FOR_MS).toISOString()],
    },
  ]);
  return rows.map((r) => String(r.path)).filter((p) => p.startsWith('/sport/'));
}

/** Fetch one page from BBC and store its live blocks for the Worker. */
export async function relayPage(store: Store, path: string, now = () => new Date(), fetchFn: typeof fetch = fetch): Promise<number> {
  const res = await fetchFn(`https://www.bbc.co.uk${path}`, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`BBC ${path}: HTTP ${res.status}`);
  const value = JSON.stringify(liveBlocks(initialData(await res.text())));
  const at = now().toISOString();
  await store.batch([
    {
      sql: `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [`bbc_page:${path}`, value, at],
    },
  ]);
  return value.length;
}

/** One pass: every page the Worker is waiting for, one after another. */
export async function relayBbc(store: Store, log = console): Promise<void> {
  for (const path of await wanted(store, new Date())) {
    try {
      const bytes = await relayPage(store, path);
      log.log(`[agent] BBC relay: ${path} (${Math.round(bytes / 1024)} KB)`);
    } catch (err) {
      log.warn(`[agent] BBC relay: ${(err as Error).message}`);
    }
  }
}
