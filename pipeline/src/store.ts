import type { D1Database, D1Statement } from '../../worker/src/store.ts';
import type { Entity } from './entities.ts';
import type { Memory, PresenterPrediction } from './memory.ts';
import type { Remembered } from './script/remember.ts';
import { TAGGER_VERSION, type Tags } from './tags.ts';
import type { Item, SourceKind } from './types.ts';

// The channel's memory in Cloudflare D1, reached through the live Worker's /store endpoint (worker/src/store.ts).
// Every query the pipeline makes is here, so nothing else talks SQL. The schema is in worker/migrations/.
// A build reads what it needs at the start (loadMemory) and writes everything new in one batch at the end
// (saveBuild), which D1 runs as one transaction: a failed build writes nothing.
// Set STORE_TOKEN (and optionally STORE_URL) in .env or the GitHub secrets; without it a build has no memory.

export const STORE_URL = 'https://heartsnews-live.heartsnews.workers.dev/store';

const DAY_MS = 86_400_000;
/** Article bodies and transcripts are kept this long, then pruned (titles and summaries stay). */
const KEEP_TEXT_DAYS = 30;
/** Rows go up as JSON, unpacked with json_each, so a batch is a handful of statements (D1 counts queries). */
const CHUNK_CHARS = 400_000;
const MAX_TEXT = 100_000;

export interface Statement {
  sql: string;
  params?: (string | number | null)[];
}
export type Row = Record<string, unknown>;

export interface Store {
  /** Runs the statements in one transaction; rows for each. */
  batch(statements: Statement[]): Promise<Row[][]>;
}

export function connectStore(token: string, url = STORE_URL, fetchFn: typeof fetch = fetch): Store {
  return {
    async batch(statements) {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ statements }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { results?: Row[][]; error?: string };
      if (!res.ok || !body.results) throw new Error(`Store: ${body.error ?? `HTTP ${res.status}`}`);
      return body.results;
    },
  };
}

export function storeFromEnv(env = process.env): Store | undefined {
  return env.STORE_TOKEN ? connectStore(env.STORE_TOKEN, env.STORE_URL || STORE_URL) : undefined;
}

/** One statement per chunk of rows, the rows passed as a JSON array in the last parameter. */
function each(sql: string, rows: object[], params: (string | number | null)[] = []): Statement[] {
  const out: Statement[] = [];
  let chunk: string[] = [];
  let size = 0;
  const flush = () => {
    if (chunk.length) out.push({ sql, params: [...params, `[${chunk.join(',')}]`] });
    chunk = [];
    size = 0;
  };
  for (const r of rows) {
    const j = JSON.stringify(r);
    if (size + j.length > CHUNK_CHARS) flush();
    chunk.push(j);
    size += j.length;
  }
  flush();
  return out;
}

const text = (s: string | undefined) => (s ? s.slice(0, MAX_TEXT) : null);

// ---- Reading ----

/**
 * What the build needs: the past week's airings (by on-air title) and each presenter's latest 15 takes and
 * predictions, plus any prediction still waiting on its result.
 */
export async function loadMemory(store: Store, now: Date): Promise<Memory> {
  const [aired, takes, predictions] = await store.batch([
    {
      sql: `SELECT story AS title, MIN(at) AS firstAired, MAX(at) AS lastAired, COUNT(*) AS times, SUM(in_depth) AS inDepth
            FROM airings WHERE story IS NOT NULL AND at >= ? GROUP BY story ORDER BY lastAired DESC LIMIT 80`,
      params: [new Date(now.getTime() - 7 * DAY_MS).toISOString()],
    },
    {
      sql: `SELECT presenter_id AS presenter, topic, view, at FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY presenter_id ORDER BY at DESC, id DESC) AS n FROM takes
            ) WHERE n <= 15 ORDER BY at, id`,
    },
    {
      sql: `SELECT presenter_id AS presenter, home, away, date, home_goals AS homeGoals, away_goals AS awayGoals,
              made_at AS madeAt, outcome, actual FROM (
              SELECT *, ROW_NUMBER() OVER (PARTITION BY presenter_id ORDER BY made_at DESC, id DESC) AS n FROM predictions
            ) WHERE n <= 15 OR outcome IS NULL ORDER BY made_at, id`,
    },
  ]);

  const memory: Memory = { version: 1, updatedAt: now.toISOString(), aired: [], presenters: {} };
  const presenter = (id: string) => (memory.presenters[id] ??= { opinions: [], predictions: [] });
  for (const r of aired) {
    memory.aired.push({
      title: String(r.title),
      firstAired: String(r.firstAired),
      lastAired: String(r.lastAired),
      times: Number(r.times),
      inDepth: Number(r.inDepth),
    });
  }
  for (const r of takes) presenter(String(r.presenter)).opinions.push({ topic: String(r.topic), view: String(r.view), at: String(r.at) });
  for (const r of predictions) {
    presenter(String(r.presenter)).predictions.push({
      home: String(r.home),
      away: String(r.away),
      date: String(r.date),
      homeGoals: Number(r.homeGoals),
      awayGoals: Number(r.awayGoals),
      madeAt: String(r.madeAt),
      ...(r.outcome ? { outcome: r.outcome as 'exact' | 'right' | 'wrong', actual: String(r.actual) } : {}),
    });
  }
  return memory;
}

