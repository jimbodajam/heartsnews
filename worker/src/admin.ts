// The admin view (issue #39): /admin (HTML, for a phone) and /admin.json (the same data, for Claude), read-only except the
// squad list (/admin?roster=1, posting to /admin/roster), behind
// ADMIN_TOKEN, a Worker secret. Two questions: is the channel healthy right now, and why did that bulletin say that?
// `?bulletin=<id>` on either opens one bulletin's trace (written by pipeline/src/build.ts, migration 0008).
// Sign in once with /admin?token=…: the Worker sets a cookie and redirects to the clean address. /admin.json also
// takes `Authorization: Bearer …`.

import { EVERY_MS } from './clock.ts';
import { sameToken, type D1Database } from './store.ts';

export interface AdminEnv {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
}

type Row = Record<string, unknown>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Workers AI's free allowance a day (neurons), UTC days. */
export const WORKERS_AI_BUDGET = 10_000;
/** Gemini Flash's free requests a day, which reset at midnight Pacific time. The lighter model's limit is higher and not tracked. */
export const FLASH_DAILY = 20;
/** A claimed job past this has lost its runner (the clock gives up on it at the same point); a queued one is stuck if it waited this long. */
const CLAIM_MS = { programme: 40 * 60_000, breaking: 10 * 60_000 };
const QUEUED_STUCK_MS = 15 * 60_000;
/** The clock's read of live.json older than this says nothing about now (cadence.ts). */
const STALE_MS = 10 * 60_000;
const HOME_FRESH_MS = 90_000;

const iso = (t: number) => new Date(t).toISOString();
const num = (v: unknown) => Number(v ?? 0);
const json = (v: unknown): unknown => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
};

/** The calendar day of a time in a zone, e.g. "2026-10-28". */
const dayIn = (zone: string, t: number | string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(t));

interface Call {
  label: string;
  model: string;
  ok: boolean;
  ms: number;
  error?: string;
}

async function query(db: D1Database, statements: { sql: string; params?: unknown[] }[]): Promise<Row[][]> {
  const results = await db.batch(statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? []))));
  return results.map((r) => (r.results ?? []) as Row[]);
}

