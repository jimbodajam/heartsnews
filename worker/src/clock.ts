// The channel's clock (issue #29). The Worker's cron runs tick() every minute: it reads live.json, decides what's due
// (a programme in each :00 and :30 slot and straight after half-time and full time, pipeline/src/cadence.ts; a breaking
// package for the team news and each goal, red card, kick-off, half-time and full time, pipeline/src/breaking/detect.ts) and queues each
// as a job in D1. Then it hands the jobs out. The home PC gets first refusal: when it has checked in lately it claims
// jobs itself through /store (pipeline/src/agent.ts). Otherwise, or if it hasn't claimed one within a minute or two,
// GitHub Actions is asked to build it (workflow_dispatch). A job is claimed once, so only one runner publishes it.
// A replayed match goes through this same code from the PC (`npm run replay -- --queue`), as test jobs.
// It also starts the ingest (.github/workflows/ingest.yml, pipeline/src/ingest.ts) at :07 and :37: GitHub's own schedule
// drops or delays most runs on this repo.

import { EventTracker, type TrackerState } from '../../pipeline/src/breaking/detect.ts';
import { Cadence, type CadenceState } from '../../pipeline/src/cadence.ts';
import type { LiveFeed } from '../../shared/live.ts';
import type { D1Database } from './store.ts';

/** A programme every this often, on the clock. */
export const EVERY_MS = 30 * 60_000;
/** The home PC counts as on if it checked in this recently (it checks in every 30 seconds). */
export const HOME_FRESH_MS = 90_000;
/** How long a job waits for the home PC to claim it before GitHub is asked. */
const GRACE_MS = { programme: 2 * 60_000, breaking: 60_000 };
/** A job claimed but not finished in this long has lost its runner (the PC was switched off mid-build). */
const CLAIM_MS = { programme: 40 * 60_000, breaking: 10 * 60_000 };
/** Claims a job gets before it's given up on. */
const MAX_ATTEMPTS = 2;
/** GitHub is asked again if it hasn't claimed a job in this long (a run that never started), up to MAX_DISPATCHES. */
const REDISPATCH_MS = 10 * 60_000;
const MAX_DISPATCHES = 3;
/** A package still queued after this long is no longer news. */
const BREAKING_STALE_MS = 20 * 60_000;
/** The ingest runs every half hour, this far past :00 and :30 (clear of the programmes). */
export const INGEST_OFFSET_MS = 7 * 60_000;

export type JobKind = 'programme' | 'breaking';
/** Asks GitHub Actions to build a job. */
export type Dispatch = (job: { id: string; kind: JobKind }) => Promise<void>;

export interface TickOptions {
  dispatch: Dispatch;
  /** The time now (ms) for the queue. Breaking news goes by live.json's own time, so a replay can run fast. */
  now?: number;
  /** A replay's run id: its jobs are test jobs, it keeps its own tracker, and there are no programmes. */
  test?: string;
  /** Asks GitHub Actions to run the ingest. A replay never does. */
  ingest?: () => Promise<void>;
}

export interface TickReport {
  queued: string[];
  dispatched: string[];
  errors: string[];
  /** Whether the ingest was started this run. */
  ingested?: boolean;
}

interface Statement {
  sql: string;
  params?: unknown[];
}

const run = async (db: D1Database, statements: Statement[]) =>
  (await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))))).map((r) => (r.results ?? []) as Record<string, unknown>[]);

const iso = (t: number) => new Date(t).toISOString();
const setState = (key: string, value: unknown, at: string): Statement => ({
  sql: 'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  params: [key, JSON.stringify(value), at],
});

