import type { PlayerRecord } from '../../shared/londonhearts-players.ts';

/** The part of the pipeline's Store these need, so the Worker can pass its own D1 without importing Node code. */
export interface TallyStore {
  batch(statements: { sql: string; params?: (string | number | null)[] }[]): Promise<Record<string, unknown>[][]>;
}

// The totals and the audit, kept free of Node so the admin view in the Worker can use them (worker/src/admin.ts).
// How they're counted is in tally.ts (issue #35).

export const SINCE_KEY = 'tally_since';

export async function tallySince(store: TallyStore): Promise<string | undefined> {
  const [rows] = await store.batch([{ sql: `SELECT value FROM state WHERE key = ?`, params: [SINCE_KEY] }]);
  return rows[0] ? (JSON.parse(String(rows[0].value)) as string) : undefined;
}

export interface Totals {
  id: string;
  name: string;
  apps: number;
  goals: number;
  /** In the most recently counted game, and what he did in it. */
  latest?: { played: boolean; goals: number };
  lhId?: string;
}

/** Everyone's total now: the seed plus the games counted since. */
export async function loadTotals(store: TallyStore, upTo?: string): Promise<Totals[]> {
  const [rows, last] = await store.batch([
    {
      sql: `SELECT e.id, e.name, t.lh_id, t.seed_apps + COUNT(g.match_id) AS apps, t.seed_goals + COALESCE(SUM(g.goals), 0) AS goals
            FROM tally t JOIN entities e ON e.id = t.entity_id AND e.active = 1
            LEFT JOIN tally_games g ON g.entity_id = t.entity_id AND (? IS NULL OR substr(g.match_id, 1, 10) <= ?)
            GROUP BY e.id ORDER BY e.id`,
      params: [upTo ?? null, upTo ?? null],
    },
    { sql: `SELECT g.entity_id, g.goals FROM tally_games g WHERE g.match_id = (SELECT match_id FROM tally_runs ORDER BY date DESC LIMIT 1)` },
  ]);
  const latest = new Map(last.map((r) => [String(r.entity_id), Number(r.goals)]));
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    apps: Number(r.apps),
    goals: Number(r.goals),
    ...(latest.has(String(r.id)) ? { latest: { played: true, goals: latest.get(String(r.id))! } } : {}),
    ...(r.lh_id ? { lhId: String(r.lh_id) } : {}),
  }));
}

export interface Drift {
  name: string;
  field: 'apps' | 'goals';
  ours: number;
  theirs: number;
}

/**
 * Our figures against London Hearts' new ones, for the games they now include. Their list is read as it stands and ours is
 * counted up to the same last game, so it's a like-for-like check. Only players we seeded from their list can be
 * compared. `counted` is how many of our games fall in that span: if it's fewer than the games they have added, the
 * difference is games we missed, and every player who played in them will show as drift.
 */
export async function auditTally(store: TallyStore, records: PlayerRecord[]): Promise<{ upTo: string; since: string; counted: number; checked: number; drift: Drift[] }> {
  const upTo = records.map((r) => r.last).reduce((a, b) => (b > a ? b : a), '');
  const since = await tallySince(store);
  if (!since) throw new Error('The tally has not been seeded yet');
  const [runs] = await store.batch([{ sql: `SELECT match_id FROM tally_runs WHERE substr(match_id, 1, 10) <= ?`, params: [upTo] }]);
  const ours = new Map((await loadTotals(store, upTo)).filter((t) => t.lhId).map((t) => [t.lhId!, t]));
  const drift: Drift[] = [];
  let checked = 0;
  for (const r of records) {
    const mine = ours.get(r.id);
    if (!mine) continue;
    checked++;
    if (mine.apps !== r.apps) drift.push({ name: mine.name, field: 'apps', ours: mine.apps, theirs: r.apps });
    if (mine.goals !== r.goals) drift.push({ name: mine.name, field: 'goals', ours: mine.goals, theirs: r.goals });
  }
  return { upTo, since, counted: runs.length, checked, drift };
}