/** Everything the page shows, as plain data. */
export async function adminData(db: D1Database, now = Date.now(), bulletinId?: string) {
  const at = iso(now);
  const since = (ms: number) => iso(now - ms);
  const [state, jobCounts, jobsOpen, jobErrors, bulletins, traces, sources, fetchFailed, untagged, waiting, storylines, claims, matches, upcoming, predictions, takes] = await query(db, [
    { sql: `SELECT key, value, updated_at FROM state WHERE key IN ('cadence', 'home_seen', 'ingest_slot', 'workers_ai_24h') OR key LIKE 'workers_ai:%'` },
    { sql: `SELECT status, kind, COUNT(*) AS n FROM jobs WHERE test = 0 AND queued_at >= ? GROUP BY status, kind`, params: [since(DAY)] },
    { sql: `SELECT id, kind, status, runner, queued_at, claimed_at, attempts, dispatches, error FROM jobs WHERE test = 0 AND status IN ('queued', 'claimed') ORDER BY queued_at` },
    { sql: `SELECT id, kind, status, runner, queued_at, finished_at, error FROM jobs WHERE test = 0 AND error IS NOT NULL AND queued_at >= ? ORDER BY queued_at DESC LIMIT 15`, params: [since(DAY)] },
    {
      sql: `SELECT b.id, b.generated_at, b.phase, b.runner, b.kind, t.writer, t.bulletin_id IS NOT NULL AS traced, json_extract(t.meta, '$.why') AS why
            FROM bulletins b LEFT JOIN bulletin_traces t ON t.bulletin_id = b.id ORDER BY b.generated_at DESC LIMIT 30`,
    },
    { sql: `SELECT bulletin_id, at, calls, json_extract(meta, '$.failed') AS failed FROM bulletin_traces WHERE at >= ? ORDER BY at DESC`, params: [since(2 * DAY)] },
    {
      sql: `SELECT source, kind, COUNT(*) AS total, SUM(first_seen >= ?) AS last24h, MAX(first_seen) AS newest
            FROM items WHERE first_seen >= ? GROUP BY source, kind ORDER BY source`,
      params: [since(DAY), since(14 * DAY)],
    },
    { sql: `SELECT source, COUNT(*) AS n, MAX(fetch_error) AS error FROM items WHERE fetch_status IN ('failed', 'gave_up') AND first_seen >= ? GROUP BY source`, params: [since(DAY)] },
    { sql: `SELECT COUNT(*) AS n FROM items WHERE first_seen >= ? AND id NOT IN (SELECT item_id FROM item_tags)`, params: [since(7 * DAY)] },
    {
      sql: `SELECT
              SUM(kind IN ('press', 'official') AND fetch_status IS NULL) AS to_fetch,
              SUM(sifted_at IS NULL AND ((kind IN ('press', 'official') AND fetch_status = 'ok' AND body IS NOT NULL) OR (kind = 'video' AND transcript IS NOT NULL))) AS to_read,
              SUM(kind = 'video' AND transcript IS NOT NULL AND summary_json IS NULL AND length(transcript) >= 2500) AS to_summarise
            FROM items WHERE first_seen >= ?`,
      params: [since(7 * DAY)],
    },
    { sql: `SELECT id, kind, title, fixture, kick_off, status, opened_at, updated_at, brief, brief_at FROM storylines WHERE status = 'open' ORDER BY updated_at DESC LIMIT 40` },
    {
      sql: `SELECT c.id, c.storyline_id, c.text, c.status, c.first_seen, c.replaced_by, c.disputes,
              json_group_array(json_object('item', cs.item_id, 'title', i.title, 'outlet', COALESCE(i.publisher, i.source), 'url', i.url, 'corroboration', cs.corroboration)) AS sources
            FROM claims c LEFT JOIN claim_sources cs ON cs.claim_id = c.id LEFT JOIN items i ON i.id = cs.item_id
            WHERE c.storyline_id IN (SELECT id FROM (SELECT id FROM storylines WHERE status = 'open' ORDER BY updated_at DESC LIMIT 40))
            GROUP BY c.id ORDER BY c.first_seen DESC, c.id DESC`,
    },
    { sql: `SELECT id, date, home, away, competition, home_score, away_score, source FROM matches ORDER BY date DESC LIMIT 8` },
    { sql: `SELECT id, title, fixture, kick_off, updated_at FROM storylines WHERE kind = 'match' AND kick_off >= ? ORDER BY kick_off LIMIT 5`, params: [at] },
    { sql: `SELECT presenter_id, home, away, date, home_goals, away_goals, made_at, outcome, actual FROM predictions ORDER BY made_at DESC LIMIT 12` },
    { sql: `SELECT presenter_id, topic, view, strength, at, bulletin_id FROM takes ORDER BY at DESC, id DESC LIMIT 20` },
  ]);

  // ---- Schedule and health ----
  const states = new Map(state.map((r) => [String(r.key), r]));
  const stateValue = (key: string) => json(states.get(key)?.value);
  const cadence = (stateValue('cadence') ?? {}) as { status?: string; seenAt?: number; rebuild?: string; slot?: number; kickOff?: string };
  const homeSeen = Date.parse(String(stateValue('home_seen') ?? ''));
  const matchOn = now - (cadence.seenAt ?? -Infinity) < STALE_MS && (cadence.status === 'live' || cadence.status === 'ht');
  const slot = Math.floor(now / EVERY_MS) * EVERY_MS;
  const lastBulletin = bulletins[0];
  const next = cadence.rebuild
    ? { at: at, why: `a programme is due now, straight after ${cadence.rebuild === 'ht' ? 'half-time' : 'full time'}` }
    : matchOn
      ? { why: 'no regular programmes while the match is on: the break-ins carry it, and a programme follows half-time and full time' }
      : cadence.slot === slot
        ? { at: iso(slot + EVERY_MS), why: 'the next slot on the clock' }
        : { at, why: 'a programme is due now (this slot has none yet)' };

  const jobs = {
    last24h: Object.fromEntries(jobCounts.map((r) => [`${r.kind}:${r.status}`, num(r.n)])),
    open: jobsOpen.map((r) => {
      const waited = now - Date.parse(String(r.claimed_at ?? r.queued_at));
      const stuck = r.status === 'claimed' ? waited > CLAIM_MS[r.kind as 'programme' | 'breaking'] : waited > QUEUED_STUCK_MS;
      return { id: r.id, kind: r.kind, status: r.status, runner: r.runner ?? null, queuedAt: r.queued_at, attempts: num(r.attempts), dispatches: num(r.dispatches), stuck };
    }),
  };

  // ---- AI usage ----
  const calls = traces.flatMap((r) => ((json(r.calls) as Call[] | undefined) ?? []).map((c) => ({ ...c, at: String(r.at) })));
  const pacificToday = dayIn('America/Los_Angeles', now);
  const gemini: Record<string, { requests: number; failed: number }> = {};
  for (const c of calls.filter((c) => dayIn('America/Los_Angeles', c.at) === pacificToday)) {
    const m = (gemini[c.model] ??= { requests: 0, failed: 0 });
    m.requests++;
    if (!c.ok) m.failed++;
  }
  // Cloudflare's own rolling-24h count, saved by each ingest run; failing that, our own since midnight UTC.
  const rolling = states.get('workers_ai_24h');
  const neurons = rolling ? num(json(rolling.value)) : num(json(states.get(`workers_ai:${iso(now).slice(0, 10)}`)?.value));
  const neuronsBasis = rolling ? { basis: 'Cloudflare, last 24 hours', asOf: String(rolling.updated_at) } : { basis: 'our own count since midnight UTC (no Cloudflare figure saved yet)', asOf: undefined };

  // ---- Errors ----
  const errors = [
    ...jobErrors.map((r) => ({ at: String(r.finished_at ?? r.queued_at), source: `job ${r.kind}`, message: `${r.id}: ${r.error}` })),
    ...calls.filter((c) => !c.ok).map((c) => ({ at: c.at, source: `model ${c.model}`, message: `${c.label || 'request'}: ${c.error ?? 'failed'}` })),
    ...traces.flatMap((r) => ((json(r.failed) as { id: string; error: string }[] | undefined) ?? []).map((f) => ({ at: String(r.at), source: 'script piece', message: `${f.id}: ${f.error}` }))),
    ...fetchFailed.map((r) => ({ at, source: `fetch ${r.source}`, message: `${num(r.n)} articles in 24h: ${r.error ?? 'failed'}` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25);

  // ---- Inputs ----
  const failedBy = new Map(fetchFailed.map((r) => [String(r.source), num(r.n)]));
  const inputs = {
    sources: sources.map((r) => {
      const last24h = num(r.last24h);
      return {
        source: r.source,
        kind: r.kind,
        last24h,
        last14d: num(r.total),
        newest: r.newest,
        failedFetches: failedBy.get(String(r.source)) ?? 0,
        // It was publishing within the fortnight and nothing has come in for a day.
        quiet: last24h === 0,
      };
    }),
    waiting: {
      untagged: num(untagged[0]?.n),
      articlesToFetch: num(waiting[0]?.to_fetch),
      toRead: num(waiting[0]?.to_read),
      videosToSummarise: num(waiting[0]?.to_summarise),
    },
  };

  // ---- Story state ----
  const claimsBy = new Map<number, unknown[]>();
  for (const c of claims) {
    const list = claimsBy.get(num(c.storyline_id)) ?? [];
    list.push({
      id: num(c.id),
      text: c.text,
      status: c.status,
      firstSeen: c.first_seen,
      replacedBy: c.replaced_by ?? undefined,
      disputes: c.disputes ?? undefined,
      sources: ((json(c.sources) as { item: string | null }[] | undefined) ?? []).filter((s) => s.item),
    });
    claimsBy.set(num(c.storyline_id), list);
  }
  const stories = {
    storylines: storylines.map((s) => ({
      id: num(s.id),
      kind: s.kind,
      title: s.title,
      fixture: s.fixture ?? undefined,
      kickOff: s.kick_off ?? undefined,
      openedAt: s.opened_at,
      updatedAt: s.updated_at,
      brief: json(s.brief) ?? undefined,
      claims: claimsBy.get(num(s.id)) ?? [],
    })),
    matches: matches.map((m) => ({ date: m.date, home: m.home, away: m.away, competition: m.competition ?? undefined, score: `${m.home_score}-${m.away_score}`, source: m.source })),
    upcoming: upcoming.map((u) => ({ title: u.title, fixture: u.fixture, kickOff: u.kick_off })),
    predictions: predictions.map((p) => ({ presenter: p.presenter_id, match: `${p.home} v ${p.away}`, date: p.date, call: `${p.home_goals}-${p.away_goals}`, madeAt: p.made_at, outcome: p.outcome ?? undefined, actual: p.actual ?? undefined })),
    takes: takes.map((t) => ({ presenter: t.presenter_id, topic: t.topic, view: t.view, strength: t.strength ?? undefined, at: t.at, bulletin: t.bulletin_id ?? undefined })),
  };

  return {
    generatedAt: at,
    schedule: {
      phase: lastBulletin?.phase ?? null,
      cadence: { matchOn, status: cadence.status ?? null, kickOff: cadence.kickOff ?? null, rebuild: cadence.rebuild ?? null },
      next,
      homePc: { on: now - homeSeen < HOME_FRESH_MS, lastSeen: Number.isNaN(homeSeen) ? null : iso(homeSeen) },
      lastIngestSlot: stateValue('ingest_slot') ?? null,
      lastBulletin: lastBulletin
        ? { id: lastBulletin.id, at: lastBulletin.generated_at, runner: lastBulletin.runner, kind: lastBulletin.kind, ageMinutes: Math.round((now - Date.parse(String(lastBulletin.generated_at))) / 60_000) }
        : null,
    },
    jobs,
    aiUsage: {
      gemini: { day: `${pacificToday} (Pacific)`, flashDailyLimit: FLASH_DAILY, byModel: gemini, note: 'Counted from the bulletin traces: programmes only, not the ingest or breaking news.' },
      workersAi: { neurons, budget: WORKERS_AI_BUDGET, ...neuronsBasis },
    },
    errors,
    inputs,
    stories,
    bulletins: bulletins.map((b) => ({ id: b.id, at: b.generated_at, phase: b.phase, runner: b.runner, kind: b.kind, writer: b.writer ?? undefined, why: b.why ?? undefined, traced: num(b.traced) === 1 })),
    ...(bulletinId ? { bulletin: await bulletinTrace(db, bulletinId) } : {}),
  };
}

/** One bulletin: what went in, how each piece was written, what the checks cut, and the script. */
export async function bulletinTrace(db: D1Database, id: string) {
  const [bulletin, trace, airings, checks] = await query(db, [
    { sql: `SELECT id, generated_at, phase, runner, kind FROM bulletins WHERE id = ?`, params: [id] },
    { sql: `SELECT writer, meta, calls, prompts, script FROM bulletin_traces WHERE bulletin_id = ?`, params: [id] },
    {
      sql: `SELECT a.story, a.storyline_id, s.title AS storyline, a.in_depth FROM airings a LEFT JOIN storylines s ON s.id = a.storyline_id WHERE a.bulletin_id = ? ORDER BY a.id`,
      params: [id],
    },
    { sql: `SELECT checker, kind, action, segment, was, now, reason FROM fact_checks WHERE bulletin_id = ? ORDER BY id`, params: [id] },
  ]);
  if (!bulletin[0]) return { error: `No bulletin ${id}` };
  const t = trace[0];
  const calls = (json(t?.calls) as Call[] | undefined) ?? [];
  // Group the requests by what they were for: a fallback shows as a second call under one label.
  const pieces: Record<string, Call[]> = {};
  for (const c of calls) (pieces[c.label || 'other'] ??= []).push(c);
  return {
    bulletin: { id: bulletin[0].id, at: bulletin[0].generated_at, phase: bulletin[0].phase, runner: bulletin[0].runner, kind: bulletin[0].kind },
    traced: Boolean(t),
    writer: t?.writer ?? undefined,
    meta: json(t?.meta) ?? undefined,
    airings: airings.map((a) => ({ story: a.story ?? undefined, storyline: a.storyline ?? undefined, inDepth: num(a.in_depth) === 1 })),
    pieces: Object.entries(pieces).map(([label, list]) => ({ label, calls: list, fellBack: new Set(list.map((c) => c.model)).size > 1 })),
    prompts: (json(t?.prompts) as Record<string, string> | undefined) ?? undefined,
    cuts: checks.map((c) => ({ checker: c.checker, kind: c.kind ?? undefined, action: c.action, segment: c.segment ?? undefined, was: c.was, now: c.now ?? undefined, reason: c.reason })),
    script: json(t?.script) ?? undefined,
  };
}

/** Everything we've pulled from one source, newest first. */
export async function sourceItems(db: D1Database, source: string) {
  const [items] = await query(db, [
    {
      sql: `SELECT i.id, i.kind, i.title, i.published_at, i.first_seen, i.fetch_status, i.sifted_at IS NOT NULL AS read, i.summary_json IS NOT NULL AS summarised,
              length(COALESCE(i.body, i.transcript)) AS chars, t.category,
              (SELECT COUNT(*) FROM claim_sources cs WHERE cs.item_id = i.id) AS claims
            FROM items i LEFT JOIN item_tags t ON t.item_id = i.id WHERE i.source = ? ORDER BY i.first_seen DESC, i.id LIMIT 200`,
      params: [source],
    },
  ]);
  return {
    source,
    items: items.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      publishedAt: r.published_at ?? undefined,
      firstSeen: r.first_seen,
      fetch: r.fetch_status ?? undefined,
      chars: r.chars == null ? undefined : num(r.chars),
      category: r.category ?? undefined,
      read: num(r.read) === 1,
      summarised: num(r.summarised) === 1,
      claims: num(r.claims),
    })),
  };
}