// ---- Writing ----

const INSERT_AIRINGS = `INSERT INTO airings (bulletin_id, story, in_depth, at)
  SELECT ?, value ->> 'title', value ->> 'inDepth', value ->> 'at' FROM json_each(?)`;

const INSERT_TAKES = `INSERT INTO takes (bulletin_id, presenter_id, topic, view, at)
  SELECT ?, value ->> 'presenter', value ->> 'topic', value ->> 'view', value ->> 'at' FROM json_each(?)`;

// A later call on the same match replaces the earlier one.
const UPSERT_PREDICTIONS = `INSERT INTO predictions
    (bulletin_id, presenter_id, home, away, date, home_goals, away_goals, made_at, outcome, actual)
  SELECT ?, value ->> 'presenter', value ->> 'home', value ->> 'away', value ->> 'date', value ->> 'homeGoals',
    value ->> 'awayGoals', value ->> 'madeAt', value ->> 'outcome', value ->> 'actual' FROM json_each(?) WHERE true
  ON CONFLICT (presenter_id, home, away, date) DO UPDATE SET home_goals = excluded.home_goals,
    away_goals = excluded.away_goals, made_at = excluded.made_at, outcome = excluded.outcome, actual = excluded.actual,
    bulletin_id = excluded.bulletin_id`;

export interface BuildRecord {
  bulletin: { id: string; phase: string; runner: 'home' | 'github' };
  /** Everything collected this build. */
  items: Item[];
  /** Article text fetched this build, by item id. */
  bodies: Map<string, string>;
  entities: Entity[];
  /** What each item is about (tags.ts), by item id. */
  tags: Map<string, Tags>;
  remembered: Remembered;
  /** Predictions whose result came in this build. */
  settled: PresenterPrediction[];
  /** Presenters renamed in channel.json (formerIds): their takes and predictions move to the new id. */
  renames: { from: string; to: string }[];
}

export function buildWrites(r: BuildRecord, now: Date): Statement[] {
  const at = now.toISOString();
  const id = r.bulletin.id;
  const statements: Statement[] = [];

  for (const { from, to } of r.renames) {
    statements.push(
      { sql: 'UPDATE takes SET presenter_id = ? WHERE presenter_id = ?', params: [to, from] },
      // The new id's own call on a match wins over the old one's.
      { sql: 'UPDATE OR IGNORE predictions SET presenter_id = ? WHERE presenter_id = ?', params: [to, from] },
      { sql: 'DELETE FROM predictions WHERE presenter_id = ?', params: [from] },
    );
  }

  statements.push({ sql: 'INSERT INTO bulletins (id, generated_at, phase, runner) VALUES (?, ?, ?, ?)', params: [id, at, r.bulletin.phase, r.bulletin.runner] });
  statements.push(...itemWrites(r.items, r.bodies, now), ...entityWrites(r.entities), ...tagWrites(r.items, r.tags, at));

  const { aired, takes, predictions } = r.remembered;
  statements.push(
    ...each(INSERT_AIRINGS, aired.map((a) => ({ title: a.title, inDepth: a.inDepth ? 1 : 0, at })), [id]),
    ...each(INSERT_TAKES, takes.map((t) => ({ ...t, at })), [id]),
    ...each(UPSERT_PREDICTIONS, predictions.map((p) => ({ ...p, outcome: null, actual: null })), [id]),
    ...each(
      `UPDATE predictions SET outcome = j.value ->> 'outcome', actual = j.value ->> 'actual' FROM json_each(?) AS j
        WHERE predictions.presenter_id = j.value ->> 'presenter' AND predictions.home = j.value ->> 'home'
          AND predictions.away = j.value ->> 'away' AND predictions.date = j.value ->> 'date'`,
      r.settled,
    ),
  );
  return statements;
}

