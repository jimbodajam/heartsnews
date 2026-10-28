import { collectSquad } from './collectors/clubsite.ts';
import type { Person } from './entities.ts';
import type { Statement, Store } from './store.ts';
import { slug } from './text.ts';

// Who is at the club. The `entities` table is the source of truth: filled from the club's own squad pages the first
// time, then only checked against them while a transfer window is open (once a day), or when `npm run squad` is run.
// The admin's squad list (worker/src/admin.ts) is where spellings are fixed and signings the site hasn't listed are added.
// `locked` rows have been touched by an admin (a sync won't switch them back on); `added` rows aren't on the club's
// pages at all (a sync won't switch them off).

const STATE_KEY = 'squad_synced';
/** The club page listing fewer people than this has changed shape, not lost its squad: don't act on it. */
const MIN_PAGE = 15;

/** Scotland's windows, roughly: 1 June to 1 September, and January. Loans and free agents outside them: `npm run squad`. */
export function inTransferWindow(now: Date): boolean {
  const month = now.getUTCMonth();
  return (month >= 5 && month <= 7) || (month === 8 && now.getUTCDate() <= 1) || month === 0;
}

const PEOPLE = `type IN ('player', 'staff')`;

/** Everyone at the club now: the squad and staff the story engine may tag. */
export async function loadRoster(store: Store): Promise<Person[]> {
  const [rows] = await store.batch([{ sql: `SELECT id, type, name, aliases FROM entities WHERE ${PEOPLE} AND active = 1 ORDER BY id` }]);
  return rows.map((r) => ({ id: String(r.id), role: r.type as Person['role'], name: String(r.name), aliases: JSON.parse(String(r.aliases || '[]')) as string[] }));
}

interface Existing {
  id: string;
  name: string;
  active: boolean;
  locked: boolean;
  added: boolean;
}

/** New people go in; people the page no longer lists go inactive (unless added by hand); returning ones come back (unless an admin switched them off). */
export function planSquadSync(existing: Existing[], page: Person[], now: Date): { statements: Statement[]; added: string[]; retired: string[]; returned: string[] } {
  if (page.length < MIN_PAGE) throw new Error(`the club's pages list only ${page.length} people, so the layout has probably changed; leaving the squad as it is`);
  const present = new Set<string>();
  const fresh: { id: string; type: string; name: string }[] = [];
  for (const p of page) {
    const id = slug(p.name);
    // A respelled name keeps its old id, so match on that too.
    const have = existing.find((e) => e.id === id || slug(e.name) === id);
    if (have) present.add(have.id);
    else if (id && !fresh.some((f) => f.id === id)) {
      fresh.push({ id, type: p.role ?? 'player', name: p.name });
      present.add(id);
    }
  }
  const ids = JSON.stringify([...present]);
  const retired = existing.filter((e) => e.active && !e.added && !present.has(e.id)).map((e) => e.name);
  const returned = existing.filter((e) => !e.active && !e.locked && present.has(e.id)).map((e) => e.name);
  return {
    added: fresh.map((f) => f.name),
    retired,
    returned,
    statements: [
      { sql: `INSERT OR IGNORE INTO entities (id, type, name, aliases, active) SELECT value ->> 'id', value ->> 'type', value ->> 'name', '[]', 1 FROM json_each(?)`, params: [JSON.stringify(fresh)] },
      { sql: `UPDATE entities SET active = 0 WHERE ${PEOPLE} AND active = 1 AND added = 0 AND id NOT IN (SELECT value FROM json_each(?))`, params: [ids] },
      { sql: `UPDATE entities SET active = 1 WHERE ${PEOPLE} AND active = 0 AND locked = 0 AND id IN (SELECT value FROM json_each(?))`, params: [ids] },
      { sql: `INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, params: [STATE_KEY, JSON.stringify(now.toISOString()), now.toISOString()] },
    ],
  };
}

/** True when the squad has never been read from the club's pages, or a window is open and today's check hasn't been made. */
export async function squadSyncDue(store: Store, now: Date): Promise<boolean> {
  const [rows] = await store.batch([{ sql: `SELECT value FROM state WHERE key = ?`, params: [STATE_KEY] }]);
  if (!rows[0]) return true;
  return inTransferWindow(now) && JSON.parse(String(rows[0].value)).slice(0, 10) !== now.toISOString().slice(0, 10);
}

/** Reads the club's pages and brings the stored squad into line with them. */
export async function syncSquad(store: Store, now: Date, page: Person[] | Promise<Person[]> = collectSquad()): Promise<ReturnType<typeof planSquadSync>> {
  const squad = await page;
  const [rows] = await store.batch([{ sql: `SELECT id, name, active, locked, added FROM entities WHERE ${PEOPLE}` }]);
  const plan = planSquadSync(
    rows.map((r) => ({ id: String(r.id), name: String(r.name), active: Number(r.active) === 1, locked: Number(r.locked) === 1, added: Number(r.added) === 1 })),
    squad,
    now,
  );
  await store.batch(plan.statements);
  return plan;
}

/** The squad for this run: synced first only when it's due (or forced), and a failed sync never stops the run. */
export async function squadFor(store: Store, now: Date, force = false): Promise<Person[]> {
  if (force || (await squadSyncDue(store, now).catch(() => false))) {
    try {
      const p = await syncSquad(store, now);
      console.log(`Squad synced from the club's pages: ${p.added.length} new (${p.added.join(', ') || '–'}), ${p.retired.length} gone (${p.retired.join(', ') || '–'}), ${p.returned.length} back (${p.returned.join(', ') || '–'})`);
    } catch (err) {
      if (force) throw err;
      console.warn(`Couldn't sync the squad from the club's pages, using the stored list: ${(err as Error).message}`);
    }
  }
  return loadRoster(store);
}