/** One item: the text we scraped, the summary made from it, and the claims built on it. */
export async function itemDetail(db: D1Database, id: string) {
  const [item, tags, entities, claims] = await query(db, [
    {
      sql: `SELECT id, source, kind, publisher, title, summary, url, published_at, first_seen, body, transcript, summary_json, summarised_at, sifted_at,
              fetch_status, fetched_at, attempts, fetch_error FROM items WHERE id = ?`,
      params: [id],
    },
    { sql: `SELECT category, mood, tagger_version, from_text FROM item_tags WHERE item_id = ?`, params: [id] },
    { sql: `SELECT e.name, e.type FROM item_entities ie JOIN entities e ON e.id = ie.entity_id WHERE ie.item_id = ?`, params: [id] },
    {
      sql: `SELECT c.id, c.text, c.status, cs.corroboration, s.id AS storyline_id, s.title AS storyline
            FROM claim_sources cs JOIN claims c ON c.id = cs.claim_id JOIN storylines s ON s.id = c.storyline_id WHERE cs.item_id = ? ORDER BY c.id`,
      params: [id],
    },
  ]);
  const r = item[0];
  if (!r) return { error: `No item ${id}` };
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    publisher: r.publisher ?? undefined,
    title: r.title,
    url: r.url ?? undefined,
    publishedAt: r.published_at ?? undefined,
    firstSeen: r.first_seen,
    feedSummary: r.summary ?? undefined,
    fetch: { status: r.fetch_status ?? undefined, at: r.fetched_at ?? undefined, attempts: num(r.attempts), error: r.fetch_error ?? undefined },
    text: (r.body ?? r.transcript ?? undefined) as string | undefined,
    textFrom: r.body != null ? 'article' : r.transcript != null ? 'transcript' : undefined,
    summary: json(r.summary_json) ?? undefined,
    summarisedAt: r.summarised_at ?? undefined,
    readForClaimsAt: r.sifted_at ?? undefined,
    tags: tags[0] ? { category: tags[0].category, mood: tags[0].mood, fromText: num(tags[0].from_text) === 1 } : undefined,
    entities: entities.map((e) => `${e.name} (${e.type})`),
    claims: claims.map((c) => ({ id: num(c.id), text: c.text, status: c.status, headlineOnly: num(c.corroboration) === 1, storyline: c.storyline })),
  };
}