/**
 * Items: first_seen sticks; a newly fetched body or transcript fills in. A body the ingest fetched in full
 * (fetch_status 'ok') is never replaced by a bulletin's shorter cut of it. Old text is pruned.
 */
function itemWrites(list: Item[], bodies: Map<string, string>, now: Date): Statement[] {
  const at = now.toISOString();
  const items = list.map((it) => ({
    id: it.id,
    source: it.sourceId,
    kind: it.kind,
    publisher: it.publisher ?? null,
    title: it.title,
    summary: it.summary,
    url: it.url,
    publishedAt: it.publishedAt,
    body: text(bodies.get(it.id)),
    transcript: text(it.transcript),
  }));
  return [
    ...each(
      `INSERT INTO items (id, source, kind, publisher, title, summary, url, published_at, first_seen, body, transcript)
        SELECT value ->> 'id', value ->> 'source', value ->> 'kind', value ->> 'publisher', value ->> 'title',
          value ->> 'summary', value ->> 'url', value ->> 'publishedAt', ?, value ->> 'body', value ->> 'transcript'
        FROM json_each(?) WHERE true
        ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
          publisher = COALESCE(excluded.publisher, items.publisher),
          body = CASE WHEN items.fetch_status = 'ok' THEN items.body ELSE COALESCE(excluded.body, items.body) END,
          transcript = COALESCE(excluded.transcript, items.transcript)`,
      items,
      [at],
    ),
    {
      sql: 'UPDATE items SET body = NULL, transcript = NULL WHERE first_seen < ? AND (body IS NOT NULL OR transcript IS NOT NULL)',
      params: [new Date(now.getTime() - KEEP_TEXT_DAYS * DAY_MS).toISOString()],
    },
  ];
}

/** Entities: names and types refresh; aliases added by hand are kept. People no longer at the club go inactive. */
function entityWrites(entities: Entity[]): Statement[] {
  const statements = each(
    `INSERT INTO entities (id, type, name, aliases, active)
      SELECT value ->> 'id', value ->> 'type', value ->> 'name', value ->> 'aliases', 1 FROM json_each(?) WHERE true
      ON CONFLICT (id) DO UPDATE SET type = excluded.type, name = excluded.name, active = 1,
        aliases = CASE WHEN entities.aliases = '[]' THEN excluded.aliases ELSE entities.aliases END`,
    entities.map((e) => ({ ...e, aliases: JSON.stringify(e.aliases) })),
  );
  const people = entities.filter((e) => e.type === 'player' || e.type === 'staff').map((e) => e.id);
  if (people.length) {
    statements.push({
      sql: `UPDATE entities SET active = 0 WHERE type IN ('player', 'staff') AND active = 1 AND id NOT IN (SELECT value FROM json_each(?))`,
      params: [JSON.stringify(people)],
    });
  }
  return statements;
}

/**
 * Tags from headlines: each item is tagged once, and again only by a newer tagger (its old entity links go first),
 * never over tags taken from the article's full text (textTagWrites). The entity links written are just those of
 * items whose tags were written now.
 */
function tagWrites(items: Item[], tags: Map<string, Tags>, at: string): Statement[] {
  const itemIds = new Set(items.map((it) => it.id));
  const tagged = [...tags].filter(([itemId]) => itemIds.has(itemId));
  return [
    ...each(
      `DELETE FROM item_entities WHERE item_id IN (
        SELECT item_id FROM item_tags WHERE tagger_version < ? AND from_text = 0 AND item_id IN (SELECT value ->> 'item' FROM json_each(?)))`,
      tagged.map(([item]) => ({ item })),
      [TAGGER_VERSION],
    ),
    ...each(
      `INSERT INTO item_tags (item_id, category, mood, tagger_version, tagged_at)
        SELECT value ->> 'item', value ->> 'category', value ->> 'mood', ?, ? FROM json_each(?) WHERE true
        ON CONFLICT (item_id) DO UPDATE SET category = excluded.category, mood = excluded.mood,
          tagger_version = excluded.tagger_version, tagged_at = excluded.tagged_at
        WHERE excluded.tagger_version > item_tags.tagger_version AND item_tags.from_text = 0`,
      tagged.map(([item, t]) => ({ item, category: t.category, mood: t.mood })),
      [TAGGER_VERSION, at],
    ),
    ...each(
      `INSERT OR IGNORE INTO item_entities (item_id, entity_id)
        SELECT t.item_id, j.value ->> 'entity' FROM (SELECT item_id FROM item_tags WHERE tagged_at = ? AND from_text = 0) AS t
        JOIN json_each(?) AS j ON j.value ->> 'item' = t.item_id`,
      tagged.flatMap(([item, t]) => t.entities.map((entity) => ({ item, entity }))),
      [at],
    ),
  ];
}

