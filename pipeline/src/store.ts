import type { D1Database, D1Statement } from '../../worker/src/store.ts';
import type { Entity } from './entities.ts';
import type { Memory, PresenterPrediction } from './memory.ts';
import type { OnAirDesk } from './onair.ts';
import type { LedgerMatch } from './script/ledger.ts';
import type { Remembered } from './script/remember.ts';
import type { Brief, ClaimSource, ClaimStatus, CloseReason, SiftItem, SiftPlan, StoryDesk, Storyline, StorylineKind } from './storylines.ts';
import { TAGGER_VERSION, type Tags } from './tags.ts';
import { renderSummary } from './summary-text.ts';
import type { Item, SourceKind, VideoSummary } from './types.ts';

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
      // Storylines' airings are read with the storylines (loadOnAir).
      sql: `SELECT story AS title, MIN(at) AS firstAired, MAX(at) AS lastAired, COUNT(*) AS times, SUM(in_depth) AS inDepth
            FROM airings WHERE story IS NOT NULL AND storyline_id IS NULL AND at >= ? GROUP BY story ORDER BY lastAired DESC LIMIT 80`,
      params: [new Date(now.getTime() - 7 * DAY_MS).toISOString()],
    },
    {
      // The notebooks: the latest three takes on each storyline or person from the past 90 days, and each presenter's
      // latest 15 on anything else.
      sql: `SELECT presenter_id AS presenter, topic, view, at, storyline_id AS storyline, entity_id AS entity, strength FROM (
              SELECT *,
                ROW_NUMBER() OVER (PARTITION BY presenter_id, COALESCE('s' || storyline_id, 'e' || entity_id) ORDER BY at DESC, id DESC) AS n,
                ROW_NUMBER() OVER (PARTITION BY presenter_id, storyline_id IS NULL AND entity_id IS NULL ORDER BY at DESC, id DESC) AS recent
              FROM takes
            ) WHERE CASE WHEN storyline_id IS NULL AND entity_id IS NULL THEN recent <= 15 ELSE n <= 3 AND at >= ? END
            ORDER BY at, id`,
      params: [new Date(now.getTime() - 90 * DAY_MS).toISOString()],
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
  for (const r of takes) {
    presenter(String(r.presenter)).opinions.push({
      topic: String(r.topic),
      view: String(r.view),
      at: String(r.at),
      ...(r.storyline != null ? { storyline: Number(r.storyline) } : {}),
      ...(r.entity != null ? { entity: String(r.entity) } : {}),
      ...(r.strength != null ? { strength: Number(r.strength) } : {}),
    });
  }
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

const INSERT_AIRINGS = `INSERT INTO airings (bulletin_id, story, storyline_id, in_depth, at)
  SELECT ?, value ->> 'title', value ->> 'storyline', value ->> 'inDepth', value ->> 'at' FROM json_each(?)`;

// A take's storyline and person are kept only if the store has them.
const INSERT_TAKES = `INSERT INTO takes (bulletin_id, presenter_id, topic, view, at, storyline_id, entity_id, strength)
  SELECT ?, value ->> 'presenter', value ->> 'topic', value ->> 'view', value ->> 'at',
    (SELECT id FROM storylines WHERE id = value ->> 'storyline'), (SELECT id FROM entities WHERE id = value ->> 'entity'),
    value ->> 'strength' FROM json_each(?)`;

// A later call on the same match replaces the earlier one.
const UPSERT_PREDICTIONS = `INSERT INTO predictions
    (bulletin_id, presenter_id, home, away, date, home_goals, away_goals, made_at, outcome, actual)
  SELECT ?, value ->> 'presenter', value ->> 'home', value ->> 'away', value ->> 'date', value ->> 'homeGoals',
    value ->> 'awayGoals', value ->> 'madeAt', value ->> 'outcome', value ->> 'actual' FROM json_each(?) WHERE true
  ON CONFLICT (presenter_id, home, away, date) DO UPDATE SET home_goals = excluded.home_goals,
    away_goals = excluded.away_goals, made_at = excluded.made_at, outcome = excluded.outcome, actual = excluded.actual,
    bulletin_id = excluded.bulletin_id`;

export interface BuildRecord {
  /** `kind`: a whole new bulletin, or a quiet slot that only reworded the links (script/quiet.ts). */
  bulletin: { id: string; phase: string; kind?: 'full' | 'partial'; runner: 'home' | 'github' };
  /** Everything collected this build. */
  items: Item[];
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

  statements.push({
    sql: 'INSERT INTO bulletins (id, generated_at, phase, runner, kind) VALUES (?, ?, ?, ?, ?)',
    params: [id, at, r.bulletin.phase, r.bulletin.runner, r.bulletin.kind ?? 'full'],
  });
  statements.push(...itemWrites(r.items, now), ...entityWrites(r.entities), ...tagWrites(r.items, r.tags, at));

  const { aired, takes, predictions } = r.remembered;
  statements.push(
    ...each(INSERT_AIRINGS, aired.map((a) => ({ title: a.title, storyline: a.storyline ?? null, inDepth: a.inDepth ? 1 : 0, at })), [id]),
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
 * Items: first_seen sticks; a newly collected transcript fills in. Article bodies are the ingest's alone (fetchWrites):
 * a build fetches no pages. Old text is pruned.
 */
function itemWrites(list: Item[], now: Date): Statement[] {
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
    transcript: text(it.transcript),
  }));
  return [
    ...each(
      `INSERT INTO items (id, source, kind, publisher, title, summary, url, published_at, first_seen, transcript)
        SELECT value ->> 'id', value ->> 'source', value ->> 'kind', value ->> 'publisher', value ->> 'title',
          value ->> 'summary', value ->> 'url', value ->> 'publishedAt', ?, value ->> 'transcript'
        FROM json_each(?) WHERE true
        ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
          publisher = COALESCE(excluded.publisher, items.publisher),
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

// ---- The fact ledger ----
// Every result we've seen (issue #32), read at the start of a build and topped up from its feed at the end, and
// what the fact checks changed, to learn from. Written in a batch of its own after saveBuild, so a store without
// these tables yet (migration 0005 not applied) still remembers the bulletin.

/** What a fact check fixed or dropped in a script. */
export interface CheckLog {
  checker: 'ai' | 'ledger';
  kind?: string;
  action: 'fixed' | 'dropped';
  segment?: string;
  was: string;
  now?: string;
  reason: string;
}

/** The results since `since`, newest first, each with its goals in order when we have them. */
export async function loadMatches(store: Store, since: Date): Promise<LedgerMatch[]> {
  const [rows] = await store.batch([
    {
      sql: `SELECT m.id, m.date, m.home, m.away, m.competition, m.home_score, m.away_score, m.source,
              (SELECT json_group_array(json_object('side', side, 'player', player, 'minute', COALESCE(minute, '')))
                FROM (SELECT * FROM goals g WHERE g.match_id = m.id ORDER BY n)) AS scorers,
              (SELECT COUNT(*) FROM goals g WHERE g.match_id = m.id) AS goals
            FROM matches m WHERE m.date >= ? ORDER BY m.date DESC`,
      params: [since.toISOString()],
    },
  ]);
  return rows.map((r) => {
    const goals = Number(r.goals);
    const total = Number(r.home_score) + Number(r.away_score);
    return {
      id: String(r.id),
      date: String(r.date),
      home: String(r.home),
      away: String(r.away),
      ...(r.competition ? { competition: String(r.competition) } : {}),
      homeScore: Number(r.home_score),
      awayScore: Number(r.away_score),
      ...(goals || total === 0 ? { scorers: JSON.parse(String(r.scorers)) as NonNullable<LedgerMatch['scorers']> } : {}),
      source: r.source as LedgerMatch['source'],
    };
  });
}

/**
 * Results upserted (a BBC row isn't replaced by TheSportsDB's), and the goals of each row that changed replaced by
 * the feed's list when it has one. Plus this bulletin's fact-check log.
 */
export function ledgerWrites(matches: LedgerMatch[], bulletinId: string | undefined, checks: CheckLog[], now: Date): Statement[] {
  const at = now.toISOString();
  const goals = matches.flatMap((m) => (m.scorers ?? []).map((g, n) => ({ match: m.id, n, side: g.side, player: g.player, minute: g.minute || null })));
  return [
    ...each(
      `INSERT INTO matches (id, date, home, away, competition, home_score, away_score, source, first_seen, updated_at)
        SELECT value ->> 'id', value ->> 'date', value ->> 'home', value ->> 'away', value ->> 'competition', value ->> 'homeScore',
          value ->> 'awayScore', value ->> 'source', ?, ? FROM json_each(?) WHERE true
        ON CONFLICT (id) DO UPDATE SET date = excluded.date, competition = COALESCE(excluded.competition, matches.competition),
          home_score = excluded.home_score, away_score = excluded.away_score, source = excluded.source, updated_at = excluded.updated_at
        WHERE excluded.source = 'bbc' OR matches.source = 'sportsdb'`,
      matches.map((m) => ({ id: m.id, date: m.date, home: m.home, away: m.away, competition: m.competition ?? null, homeScore: m.homeScore, awayScore: m.awayScore, source: m.source })),
      [at, at],
    ),
    ...each(
      `DELETE FROM goals WHERE match_id IN (SELECT id FROM matches WHERE updated_at = ?) AND match_id IN (SELECT value ->> 'match' FROM json_each(?))`,
      goals,
      [at],
    ),
    ...each(
      `INSERT INTO goals (match_id, n, side, player, minute)
        SELECT m.id, j.value ->> 'n', j.value ->> 'side', j.value ->> 'player', j.value ->> 'minute'
        FROM (SELECT id FROM matches WHERE updated_at = ?) AS m JOIN json_each(?) AS j ON j.value ->> 'match' = m.id`,
      goals,
      [at],
    ),
    ...(bulletinId
      ? each(
          `INSERT INTO fact_checks (bulletin_id, at, checker, kind, action, segment, was, now, reason)
            SELECT ?, ?, value ->> 'checker', value ->> 'kind', value ->> 'action', value ->> 'segment', value ->> 'was', value ->> 'now',
              value ->> 'reason' FROM json_each(?)`,
          checks.map((c) => ({ ...c, kind: c.kind ?? null, segment: c.segment ?? null, now: c.now ?? null })),
          [bulletinId, at],
        )
      : []),
  ];
}

export async function saveLedger(store: Store, matches: LedgerMatch[], bulletinId: string | undefined, checks: CheckLog[], now: Date): Promise<void> {
  const statements = ledgerWrites(matches, bulletinId, checks, now);
  if (statements.length) await store.batch(statements);
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
    ...itemWrites(items, now),
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

// ---- Claims, storylines and briefs ----
// The ingest's reading (storylines.ts, issue #25): each new article sifted once into claims, filed under storylines,
// and a brief kept on each storyline that changed. The ingest runs one at a time (its workflow's concurrency group),
// so new rows take ids counted on from the highest, and a batch can link storylines, claims and sources in one go.

/** Articles are sifted for claims while their text is kept; headline-only items for a week. */
const HEADLINE_DAYS = 7;
/** A video's transcript comes from the home PC's snapshot; one with none after this long counts as a headline. */
const TRANSCRIPT_WAIT_MS = 2 * DAY_MS;

/** A video is read once it has a summary (summarise.ts), is short enough not to need one, or has waited this long for it. */
const SUMMARY_WAIT_MS = 12 * 3_600_000;
/** A transcript shorter than this is used whole, never summarised. */
export const SUMMARISE_OVER = 2_500;

const ARTICLE_WHERE = `sifted_at IS NULL AND first_seen >= ? AND (
    (kind IN ('press', 'official') AND fetch_status = 'ok' AND body IS NOT NULL)
    OR (kind = 'video' AND transcript IS NOT NULL AND (summary_json IS NOT NULL OR length(transcript) < ${SUMMARISE_OVER} OR first_seen < ?)))`;
const HEADLINE_WHERE = `i.sifted_at IS NULL AND i.first_seen >= ? AND (i.kind = 'aggregator'
    OR (i.kind IN ('press', 'official') AND i.fetch_status = 'gave_up') OR (i.kind = 'video' AND i.transcript IS NULL AND i.first_seen < ?))`;

/** A row's text for a prompt: a summarised video's summary (its whole show), else the stored text. */
function itemText(r: Row, use: 'claims' | 'full'): string {
  const summary = r.kind === 'video' && r.summary_json ? (JSON.parse(String(r.summary_json)) as VideoSummary) : undefined;
  return summary ? renderSummary(summary, use) : String(r.text);
}

const neuronsKey = (now: Date) => `workers_ai:${now.toISOString().slice(0, 10)}`;

/** Workers AI neurons used so far today (UTC), by every run. */
export async function neuronsToday(store: Store, now: Date): Promise<number> {
  const [[row]] = await store.batch([{ sql: 'SELECT value FROM state WHERE key = ?', params: [neuronsKey(now)] }]);
  return row ? Number(JSON.parse(String(row.value))) : 0;
}

/** Storylines with their claims, each claim with the items it came from (oldest first). */
function toStorylines(storylines: Row[], claims: Row[]): Storyline[] {
  const byId = new Map<number, Storyline>();
  for (const r of storylines) {
    byId.set(Number(r.id), {
      id: Number(r.id),
      kind: r.kind as StorylineKind,
      ...(r.entity_id ? { entity: String(r.entity_id) } : {}),
      ...(r.category ? { category: String(r.category) } : {}),
      title: String(r.title),
      ...(r.fixture ? { fixture: String(r.fixture) } : {}),
      ...(r.kick_off ? { kickOff: String(r.kick_off) } : {}),
      status: r.status as 'open' | 'closed',
      openedAt: String(r.opened_at),
      updatedAt: String(r.updated_at),
      ...(r.brief ? { brief: JSON.parse(String(r.brief)) as Brief } : {}),
      ...(r.brief_at ? { briefAt: String(r.brief_at) } : {}),
      claims: [],
    });
  }
  for (const r of claims) {
    byId.get(Number(r.storyline_id))?.claims.push({
      id: Number(r.id),
      text: String(r.text),
      status: r.status as ClaimStatus,
      firstSeen: String(r.first_seen),
      ...(r.replaced_by != null ? { replacedBy: Number(r.replaced_by) } : {}),
      ...(r.disputes != null ? { disputes: Number(r.disputes) } : {}),
      sources: (JSON.parse(String(r.sources ?? '[]')) as ClaimSource[]).filter((s) => s.item),
    });
  }
  return [...byId.values()];
}

const STORYLINE_COLUMNS = 'id, kind, entity_id, category, title, fixture, kick_off, status, opened_at, updated_at, brief, brief_at';
const CLAIMS_OF = (where: string) => `SELECT c.id, c.storyline_id, c.text, c.status, c.first_seen, c.replaced_by, c.disputes,
    json_group_array(json_object('item', cs.item_id, 'outlet', COALESCE(i.publisher, i.source), 'corroboration', cs.corroboration, 'at', cs.at)) AS sources
  FROM claims c LEFT JOIN claim_sources cs ON cs.claim_id = c.id LEFT JOIN items i ON i.id = cs.item_id
  WHERE c.storyline_id IN (SELECT id FROM storylines WHERE ${where}) GROUP BY c.id ORDER BY c.first_seen, c.id`;

/**
 * Everything the reading needs at the start of a run: the open storylines, the ids new rows count on from, the
 * Workers AI neurons used today, and what's waiting to be read (articles with text, oldest first, up to
 * `limits.articles`; headline-only items up to `limits.headlines`, each marked whether its tags say it's about anyone
 * or anything in particular).
 */
export async function loadStoryDesk(store: Store, now: Date, limits: { articles: number; headlines: number }): Promise<StoryDesk> {
  const textSince = new Date(now.getTime() - KEEP_TEXT_DAYS * DAY_MS).toISOString();
  const headlineSince = new Date(now.getTime() - HEADLINE_DAYS * DAY_MS).toISOString();
  const transcriptBy = new Date(now.getTime() - TRANSCRIPT_WAIT_MS).toISOString();
  const summaryBy = new Date(now.getTime() - SUMMARY_WAIT_MS).toISOString();
  const [storylines, claims, ids, neurons, waiting, articles, headlines] = await store.batch([
    { sql: `SELECT ${STORYLINE_COLUMNS} FROM storylines WHERE status = 'open' ORDER BY id` },
    { sql: CLAIMS_OF(`status = 'open'`) },
    { sql: 'SELECT (SELECT COALESCE(MAX(id), 0) FROM storylines) AS storyline, (SELECT COALESCE(MAX(id), 0) FROM claims) AS claim' },
    { sql: 'SELECT value FROM state WHERE key = ?', params: [neuronsKey(now)] },
    {
      sql: `SELECT (SELECT COUNT(*) FROM items WHERE ${ARTICLE_WHERE}) AS articles,
              (SELECT MIN(first_seen) FROM (SELECT first_seen FROM items WHERE ${ARTICLE_WHERE}
                UNION ALL SELECT i.first_seen FROM items i WHERE ${HEADLINE_WHERE})) AS oldest`,
      params: [textSince, summaryBy, textSince, summaryBy, headlineSince, transcriptBy],
    },
    {
      sql: `SELECT id, source, publisher, kind, title, published_at, first_seen, COALESCE(body, transcript) AS text, summary_json FROM items
            WHERE ${ARTICLE_WHERE} ORDER BY COALESCE(published_at, first_seen), id LIMIT ?`,
      params: [textSince, summaryBy, limits.articles],
    },
    {
      sql: `SELECT i.id, i.source, i.publisher, i.kind, i.title, i.published_at, i.first_seen,
              (COALESCE(t.category, 'news') != 'news' OR EXISTS (SELECT 1 FROM item_entities ie JOIN entities e ON e.id = ie.entity_id
                WHERE ie.item_id = i.id AND e.type IN ('player', 'staff'))) AS tagged
            FROM items i LEFT JOIN item_tags t ON t.item_id = i.id
            WHERE ${HEADLINE_WHERE} ORDER BY COALESCE(i.published_at, i.first_seen), i.id LIMIT ?`,
      params: [headlineSince, transcriptBy, limits.headlines],
    },
  ]);
  const toItem = (r: Row): SiftItem => ({
    id: String(r.id),
    source: String(r.source),
    ...(r.publisher ? { publisher: String(r.publisher) } : {}),
    kind: r.kind as SourceKind,
    title: String(r.title),
    publishedAt: String(r.published_at || r.first_seen),
    ...(r.text != null ? { text: itemText(r, 'claims') } : {}),
    ...(r.tagged != null ? { tagged: Number(r.tagged) === 1 } : {}),
  });
  return {
    open: toStorylines(storylines, claims),
    nextIds: { storyline: Number(ids[0].storyline) + 1, claim: Number(ids[0].claim) + 1 },
    neuronsToday: neurons[0] ? Number(JSON.parse(String(neurons[0].value))) : 0,
    waiting: { articles: Number(waiting[0].articles), ...(waiting[0].oldest ? { oldest: String(waiting[0].oldest) } : {}) },
    articles: articles.map(toItem),
    headlines: headlines.map(toItem),
  };
}

/** Open storylines again (after a batch of claims went in), and the ids new rows count on from. */
export async function loadOpenStorylines(store: Store): Promise<{ open: Storyline[]; nextIds: StoryDesk['nextIds'] }> {
  const [storylines, claims, ids] = await store.batch([
    { sql: `SELECT ${STORYLINE_COLUMNS} FROM storylines WHERE status = 'open' ORDER BY id` },
    { sql: CLAIMS_OF(`status = 'open'`) },
    { sql: 'SELECT (SELECT COALESCE(MAX(id), 0) FROM storylines) AS storyline, (SELECT COALESCE(MAX(id), 0) FROM claims) AS claim' },
  ]);
  return { open: toStorylines(storylines, claims), nextIds: { storyline: Number(ids[0].storyline) + 1, claim: Number(ids[0].claim) + 1 } };
}

/**
 * Storylines whose brief is due: none yet, or a claim read from an article (not just corroborated by a headline)
 * since the last one. Open ones, and any closed in the last day (resolved by the claim that closed them).
 */
export async function storylinesDueBriefs(store: Store, now: Date, limit: number): Promise<Storyline[]> {
  const due = `(status = 'open' OR closed_at >= '${new Date(now.getTime() - DAY_MS).toISOString()}') AND (brief_at IS NULL OR EXISTS (
      SELECT 1 FROM claims c JOIN claim_sources cs ON cs.claim_id = c.id
      WHERE c.storyline_id = storylines.id AND cs.corroboration = 0 AND cs.at > storylines.brief_at))`;
  const [storylines, claims] = await store.batch([
    { sql: `SELECT ${STORYLINE_COLUMNS} FROM storylines WHERE ${due} ORDER BY updated_at DESC LIMIT ?`, params: [limit] },
    { sql: CLAIMS_OF(`id IN (SELECT id FROM storylines WHERE ${due} ORDER BY updated_at DESC LIMIT ?)`), params: [limit] },
  ]);
  return toStorylines(storylines, claims);
}

/** Of each stored article a bulletin reads, this much (the writer sees at most 2,500 characters of one). */
const ON_AIR_TEXT = 4_000;
/** A storyline resolved this recently can still go on air ("Wilson signs"). */
const RESOLVED_DAYS = 2;

/**
 * What a bulletin is built from (issue #31): the open storylines (and any resolved in the last two days) with their
 * claims and briefs, the items the claims came from (with up to 4,000 characters of their stored text), each
 * storyline's airings, and which of this build's collected items the ingest has already read (`collected`, by id).
 */
export async function loadOnAir(store: Store, collected: string[], now: Date): Promise<OnAirDesk> {
  const where = `status = 'open' OR (close_reason = 'resolved' AND closed_at >= '${new Date(now.getTime() - RESOLVED_DAYS * DAY_MS).toISOString()}')`;
  const lines = `SELECT id FROM storylines WHERE ${where}`;
  const [storylines, claims, items, airings, sifted] = await store.batch([
    { sql: `SELECT ${STORYLINE_COLUMNS} FROM storylines WHERE ${where} ORDER BY id` },
    { sql: CLAIMS_OF(where) },
    {
      sql: `SELECT id, source, kind, publisher, title, summary, url, published_at, first_seen, substr(COALESCE(body, transcript), 1, ?) AS text, summary_json
            FROM items WHERE id IN (SELECT cs.item_id FROM claim_sources cs JOIN claims c ON c.id = cs.claim_id WHERE c.storyline_id IN (${lines}))`,
      params: [ON_AIR_TEXT],
    },
    {
      sql: `SELECT storyline_id AS storyline, MAX(story) AS title, MIN(at) AS firstAired, MAX(at) AS lastAired, COUNT(*) AS times,
              SUM(in_depth) AS inDepth, MAX(CASE WHEN in_depth = 1 THEN at END) AS lastInDepth
            FROM airings WHERE storyline_id IN (${lines}) GROUP BY storyline_id`,
    },
    { sql: 'SELECT id FROM items WHERE sifted_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(collected)] },
  ]);
  return {
    storylines: toStorylines(storylines, claims),
    items: new Map(
      items.map((r) => [
        String(r.id),
        {
          id: String(r.id),
          sourceId: String(r.source),
          sourceName: String(r.publisher ?? r.source),
          kind: r.kind as SourceKind,
          ...(r.publisher ? { publisher: String(r.publisher) } : {}),
          title: String(r.title),
          summary: String(r.summary ?? ''),
          url: String(r.url ?? ''),
          publishedAt: String(r.published_at || r.first_seen),
          ...(r.text ? { text: itemText(r, 'full') } : {}),
        },
      ]),
    ),
    airings: new Map(
      airings.map((r) => [
        Number(r.storyline),
        {
          title: String(r.title ?? ''),
          firstAired: String(r.firstAired),
          lastAired: String(r.lastAired),
          times: Number(r.times),
          inDepth: Number(r.inDepth),
          ...(r.lastInDepth ? { lastInDepth: String(r.lastInDepth) } : {}),
        },
      ]),
    ),
    sifted: new Set(sifted.map((r) => String(r.id))),
  };
}

/** Adds this run's Workers AI use to today's count. */
function neuronWrites(neurons: number, now: Date): Statement[] {
  if (neurons <= 0) return [];
  return [
    {
      sql: `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET value = CAST(state.value AS REAL) + CAST(excluded.value AS REAL), updated_at = excluded.updated_at`,
      params: [neuronsKey(now), String(Math.round(neurons)), now.toISOString()],
    },
  ];
}

/** What one batch of reading found: new storylines and claims, their sources, and what it did to older claims. */
export function siftWrites(plan: SiftPlan, neurons: number, now: Date): Statement[] {
  const at = now.toISOString();
  return [
    ...each(
      `INSERT INTO storylines (id, kind, entity_id, category, title, fixture, kick_off, status, opened_at, updated_at)
        SELECT value ->> 'id', value ->> 'kind', value ->> 'entity', value ->> 'category', value ->> 'title', value ->> 'fixture',
          value ->> 'kickOff', 'open', value ->> 'openedAt', value ->> 'openedAt' FROM json_each(?)`,
      plan.storylines.map((s) => ({ ...s, entity: s.entity ?? null, category: s.category ?? null, fixture: s.fixture ?? null, kickOff: s.kickOff ?? null })),
    ),
    ...each(
      `INSERT INTO claims (id, storyline_id, text, status, first_seen, disputes)
        SELECT value ->> 'id', value ->> 'storylineId', value ->> 'text', value ->> 'status', value ->> 'firstSeen', value ->> 'disputes' FROM json_each(?)`,
      plan.claims.map((c) => ({ ...c, disputes: c.disputes ?? null })),
    ),
    ...each(
      `UPDATE claims SET status = j.value ->> 'status', replaced_by = COALESCE(j.value ->> 'replacedBy', claims.replaced_by)
        FROM json_each(?) AS j WHERE claims.id = j.value ->> 'id'`,
      plan.statuses.map((s) => ({ ...s, replacedBy: s.replacedBy ?? null })),
    ),
    ...each(
      `INSERT OR IGNORE INTO claim_sources (claim_id, item_id, corroboration, at)
        SELECT value ->> 'claimId', value ->> 'itemId', value ->> 'corroboration', ? FROM json_each(?)`,
      plan.sources.map((s) => ({ ...s, corroboration: s.corroboration ? 1 : 0 })),
      [at],
    ),
    ...each(
      `UPDATE storylines SET updated_at = MAX(storylines.updated_at, j.value ->> 'at') FROM json_each(?) AS j WHERE storylines.id = j.value ->> 'id'`,
      plan.touched,
    ),
    ...closeWrites(plan.resolved.map((id) => ({ id, reason: 'resolved' as const })), now),
    ...each(`UPDATE items SET sifted_at = ? WHERE id IN (SELECT value ->> 'id' FROM json_each(?))`, plan.sifted.map((id) => ({ id })), [at]),
    ...neuronWrites(neurons, now),
  ];
}

export function closeWrites(closing: { id: number; reason: CloseReason }[], now: Date): Statement[] {
  return each(
    `UPDATE storylines SET status = 'closed', closed_at = ?, close_reason = j.value ->> 'reason'
      FROM json_each(?) AS j WHERE storylines.id = j.value ->> 'id' AND storylines.status = 'open'`,
    closing,
    [now.toISOString()],
  );
}

export async function saveSift(store: Store, plan: SiftPlan, neurons: number, now: Date): Promise<void> {
  await store.batch(siftWrites(plan, neurons, now));
}

export async function closeStorylines(store: Store, closing: { id: number; reason: CloseReason }[], now: Date): Promise<void> {
  if (closing.length) await store.batch(closeWrites(closing, now));
}

/** New briefs (and titles), and the Workers AI they took. */
export async function saveBriefs(store: Store, briefs: { id: number; title: string; brief: Brief }[], neurons: number, now: Date): Promise<void> {
  const statements = [
    ...each(
      `UPDATE storylines SET title = j.value ->> 'title', brief = j.value ->> 'brief', brief_at = ? FROM json_each(?) AS j WHERE storylines.id = j.value ->> 'id'`,
      briefs.map((b) => ({ id: b.id, title: b.title, brief: JSON.stringify(b.brief) })),
      [now.toISOString()],
    ),
    ...neuronWrites(neurons, now),
  ];
  if (statements.length) await store.batch(statements);
}

/** Workers AI used without anything to save (a run that failed part-way) still counts against the day. */
export async function saveNeurons(store: Store, neurons: number, now: Date): Promise<void> {
  const statements = neuronWrites(neurons, now);
  if (statements.length) await store.batch(statements);
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

// ---- Video summaries (issue #49) ----
// A long show's transcript is read once by the ingest (summarise.ts) and the result kept with the item.

export interface VideoToSummarise {
  id: string;
  source: string;
  publisher?: string;
  title: string;
  transcript: string;
}

/** Videos with a long transcript and no summary yet, newest first. */
export async function loadVideosToSummarise(store: Store, now: Date, limit: number): Promise<VideoToSummarise[]> {
  const [rows] = await store.batch([
    {
      sql: `SELECT id, source, publisher, title, transcript FROM items
            WHERE kind = 'video' AND summary_json IS NULL AND transcript IS NOT NULL AND length(transcript) >= ? AND first_seen >= ?
            ORDER BY COALESCE(published_at, first_seen) DESC, id LIMIT ?`,
      params: [SUMMARISE_OVER, new Date(now.getTime() - KEEP_TEXT_DAYS * DAY_MS).toISOString(), limit],
    },
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source),
    ...(r.publisher ? { publisher: String(r.publisher) } : {}),
    title: String(r.title),
    transcript: String(r.transcript),
  }));
}

export function summaryWrites(summaries: { id: string; summary: VideoSummary }[], now: Date): Statement[] {
  return each(
    `UPDATE items SET summary_json = j.value ->> 'summary', summarised_at = ? FROM json_each(?) AS j WHERE items.id = j.value ->> 'id'`,
    summaries.map((s) => ({ id: s.id, summary: JSON.stringify(s.summary) })),
    [now.toISOString()],
  );
}

export async function saveSummaries(store: Store, summaries: { id: string; summary: VideoSummary }[], now: Date): Promise<void> {
  if (summaries.length) await store.batch(summaryWrites(summaries, now));
}

/** The summaries the store holds for these items, by item id. */
export async function loadVideoSummaries(store: Store, ids: string[]): Promise<Map<string, VideoSummary>> {
  if (!ids.length) return new Map();
  const [rows] = await store.batch([
    { sql: 'SELECT id, summary_json FROM items WHERE summary_json IS NOT NULL AND id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(ids)] },
  ]);
  return new Map(rows.map((r) => [String(r.id), JSON.parse(String(r.summary_json)) as VideoSummary]));
}