// ---- The squad list ----

/** Everyone the story engine knows as a player or staff member: the club's pages, with the admin's edits (migration 0009). */
export async function rosterData(db: D1Database) {
  const [rows] = await query(db, [{ sql: `SELECT id, type, name, aliases, active, locked, added FROM entities WHERE type IN ('player', 'staff') ORDER BY active DESC, type DESC, name` }]);
  return {
    people: rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      name: String(r.name),
      aliases: (json(r.aliases) as string[] | undefined) ?? [],
      active: num(r.active) === 1,
      edited: num(r.locked) === 1,
      added: num(r.added) === 1,
    })),
  };
}

/** Same slug as the pipeline's (pipeline/src/text.ts), so an added player gets the id the club page would give them. */
const slugOf = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
const cleanType = (v: unknown) => (v === 'staff' ? 'staff' : 'player');
const cleanAliases = (v: unknown) =>
  JSON.stringify(
    String(v ?? '')
      .split(',')
      .map((a) => a.replace(/\s+/g, ' ').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 10),
  );

/**
 * Saves one change from the roster page: `save` (spelling, aliases, role), `add` (someone signed but not on the club's
 * pages yet), `active` (switch someone off or back on). Anything touched is `locked`, so the next build lays it over the
 * club page. Returns an error message, or undefined when it worked.
 */