export async function saveBuild(store: Store, r: BuildRecord, now: Date): Promise<void> {
  await store.batch(buildWrites(r, now));
}

// ---- Ingesting ----
// `npm run ingest` (ingest.ts) gets every press and official article into the store once, in full, and tags it from
// that text. Aggregator links are redirects, so those items stay headline-only; video transcripts come in with their
// items. Separate from building a bulletin, which reads and writes the store as before.

/** Kinds whose links are the article itself. */
export const ARTICLE_KINDS: SourceKind[] = ['press', 'official'];
/** A page that refuses us, or has no readable text, is tried this many times, at least RETRY_MS apart. */
export const MAX_ATTEMPTS = 3;
export const RETRY_MS = 3_600_000;

export interface ArticleToFetch {
  id: string;
  url: string;
}

export interface Fetched {
  id: string;
  /** The article's text, or undefined when the fetch failed. */
  text?: string;
  error?: string;
}

/**
 * Writes what was collected (tagged from headlines) and the entity list, then returns every article from the last
 * 30 days the store has no text for that's due a try: never fetched, or failed an hour or more ago. Newest first.
 */
export async function ingestItems(store: Store, items: Item[], entities: Entity[], tags: Map<string, Tags>, now: Date): Promise<ArticleToFetch[]> {
  const results = await store.batch([
    ...itemWrites(items, new Map(), now),
    ...entityWrites(entities),
    ...tagWrites(items, tags, now.toISOString()),
    {
      sql: `SELECT id, url FROM items
            WHERE kind IN (SELECT value FROM json_each(?)) AND url IS NOT NULL AND url != '' AND first_seen >= ?
              AND (fetch_status IS NULL OR (fetch_status = 'failed' AND fetched_at < ?))
            ORDER BY COALESCE(published_at, first_seen) DESC`,
      params: [
        JSON.stringify(ARTICLE_KINDS),
        new Date(now.getTime() - KEEP_TEXT_DAYS * DAY_MS).toISOString(),
        new Date(now.getTime() - RETRY_MS).toISOString(),
      ],
    },
  ]);
  return (results.at(-1) ?? []).map((r) => ({ id: String(r.id), url: String(r.url) }));
}

/** How each fetch went. A failure on the last try gives up on that page for good. */
export function fetchWrites(fetched: Fetched[], now: Date): Statement[] {
  return each(
    `UPDATE items SET body = COALESCE(j.value ->> 'text', items.body),
        fetch_status = CASE WHEN j.value ->> 'text' IS NOT NULL THEN 'ok' WHEN items.attempts + 1 >= ? THEN 'gave_up' ELSE 'failed' END,
        attempts = items.attempts + 1, fetched_at = ?, fetch_error = j.value ->> 'error'
      FROM json_each(?) AS j WHERE items.id = j.value ->> 'id'`,
    fetched.map((f) => ({ id: f.id, text: text(f.text), error: f.error ?? null })),
    [MAX_ATTEMPTS, now.toISOString()],
  );
}

export async function saveFetches(store: Store, fetched: Fetched[], now: Date): Promise<void> {
  if (fetched.length) await store.batch(fetchWrites(fetched, now));
}

/** Articles fetched in full whose tags aren't from that text yet (just fetched, or a newer tagger), newest first. */
export async function untaggedArticles(store: Store, limit: number): Promise<{ item: Item; body: string }[]> {
  const [rows] = await store.batch([
    {
      sql: `SELECT i.id, i.source, i.kind, i.publisher, i.title, i.summary, i.url, i.published_at, i.body FROM items i
            LEFT JOIN item_tags t ON t.item_id = i.id
            WHERE i.fetch_status = 'ok' AND i.body IS NOT NULL AND (t.item_id IS NULL OR t.from_text = 0 OR t.tagger_version < ?)
            ORDER BY i.first_seen DESC LIMIT ?`,
      params: [TAGGER_VERSION, limit],
    },
  ]);
  return rows.map((r) => ({
    item: {
      id: String(r.id),
      sourceId: String(r.source),
      sourceName: String(r.publisher ?? r.source),
      kind: r.kind as SourceKind,
      ...(r.publisher ? { publisher: String(r.publisher) } : {}),
      title: String(r.title),
      summary: String(r.summary ?? ''),
      url: String(r.url ?? ''),
      publishedAt: String(r.published_at ?? ''),
    },
    body: String(r.body),
  }));
}

