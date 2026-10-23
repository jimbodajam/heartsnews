import type { Entity } from './entities.ts';
import type { Memory, PresenterPrediction } from './memory.ts';
import type { Remembered } from './script/remember.ts';
import type { Item } from './types.ts';

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

  // Items: first_seen sticks; a newly fetched body or transcript fills in.
  const items = r.items.map((it) => ({
    id: it.id,
    source: it.sourceId,
    kind: it.kind,
    publisher: it.publisher ?? null,
    title: it.title,
    summary: it.summary,
    url: it.url,
    publishedAt: it.publishedAt,
    body: text(r.bodies.get(it.id)),
    transcript: text(it.transcript),
  }));
  statements.push(
    ...each(
      `INSERT INTO items (id, source, kind, publisher, title, summary, url, published_at, first_seen, body, transcript)
        SELECT value ->> 'id', value ->> 'source', value ->> 'kind', value ->> 'publisher', value ->> 'title',
          value ->> 'summary', value ->> 'url', value ->> 'publishedAt', ?, value ->> 'body', value ->> 'transcript'
        FROM json_each(?) WHERE true
        ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
          publisher = COALESCE(excluded.publisher, items.publisher), body = COALESCE(excluded.body, items.body),
          transcript = COALESCE(excluded.transcript, items.transcript)`,
      items,
      [at],
    ),
    {
      sql: 'UPDATE items SET body = NULL, transcript = NULL WHERE first_seen < ? AND (body IS NOT NULL OR transcript IS NOT NULL)',
      params: [new Date(now.getTime() - KEEP_TEXT_DAYS * DAY_MS).toISOString()],
    },
  );

  // Entities: names and types refresh; aliases added by hand are kept. People no longer at the club go inactive.
  statements.push(
    ...each(
      `INSERT INTO entities (id, type, name, aliases, active)
        SELECT value ->> 'id', value ->> 'type', value ->> 'name', value ->> 'aliases', 1 FROM json_each(?) WHERE true
        ON CONFLICT (id) DO UPDATE SET type = excluded.type, name = excluded.name, active = 1,
          aliases = CASE WHEN entities.aliases = '[]' THEN excluded.aliases ELSE entities.aliases END`,
      r.entities.map((e) => ({ ...e, aliases: JSON.stringify(e.aliases) })),
    ),
  );
  const people = r.entities.filter((e) => e.type === 'player' || e.type === 'staff').map((e) => e.id);
  if (people.length) {
    statements.push({
      sql: `UPDATE entities SET active = 0 WHERE type IN ('player', 'staff') AND active = 1 AND id NOT IN (SELECT value FROM json_each(?))`,
      params: [JSON.stringify(people)],
    });
  }

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

export async function saveBuild(store: Store, r: BuildRecord, now: Date): Promise<void> {
  await store.batch(buildWrites(r, now));
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