export async function saveRoster(db: D1Database, form: FormData): Promise<string | undefined> {
  const action = String(form.get('action') ?? '');
  const id = String(form.get('id') ?? '');
  const run = (sql: string, ...params: unknown[]) => db.batch([db.prepare(sql).bind(...params)]);
  if (action === 'add') {
    const name = cleanName(form.get('name'));
    const newId = slugOf(name);
    if (!newId) return 'Give the new person a name.';
    await run(
      `INSERT INTO entities (id, type, name, aliases, active, locked, added) VALUES (?, ?, ?, ?, 1, 1, 1)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type, active = 1, locked = 1, added = 1 WHERE entities.type IN ('player', 'staff')`,
      newId,
      cleanType(form.get('type')),
      name,
      cleanAliases(form.get('aliases')),
    );
    return undefined;
  }
  if (!id) return 'No person given.';
  if (action === 'active') {
    await run(`UPDATE entities SET active = ?, locked = 1 WHERE id = ? AND type IN ('player', 'staff')`, form.get('active') === '1' ? 1 : 0, id);
    return undefined;
  }
  if (action === 'save') {
    const name = cleanName(form.get('name'));
    if (!name) return 'A name can\'t be empty.';
    // The id stays as it was: stories and tags already point at it, and the club page still gives the old spelling.
    await run(
      `UPDATE entities SET name = ?, type = ?, aliases = ?, locked = 1 WHERE id = ? AND type IN ('player', 'staff')`,
      name,
      cleanType(form.get('type')),
      cleanAliases(form.get('aliases')),
      id,
    );
    return undefined;
  }
  return 'Unknown action.';
}

// ---- The page ----

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A time as "28 Oct 14:30" in UK time. */
const when = (t: unknown) =>
  t ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(String(t))) : '–';

const table = (head: string[], rows: unknown[][]) =>
  rows.length
    ? `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'string' && c.startsWith('<!--raw-->') ? c.slice(10) : esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="none">Nothing.</p>';
/** A cell that is already HTML. */
const raw = (html: string) => `<!--raw-->${html}`;
const pill = (text: string, tone: 'ok' | 'warn' | 'bad' | '' = '') => raw(`<span class="pill ${tone}">${esc(text)}</span>`);
const bar = (n: number, max: number) => `<div class="bar"><i style="width:${Math.min(100, Math.round((n / max) * 100))}%" class="${n >= max ? 'bad' : n >= max * 0.8 ? 'warn' : ''}"></i></div>`;

type Data = Awaited<ReturnType<typeof adminData>>;

export function renderAdmin(d: Data, bulletinId?: string): string {
  const s = d.schedule;
  const age = s.lastBulletin?.ageMinutes;
  const ageTone = age == null ? 'bad' : age > 75 ? 'bad' : age > 45 ? 'warn' : 'ok';
  const jobTotals = Object.entries(d.jobs.last24h).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none in 24h';
  const flash = Object.entries(d.aiUsage.gemini.byModel).find(([m]) => !/lite/i.test(m));

  const health = `
<section><h2>Schedule and health</h2>
<div class="cards">
  <div class="card"><b>Phase</b>${esc(s.phase ?? 'unknown')}${s.cadence.matchOn ? ' · match on' : ''}</div>
  <div class="card"><b>Next programme</b>${s.next.at ? esc(when(s.next.at)) : 'break-ins'}<small>${esc(s.next.why)}</small></div>
  <div class="card"><b>Last bulletin</b><span class="pill ${ageTone}">${age == null ? 'none' : `${age} min ago`}</span><small>${s.lastBulletin ? `${esc(when(s.lastBulletin.at))} · ${esc(s.lastBulletin.runner)} · ${esc(s.lastBulletin.kind)}` : ''}</small></div>
  <div class="card"><b>Home PC</b>${s.homePc.on ? pill('on', 'ok').slice(10) : pill('off', 'warn').slice(10)}<small>last seen ${esc(when(s.homePc.lastSeen))}</small></div>
</div>
<h3>Job queue (24h)</h3><p>${esc(jobTotals)}</p>
${table(['Job', 'Status', 'Runner', 'Queued', 'Tries', ''], d.jobs.open.map((j) => [String(j.id), String(j.status), j.runner, when(j.queuedAt), `${j.attempts}/${j.dispatches}`, j.stuck ? pill('stuck', 'bad') : '']))}
<h3>AI usage today</h3>
<p>Gemini Flash: <b>${flash ? flash[1].requests : 0}</b> of ${d.aiUsage.gemini.flashDailyLimit} requests ${bar(flash ? flash[1].requests : 0, d.aiUsage.gemini.flashDailyLimit)}</p>
${table(['Gemini model', 'Requests', 'Failed'], Object.entries(d.aiUsage.gemini.byModel).map(([m, v]) => [m, v.requests, v.failed]))}
<p class="note">${esc(d.aiUsage.gemini.note)} Day: ${esc(d.aiUsage.gemini.day)}.</p>
<p>Workers AI: <b>${d.aiUsage.workersAi.neurons.toLocaleString("en-GB")}</b> used of ${d.aiUsage.workersAi.budget.toLocaleString('en-GB')} neurons ${bar(d.aiUsage.workersAi.neurons, d.aiUsage.workersAi.budget)}<br><small>${esc(d.aiUsage.workersAi.basis)}${d.aiUsage.workersAi.asOf ? `, as of ${esc(when(d.aiUsage.workersAi.asOf))}` : ""}</small></p>
<h3>Recent errors</h3>
${table(['When', 'Where', 'What'], d.errors.map((e) => [when(e.at), e.source, e.message]))}
</section>`;

  const inputs = `