/** One run of the clock: queue what's due, tidy the queue, and send GitHub what the home PC won't take. */
export async function tick(db: D1Database, feed: LiveFeed | undefined, { dispatch, now = Date.now(), test, ingest }: TickOptions): Promise<TickReport> {
  const prefix = test ? 'test:' : '';
  const at = iso(now);
  const [rows] = await run(db, [
    { sql: 'SELECT key, value FROM state WHERE key IN (?, ?, ?, ?)', params: [`${prefix}tracker`, `${prefix}cadence`, 'home_seen', 'ingest_slot'] },
  ]);
  const state = new Map(rows.map((r) => [String(r.key), JSON.parse(String(r.value)) as unknown]));
  const tracker = new EventTracker((state.get(`${prefix}tracker`) as TrackerState) ?? { done: [] });
  const cadence = new Cadence(EVERY_MS, (state.get(`${prefix}cadence`) as CadenceState) ?? {});
  const homeSeen = Date.parse(String(state.get('home_seen') ?? ''));
  const homeOn = !test && now - homeSeen < HOME_FRESH_MS;

  const jobs: { id: string; kind: JobKind; payload: unknown }[] = [];
  const m = feed?.match;
  if (m) {
    const t = Date.parse(feed.updated);
    const breaking = (key: string, payload: object) =>
      jobs.push({ id: `${test ? `test:${test}:` : ''}breaking:${m.kickOff}:${key}`, kind: 'breaking', payload: { ...payload, ...(test ? { templates: true } : {}) } });
    const lineup = tracker.lineup(m);
    if (lineup) breaking(lineup.key, lineup);
    for (const r of tracker.update(m, t)) breaking(r.key, r);
    const p = tracker.period(m, t);
    if (p) breaking(p.key, p);
  }
  if (!test) {
    if (feed) cadence.see(feed, now);
    const reason = cadence.due(now);
    if (reason) {
      const id = reason === 'regular' ? `programme:${iso(cadence.slotOf(now))}` : `programme:${reason}:${cadence.state.kickOff}`;
      jobs.push({ id, kind: 'programme', payload: { reason } });
    }
  }

  const programme = jobs.find((j) => j.kind === 'programme');
  const [, , , , , , queued] = await run(db, [
    setState(`${prefix}tracker`, tracker.state, at),
    setState(`${prefix}cadence`, cadence.state, at),
    {
      // The same id twice (two runs at once) is one job.
      sql: `INSERT OR IGNORE INTO jobs (id, kind, payload, test, queued_at)
              SELECT value ->> 'id', value ->> 'kind', value ->> 'payload', ?, ? FROM json_each(?)`,
      params: [test ? 1 : 0, at, JSON.stringify(jobs.map((j) => ({ ...j, payload: JSON.stringify(j.payload) })))],
    },
    // A new programme replaces one still waiting; old breaking news is dropped.
    {
      sql: `UPDATE jobs SET status = 'dropped', finished_at = ?, error = 'overtaken'
            WHERE status = 'queued' AND ((kind = 'programme' AND id != ? AND ? IS NOT NULL) OR (kind = 'breaking' AND queued_at < ?))`,
      params: [at, programme?.id ?? '', programme?.id ?? null, iso(now - BREAKING_STALE_MS)],
    },
    // A runner that's gone quiet loses its job: it's queued again, or after MAX_ATTEMPTS given up on.
    {
      sql: `UPDATE jobs SET status = 'failed', finished_at = ?, error = 'runner lost'
            WHERE status = 'claimed' AND attempts >= ? AND claimed_at < CASE kind WHEN 'programme' THEN ? ELSE ? END`,
      params: [at, MAX_ATTEMPTS, iso(now - CLAIM_MS.programme), iso(now - CLAIM_MS.breaking)],
    },
    {
      sql: `UPDATE jobs SET status = 'queued', runner = NULL, claimed_at = NULL, dispatched_at = NULL, error = 'runner lost'
            WHERE status = 'claimed' AND claimed_at < CASE kind WHEN 'programme' THEN ? ELSE ? END`,
      params: [iso(now - CLAIM_MS.programme), iso(now - CLAIM_MS.breaking)],
    },
    // The Worker sends GitHub the channel's jobs; a replay sends its own test jobs.
    {
      sql: `SELECT id, kind, test, queued_at, dispatched_at, dispatches FROM jobs WHERE status = 'queued' AND test = ?
            ORDER BY kind = 'breaking' DESC, queued_at`,
      params: [test ? 1 : 0],
    },
  ]);

  const report: TickReport = { queued: jobs.map((j) => j.id), dispatched: [], errors: [] };
  for (const j of queued) {
    const kind = j.kind as JobKind;
    // The home PC's to take for a minute or two, while it's on. Test jobs are for GitHub.
    if (homeOn && now - Date.parse(String(j.queued_at)) < GRACE_MS[kind]) continue;
    if (j.dispatched_at && (now - Date.parse(String(j.dispatched_at)) < REDISPATCH_MS || Number(j.dispatches) >= MAX_DISPATCHES)) continue;
    try {
      await dispatch({ id: String(j.id), kind });
      report.dispatched.push(String(j.id));
    } catch (err) {
      report.errors.push(`${j.id}: ${(err as Error).message}`);
    }
  }
  if (report.dispatched.length) {
    await run(db, [
      {
        sql: `UPDATE jobs SET dispatched_at = ?, dispatches = dispatches + 1 WHERE id IN (SELECT value FROM json_each(?))`,
        params: [at, JSON.stringify(report.dispatched)],
      },
    ]);
  }

  // The ingest, once per half-hour slot. If GitHub doesn't take the ask, it's tried again the next minute.
  const slot = Math.floor((now - INGEST_OFFSET_MS) / EVERY_MS);
  if (ingest && !test && state.get('ingest_slot') !== slot) {
    try {
      await ingest();
      await run(db, [setState('ingest_slot', slot, at)]);
      report.ingested = true;
    } catch (err) {
      report.errors.push(`ingest: ${(err as Error).message}`);
    }
  }
  return report;
}

/** Runs one of this repo's workflows on GitHub (workflow_dispatch), with a token that can only run its workflows. */
async function runWorkflow(repo: string, token: string, workflow: string, inputs: Record<string, string>, fetchFn: typeof fetch): Promise<void> {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'heartsnews-live',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Dispatches the bulletin workflow with a job's id. */
export function dispatcher(repo: string, token: string, fetchFn: typeof fetch = fetch): Dispatch {
  return ({ id, kind }) => runWorkflow(repo, token, 'bulletin.yml', { job: id, kind }, fetchFn);
}

/** Starts the ingest workflow. */
export function ingester(repo: string, token: string, fetchFn: typeof fetch = fetch): () => Promise<void> {
  return () => runWorkflow(repo, token, 'ingest.yml', {}, fetchFn);
}