/** Tags from an article's full text replace whatever the item had, entity links and all. */
export function textTagWrites(tags: Map<string, Tags>, now: Date): Statement[] {
  const list = [...tags];
  return [
    ...each(`DELETE FROM item_entities WHERE item_id IN (SELECT value ->> 'item' FROM json_each(?))`, list.map(([item]) => ({ item }))),
    ...each(
      `INSERT INTO item_tags (item_id, category, mood, tagger_version, tagged_at, from_text)
        SELECT value ->> 'item', value ->> 'category', value ->> 'mood', ?, ?, 1 FROM json_each(?) WHERE true
        ON CONFLICT (item_id) DO UPDATE SET category = excluded.category, mood = excluded.mood,
          tagger_version = excluded.tagger_version, tagged_at = excluded.tagged_at, from_text = 1`,
      list.map(([item, t]) => ({ item, category: t.category, mood: t.mood })),
      [TAGGER_VERSION, now.toISOString()],
    ),
    ...each(
      `INSERT OR IGNORE INTO item_entities (item_id, entity_id) SELECT value ->> 'item', value ->> 'entity' FROM json_each(?)`,
      list.flatMap(([item, t]) => t.entities.map((entity) => ({ item, entity }))),
    ),
  ];
}

export async function saveTextTags(store: Store, tags: Map<string, Tags>, now: Date): Promise<void> {
  if (tags.size) await store.batch(textTagWrites(tags, now));
}

// ---- The job queue ----
// The Worker's clock (worker/src/clock.ts) queues the jobs; the runners claim them here. A claim is one UPDATE on a
// queued row, so a job is only ever claimed once.

export type JobKind = 'programme' | 'breaking';
export type Runner = 'home' | 'github';

export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  test: boolean;
}

const CLAIMED = 'RETURNING id, kind, payload, test';
const toJob = (r: Row): Job => ({ id: String(r.id), kind: r.kind as JobKind, payload: JSON.parse(String(r.payload)), test: Number(r.test) === 1 });

/**
 * The home PC checking in: tells the clock it's on (so jobs wait a minute or two for it) and claims the oldest queued
 * job of each kind it has room for, breaking news first.
 */