<section><h2>Inputs</h2>
${table(
  ['Source', 'Kind', '24h', '14d', 'Newest', ''],
  d.inputs.sources.map((r) => [raw(`<a href="/admin?source=${encodeURIComponent(String(r.source))}">${esc(r.source)}</a>`), String(r.kind), r.last24h, r.last14d, when(r.newest), r.failedFetches ? pill(`${r.failedFetches} fetches failed`, 'bad') : r.quiet ? pill('quiet', 'warn') : '']),
)}
<h3>Waiting</h3>
<p>${d.inputs.waiting.untagged} untagged · ${d.inputs.waiting.articlesToFetch} articles to fetch · ${d.inputs.waiting.toRead} to read for claims · ${d.inputs.waiting.videosToSummarise} videos to summarise (past 7 days)</p>
</section>`;

  const st = d.stories;
  const story = `
<section><h2>Story state</h2>
<h3>Upcoming</h3>${table(['Fixture', 'Kick-off'], st.upcoming.map((u) => [String(u.title), when(u.kickOff)]))}
<h3>Results (ledger)</h3>${table(['Date', 'Match', 'Score', 'Source'], st.matches.map((m) => [when(m.date), `${m.home} v ${m.away}`, m.score, String(m.source)]))}
<h3>Open storylines (${st.storylines.length})</h3>
${st.storylines
  .map(
    (sl) => `<details><summary><b>${esc(sl.title)}</b> <small>${esc(sl.kind)} · updated ${esc(when(sl.updatedAt))} · ${sl.claims.length} claims</small></summary>
${sl.brief ? `<p class="note">${esc((sl.brief as { known?: string }).known ?? '')}</p>` : ''}
<ul>${(sl.claims as { text: string; status: string; sources: { outlet?: string; title?: string; url?: string; corroboration?: number }[] }[])
      .map(
        (c) =>
          `<li>${esc(c.text)} ${c.status === 'reported' ? '' : pill(c.status, c.status === 'disputed' ? 'warn' : 'ok').slice(10)}<br><small>${c.sources
            .map((x) => (x.url ? `<a href="${esc(x.url)}" rel="noreferrer">${esc(x.outlet ?? x.title)}</a>` : esc(x.outlet ?? x.title)) + (x.corroboration ? ' (headline)' : ''))
            .join(' · ')}</small></li>`,
      )
      .join('')}</ul></details>`,
  )
  .join('') || '<p class="none">No open storylines.</p>'}
<h3>Presenter predictions</h3>${table(['Presenter', 'Match', 'Call', 'Result'], st.predictions.map((p) => [p.presenter, p.match, p.call, p.outcome ? `${String(p.outcome)} (${p.actual})` : 'to play']))}
<h3>Recent takes</h3>${table(['When', 'Presenter', 'Topic', 'View'], st.takes.map((t) => [when(t.at), t.presenter, t.topic, t.view]))}
</section>`;

  const list = `
<section><h2>Bulletins</h2>
${table(
  ['When', 'Phase', 'Kind', 'Runner', 'Why / writer', ''],
  d.bulletins.map((b) => [when(b.at), String(b.phase ?? ''), String(b.kind), String(b.runner), b.why ?? b.writer ?? '', b.traced ? raw(`<a href="/admin?bulletin=${encodeURIComponent(String(b.id))}">trace</a>`) : '']),
)}
</section>`;

  return page(`<h1>HeartsNews24 admin</h1><p class="note">${esc(when(d.generatedAt))} · <a href="/admin.json${bulletinId ? `?bulletin=${encodeURIComponent(bulletinId)}` : ''}">JSON</a> · <a href="/admin?roster=1">Squad list</a></p>${bulletinId ? traceView(d.bulletin as Trace) : ''}${health}${inputs}${story}${list}`);
}

type Trace = Awaited<ReturnType<typeof bulletinTrace>>;

function traceView(t: Trace): string {
  if ('error' in t) return `<section><h2>Bulletin</h2><p>${esc(t.error)}</p><p><a href="/admin">Back</a></p></section>`;
  const meta = (t.meta ?? {}) as { mode?: string; why?: string };
  const script = (t.script ?? []) as { id: string; title: string; lines: { speaker: string; text: string; link?: string }[] }[];
  return `<section class="trace"><h2>Bulletin ${esc(when(t.bulletin.at))}</h2>
<p><a href="/admin">Back</a> · ${esc(t.bulletin.phase)} · ${esc(t.bulletin.kind)} · ${esc(t.bulletin.runner)}${t.writer ? ` · ${esc(t.writer)}` : ''}</p>
${t.traced ? `<p>${esc(meta.mode)}: ${esc(meta.why)}</p>` : '<p class="none">No trace for this bulletin (built before traces, or the trace failed to save).</p>'}
<h3>Went in</h3>${table(['Story', 'Storyline', ''], t.airings.map((a) => [a.story ?? '', a.storyline ?? '', a.inDepth ? 'in depth' : '']))}
<h3>How each piece was written</h3>
${table(
  ['Piece', 'Requests'],
  t.pieces.map((p) => [
    p.label,
    raw(p.calls.map((c) => `<span class="pill ${c.ok ? 'ok' : 'bad'}" title="${esc(c.error ?? '')}">${esc(c.model.replace('gemini-', '').replace('-latest', ''))} ${c.ok ? '✓' : '✗'} ${Math.round(c.ms / 1000)}s</span>`).join(' ') + (p.fellBack ? ' fell back' : '')),
  ]),
)}
<h3>Cut by the checks</h3>${table(['Checker', 'Action', 'Was', 'Now', 'Why'], t.cuts.map((c) => [c.checker, c.action, c.was, c.now ?? '', c.reason]))}
<h3>Prompts</h3>
${t.prompts ? Object.entries(t.prompts).map(([id, p]) => `<details><summary>${esc(id)} <small>${p.length.toLocaleString('en-GB')} chars</small></summary><pre>${esc(p)}</pre></details>`).join('') : '<p class="none">Cleared (prompts are kept for the latest bulletins only).</p>'}
<h3>Final script</h3>
${script.map((seg) => `<details><summary><b>${esc(seg.title)}</b></summary>${seg.lines.map((l) => `<p><b>${esc(l.speaker)}</b>${l.link ? ` <small>(${esc(l.link)})</small>` : ''}: ${esc(l.text)}</p>`).join('')}</details>`).join('') || '<p class="none">Nothing.</p>'}
</section>`;
}

export function renderSource(d: Awaited<ReturnType<typeof sourceItems>>): string {
  return page(`<h1>${esc(d.source)}</h1><p><a href="/admin">Back</a> · ${d.items.length} items, newest first (up to 200)</p>${table(
    ['Title', 'Seen', 'Kind', 'Text', 'Read', 'Summary', 'Claims'],
    d.items.map((i) => [
      raw(`<a href="/admin?item=${encodeURIComponent(String(i.id))}">${esc(i.title)}</a>`),
      when(i.firstSeen),
      String(i.kind),
      i.fetch === 'ok' || (i.chars != null && !i.fetch) ? `${i.chars} chars` : (i.fetch ?? 'headline only'),
      i.read ? '✓' : '',
      i.summarised ? '✓' : '',
      i.claims || '',
    ]),
  )}`);
}

export function renderItem(d: Awaited<ReturnType<typeof itemDetail>>): string {
  if ('error' in d) return page(`<p>${esc(d.error)}</p><p><a href="/admin">Back</a></p>`);
  const summary = d.summary ? JSON.stringify(d.summary, null, 2) : undefined;
  return page(`<h1>${esc(d.title)}</h1>
<p><a href="/admin?source=${encodeURIComponent(String(d.source))}">Back to ${esc(d.source)}</a> · ${esc(d.kind)} · first seen ${esc(when(d.firstSeen))}${d.url ? ` · <a href="${esc(d.url)}" rel="noreferrer">original</a>` : ''}</p>
<p class="note">Fetch: ${esc(d.fetch.status ?? 'not tried')}${d.fetch.attempts ? ` (${d.fetch.attempts} tries)` : ''}${d.fetch.error ? ` · ${esc(d.fetch.error)}` : ''} · tags: ${d.tags ? `${esc(d.tags.category)}, ${esc(d.tags.mood)}${d.tags.fromText ? ' (from the text)' : ' (from the headline)'}` : 'none'}${d.entities.length ? ` · ${esc(d.entities.join(', '))}` : ''}</p>
<section><h2>Claims built on it (${d.claims.length})</h2>${table(['Claim', 'Status', 'Storyline', ''], d.claims.map((c) => [c.text, String(c.status), String(c.storyline), c.headlineOnly ? 'headline only' : '']))}
<p class="note">${d.readForClaimsAt ? `Read for claims ${esc(when(d.readForClaimsAt))}.` : 'Not read for claims yet.'}</p></section>
<section><h2>Summary</h2>${summary ? `<p class="note">Made ${esc(when(d.summarisedAt))}</p><pre>${esc(summary)}</pre>` : '<p class="none">No generated summary (short items are used whole).</p>'}
${d.feedSummary ? `<h3>Feed blurb</h3><p>${esc(d.feedSummary)}</p>` : ''}</section>
<section><h2>Scraped text${d.textFrom ? ` (${esc(d.textFrom)}, ${d.text!.length.toLocaleString('en-GB')} chars)` : ''}</h2>${d.text ? `<pre>${esc(d.text)}</pre>` : '<p class="none">None kept: headline only, or pruned after 30 days.</p>'}</section>`);
}

const typeSelect = (current: string) => `<select name="type"><option value="player"${current === 'player' ? ' selected' : ''}>player</option><option value="staff"${current === 'staff' ? ' selected' : ''}>staff</option></select>`;

export function renderRoster(d: Awaited<ReturnType<typeof rosterData>>, error?: string): string {
  const row = (p: (typeof d.people)[number]) => `<form method="post" action="/admin/roster" class="person${p.active ? '' : ' off'}">
<input type="hidden" name="id" value="${esc(p.id)}">
<input name="name" value="${esc(p.name)}" aria-label="Name" required maxlength="80">
${typeSelect(p.type)}
<input name="aliases" value="${esc(p.aliases.join(', '))}" aria-label="Also known as" placeholder="also known as, comma separated">
<span class="acts"><button name="action" value="save">Save</button>
<button name="action" value="active" formnovalidate onclick="this.form.active.value='${p.active ? 0 : 1}'">${p.active ? 'Switch off' : 'Switch on'}</button>
<input type="hidden" name="active" value="">
${p.added ? pill('added by hand', 'warn').slice(10) : p.edited ? pill('edited', '').slice(10) : ''}${p.active ? '' : pill('off', 'bad').slice(10)}</span>
</form>`;
  const on = d.people.filter((p) => p.active);
  const off = d.people.filter((p) => !p.active);
  return page(`<h1>Squad list</h1>