export async function checkIn(store: Store, kinds: JobKind[], now: Date): Promise<Job[]> {
  const at = now.toISOString();
  const results = await store.batch([
    {
      sql: `INSERT INTO state (key, value, updated_at) VALUES ('home_seen', ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [JSON.stringify(at), at],
    },
    ...(['breaking', 'programme'] as const)
      .filter((kind) => kinds.includes(kind))
      .map((kind) => ({
        sql: `UPDATE jobs SET status = 'claimed', runner = 'home', claimed_at = ?, attempts = attempts + 1
              WHERE status = 'queued' AND id = (SELECT id FROM jobs WHERE status = 'queued' AND test = 0 AND kind = ? ORDER BY queued_at LIMIT 1)
              ${CLAIMED}`,
        params: [at, kind],
      })),
  ]);
  return results.slice(1).flat().map(toJob);
}

/** The home PC going off: the clock stops waiting for it. */
export async function signOff(store: Store): Promise<void> {
  await store.batch([{ sql: `DELETE FROM state WHERE key = 'home_seen'` }]);
}

/** Claims one job by its id (GitHub, sent it by the clock). Undefined if it's been claimed already, or is gone. */
export async function claimJob(store: Store, id: string, runner: Runner, now: Date): Promise<Job | undefined> {
  const [[row]] = await store.batch([
    {
      sql: `UPDATE jobs SET status = 'claimed', runner = ?, claimed_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'queued' ${CLAIMED}`,
      params: [runner, now.toISOString(), id],
    },
  ]);
  return row && toJob(row);
}

/** How a claimed job ended. */
export async function finishJob(store: Store, id: string, status: 'done' | 'failed' | 'dropped', now: Date, error?: string): Promise<void> {
  await store.batch([
    { sql: `UPDATE jobs SET status = ?, finished_at = ?, error = ? WHERE id = ? AND status = 'claimed'`, params: [status, now.toISOString(), error ?? null, id] },
  ]);
}

/**
 * Puts claimed jobs back in the queue (the home PC stopping mid-build). After signOff, the clock sends them to GitHub
 * on its next run.
 */
export async function releaseJobs(store: Store, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await store.batch([
    {
      sql: `UPDATE jobs SET status = 'queued', runner = NULL, claimed_at = NULL, dispatched_at = NULL
            WHERE status = 'claimed' AND id IN (SELECT value FROM json_each(?))`,
      params: [JSON.stringify(ids)],
    },
  ]);
}

/**
 * Takes the lock on publishing for `ms`, if it's free (or has run out). The runners publish to gh-pages in turns, so
 * neither publishes over a programme or package the other has just put out.
 */
export async function takeLock(store: Store, name: string, holder: string, ms: number, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const [rows] = await store.batch([
    {
      sql: `INSERT INTO locks (name, holder, until) VALUES (?, ?, ?)
            ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, until = excluded.until WHERE locks.until < ? OR locks.holder = excluded.holder
            RETURNING holder`,
      params: [name, holder, new Date(now.getTime() + ms).toISOString(), at],
    },
  ]);
  return rows.some((r) => r.holder === holder);
}

export async function dropLock(store: Store, name: string, holder: string): Promise<void> {
  await store.batch([{ sql: 'DELETE FROM locks WHERE name = ? AND holder = ?', params: [name, holder] }]);
}

export interface JobRow {
  id: string;
  status: string;
  runner: string | null;
  queuedAt: string;
  dispatchedAt: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** Jobs whose id starts with `prefix`, oldest first: a replay's test jobs, to see how long each took. */
export async function jobsLike(store: Store, prefix: string): Promise<JobRow[]> {
  const [rows] = await store.batch([
    {
      sql: `SELECT id, status, runner, queued_at AS queuedAt, dispatched_at AS dispatchedAt, claimed_at AS claimedAt,
              finished_at AS finishedAt, error FROM jobs WHERE substr(id, 1, length(?)) = ? ORDER BY queued_at, id`,
      params: [prefix, prefix],
    },
  ]);
  return rows as unknown as JobRow[];
}

/** Forgets a replay's tracker, so the next replay breaks in for every goal again. */
export async function clearTestState(store: Store): Promise<void> {
  await store.batch([{ sql: `DELETE FROM state WHERE key LIKE 'test:%'` }]);
}

/** The store as a D1 database, so the Worker's clock can run from the PC against it (a replay). */
export function storeAsD1(store: Store): D1Database {
  type Prepared = D1Statement & { s: Statement };
  const prepare = (sql: string, params: unknown[] = []): Prepared => ({
    s: { sql, params: params as Statement['params'] },
    bind: (...values) => prepare(sql, values),
  });
  return {
    prepare: (sql) => prepare(sql),
    batch: async (statements) => (await store.batch((statements as Prepared[]).map((p) => p.s))).map((results) => ({ results })),
  };
}

// ---- Moving over from memory.json ----

/** Whether memory.json has been imported already (imported airings and takes have no bulletin). */
export async function imported(store: Store): Promise<boolean> {
  const [[row]] = await store.batch([
    { sql: 'SELECT (SELECT COUNT(*) FROM airings WHERE bulletin_id IS NULL) + (SELECT COUNT(*) FROM takes WHERE bulletin_id IS NULL) AS n' },
  ]);
  return Number(row?.n) > 0;
}

/**
 * The old memory.json as store rows. Each aired story becomes `times` airings (the first at firstAired, the rest at
 * lastAired, the first `inDepth` of them in depth), which add back up to the same story when read.
 */
export function importWrites(memory: Memory): Statement[] {
  const aired = memory.aired.flatMap((a) =>
    Array.from({ length: Math.max(1, a.times) }, (_, i) => ({ title: a.title, inDepth: i < a.inDepth ? 1 : 0, at: i === 0 ? a.firstAired : a.lastAired })),
  );
  const presenters = Object.entries(memory.presenters);
  const takes = presenters.flatMap(([presenter, pm]) => pm.opinions.map((o) => ({ presenter, ...o })));
  const predictions = presenters.flatMap(([presenter, pm]) =>
    pm.predictions.map((p) => ({ presenter, ...p, outcome: p.outcome ?? null, actual: p.actual ?? null })),
  );
  return [...each(INSERT_AIRINGS, aired, [null]), ...each(INSERT_TAKES, takes, [null]), ...each(UPSERT_PREDICTIONS, predictions, [null])];
}