<p class="note"><a href="/admin">Back</a> · <a href="/admin.json?roster=1">JSON</a> · ${on.length} at the club. The names come from the club's own squad and coaching staff pages; what you change here is laid over them at the next ingest or build.</p>
${error ? `<p class="pill bad">${esc(error)}</p>` : ''}
<section><h2>Add someone</h2>
<p class="note">For a signing the club's site doesn't list yet. They stay until you switch them off.</p>
<form method="post" action="/admin/roster" class="person"><input name="name" placeholder="Full name, as the press spells it" aria-label="Name" required maxlength="80">${typeSelect('player')}
<input name="aliases" placeholder="also known as, comma separated" aria-label="Also known as"><span class="acts"><button name="action" value="add">Add</button></span></form></section>
<section><h2>At the club (${on.length})</h2>${on.map(row).join('') || '<p class="none">Nobody yet: the first ingest after the club-page change fills this in.</p>'}</section>
${off.length ? `<section><h2>Switched off or no longer listed (${off.length})</h2><p class="note">Stories about these people can no longer open. Anyone the club's pages stop listing lands here by itself.</p>${off.map(row).join('')}</section>` : ''}`);
}

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>HeartsNews24 admin</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mute:#666;--line:#ddd;--card:#f6f6f8;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--mute:#999;--line:#2c2f36;--card:#1d2026;--ok:#3fb950;--warn:#d29922;--bad:#f85149}}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;max-width:1000px;margin-inline:auto}
h1{font-size:20px;margin:0}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font-size:14px;margin:18px 0 6px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}
a{color:inherit}small,.note{color:var(--mute)}.none{color:var(--mute);font-style:italic}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}.card{background:var(--card);border-radius:8px;padding:10px}.card b{display:block;font-size:12px;color:var(--mute);text-transform:uppercase}.card small{display:block}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600;white-space:nowrap}
.pill{display:inline-block;padding:0 7px;border-radius:9px;border:1px solid var(--line);font-size:12px;white-space:nowrap}.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.warn{color:var(--warn);border-color:var(--warn)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.bar{height:6px;background:var(--card);border-radius:3px;margin-top:3px}.bar i{display:block;height:100%;background:var(--ok);border-radius:3px}.bar i.warn{background:var(--warn)}.bar i.bad{background:var(--bad)}
.person{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}.person.off{opacity:.65}.person input,.person select,.person button{font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}.person input[name=name]{flex:1 1 160px}.person input[name=aliases]{flex:2 1 200px}.person button{cursor:pointer}.acts{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
details{background:var(--card);border-radius:8px;padding:8px 10px;margin:6px 0}summary{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}li{margin:6px 0}
</style></head><body>${body}</body></html>`;
}

// ---- The route ----

const COOKIE = 'admin';

function cookieOf(request: Request, name: string): string {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

const noStore = { 'cache-control': 'no-store' };
const denied = () => new Response('Unauthorised', { status: 401, headers: { ...noStore, 'content-type': 'text/plain' } });

/** Serves /admin, /admin.json and the squad list's form post. Everything is 401 without the token; only the squad list writes. */
export async function admin(request: Request, env: AdminEnv): Promise<Response> {
  if (!env.DB || !env.ADMIN_TOKEN) return new Response('Admin not configured', { status: 503, headers: noStore });
  const url = new URL(request.url);
  const token = env.ADMIN_TOKEN;
  const offered = url.searchParams.get('token');
  const bearer = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const ok = [offered, bearer, cookieOf(request, COOKIE)].some((t) => t && sameToken(t, token));
  if (!ok) return denied();

  // The squad list is the one thing the admin view writes. A form post from another site is refused outright (the cookie is
  // SameSite=Strict as well), then it goes back to the list.
  if (request.method === 'POST' && url.pathname === '/admin/roster') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403, headers: noStore });
    const error = await saveRoster(env.DB, await request.formData());
    if (error) return new Response(renderRoster(await rosterData(env.DB), error), { status: 400, headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' } });
    return new Response(null, { status: 303, headers: { ...noStore, location: '/admin?roster=1' } });
  }

  const asJson = url.pathname === '/admin.json';
  const setCookie = offered && sameToken(offered, token) ? `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 86_400}; HttpOnly; Secure; SameSite=Strict` : undefined;
  if (offered && !asJson) {
    // Straight to the same page without the token in the address.
    url.searchParams.delete('token');
    const headers = new Headers({ ...noStore, location: `${url.pathname}${url.search}` });
    if (setCookie) headers.append('set-cookie', setCookie);
    return new Response(null, { status: 303, headers });
  }

  const headers = new Headers(noStore);
  if (setCookie) headers.append('set-cookie', setCookie);
  const respond = (data: unknown, html: string) => {
    if (asJson) return Response.json(data, { headers });
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(html, { headers });
  };
  if (url.searchParams.has('roster')) {
    const d = await rosterData(env.DB);
    return respond(d, renderRoster(d));
  }
  const itemId = url.searchParams.get('item');
  if (itemId) {
    const d = await itemDetail(env.DB, itemId);
    return respond(d, renderItem(d));
  }
  const source = url.searchParams.get('source');
  if (source) {
    const d = await sourceItems(env.DB, source);
    return respond(d, renderSource(d));
  }

  const bulletinId = url.searchParams.get('bulletin') ?? undefined;
  const data = await adminData(env.DB, Date.now(), bulletinId);
  return respond(data, renderAdmin(data, bulletinId));
}
