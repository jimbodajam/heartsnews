import { initialData } from '../../shared/bbc.ts';
import { type Played, playedIn } from '../../shared/live.ts';
import { type PlayerRecord } from './collectors/londonhearts.ts';
import { fetchText } from './http.ts';
import type { Statement, Store } from './store.ts';
import { slug } from './text.ts';
import type { ClubConfig, Fixture } from './types.ts';

// Our own count of each current player's Hearts appearances and goals (issue #35). London Hearts is a fan site that runs
// days behind (on 28 Oct it stopped at the 10 Oct game, four games back), so its totals are only the seed: read once,
// with the date of the last game they include. Every finished game after that is counted from BBC's final line-ups
// and scorers, once, and a player's total is his seed plus his rows. `npm run tally -- --audit` compares the two.

const SINCE_KEY = 'tally_since';
/** A finished page is final well inside this; sooner than this and a late goal or a corrected sub could still change it. */
const SETTLE_MS = 3 * 3_600_000;

/** Appearances and goals worth marking, and how close counts as "nearly". */
export const APP_MILESTONES = [50, 100, 150, 200, 250, 300];
export const GOAL_MILESTONES = [25, 50, 100];
export const NEAR_APPS = 3;
export const NEAR_GOALS = 2;

/** Not a first-team competitive game: London Hearts leaves these out of a player's record. */
export const countable = (competition: string) => !/friendl|testimonial|tour|pre-season|exhibition/i.test(competition);

export interface RosterPlayer {
  id: string;
  name: string;
  aliases: string[];
  number?: number;
}

export async function loadPlayers(store: Store): Promise<RosterPlayer[]> {
  const [rows] = await store.batch([{ sql: `SELECT id, name, aliases, details FROM entities WHERE type = 'player' AND active = 1 ORDER BY id` }]);
  return rows.map((r) => {
    const details = r.details ? (JSON.parse(String(r.details)) as { number?: number }) : {};
    return { id: String(r.id), name: String(r.name), aliases: JSON.parse(String(r.aliases || '[]')) as string[], number: details.number };
  });
}

const surname = (s: string) => slug(s).split('-').at(-1) ?? '';

/**
 * The squad member a BBC name belongs to. BBC's shirt name is a surname ("Kingsley") or a full name ("JJ Williams",
 * "Cláudio Braga"), its first name sometimes both of them; goals come as a full name. Tried from most to least exact,
 * each step taken only when it picks one person; the squad number settles what the names don't.
 */
export function findPlayer(roster: RosterPlayer[], p: { shirt: string; first?: string; number?: number }): RosterPlayer | undefined {
  const names = (r: RosterPlayer) => [r.name, ...r.aliases].map(slug);
  const only = (found: RosterPlayer[]) => (found.length === 1 ? found[0] : undefined);
  const full = p.first ? slug(`${p.first} ${p.shirt}`) : undefined;
  const shirt = slug(p.shirt);
  return (
    (full && only(roster.filter((r) => names(r).includes(full)))) ||
    only(roster.filter((r) => names(r).includes(shirt))) ||
    only(roster.filter((r) => names(r).some((n) => n.split('-').at(-1) === surname(p.shirt)))) ||
    (p.number !== undefined ? only(roster.filter((r) => r.number === p.number)) : undefined)
  );
}

export interface SeedResult {
  since: string;
  seeded: number;
  /** In the squad but not in their list (a new signing): started from nothing. */
  unlisted: string[];
}

/**
 * Seeds every current player from London Hearts' list, once. `since` is the latest game any player's record includes:
 * games after it are ours to count. A name that is on their list more than once takes the player who played most
 * recently. `force` wipes the count and starts again.
 */
export async function seedTally(store: Store, records: PlayerRecord[], roster: RosterPlayer[], now: Date, force = false): Promise<SeedResult | undefined> {
  const [state] = await store.batch([{ sql: `SELECT value FROM state WHERE key = ?`, params: [SINCE_KEY] }]);
  if (state[0] && !force) return undefined;
  const since = records.map((r) => r.last).reduce((a, b) => (b > a ? b : a), '');
  if (!since) throw new Error('London Hearts: no players with a last game, so their layout has probably changed; leaving the tally as it is');

  const unlisted: string[] = [];
  const seeds = roster.map((p) => {
    const found = records.filter((r) => slug(r.name) === slug(p.name) || p.aliases.some((a) => slug(a) === slug(r.name))).sort((a, b) => b.last.localeCompare(a.last))[0];
    if (!found) unlisted.push(p.name);
    return { id: p.id, lh: found?.id ?? null, apps: found?.apps ?? 0, goals: found?.goals ?? 0 };
  });
  const stamp = now.toISOString();
  await store.batch([
    ...(force ? [{ sql: `DELETE FROM tally_games` }, { sql: `DELETE FROM tally_runs` }, { sql: `DELETE FROM tally` }] : []),
    {
      sql: `INSERT OR REPLACE INTO tally (entity_id, lh_id, seed_apps, seed_goals) SELECT value ->> 'id', value ->> 'lh', value ->> 'apps', value ->> 'goals' FROM json_each(?)`,
      params: [JSON.stringify(seeds)],
    },
    { sql: `INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, ?)`, params: [SINCE_KEY, JSON.stringify(since), stamp] },
  ]);
  return { since, seeded: seeds.length, unlisted };
}

export async function tallySince(store: Store): Promise<string | undefined> {
  const [rows] = await store.batch([{ sql: `SELECT value FROM state WHERE key = ?`, params: [SINCE_KEY] }]);
  return rows[0] ? (JSON.parse(String(rows[0].value)) as string) : undefined;
}

/** The id a game is counted under. */
export const gameId = (f: Fixture) => `${f.date.slice(0, 10)}|${f.home}|${f.away}`;

export interface CountedGame {
  id: string;
  played: number;
  scored: number;
  unmatched: string[];
}

/** One finished game's rows: who played (and started) and who scored, for our side. Undefined if the page isn't final. */
export function countGame(
  f: Fixture,
  club: ClubConfig,
  page: ReturnType<typeof playedIn>,
  roster: RosterPlayer[],
): { statements: Statement[]; counted: CountedGame } | undefined {
  const team = club.bbc?.team;
  const side = f.homeSlug === team ? 'home' : f.awaySlug === team ? 'away' : undefined;
  const ours: Played | undefined = side && page[side];
  if (!side || !ours) return undefined;

  const id = gameId(f);
  const rows = new Map<string, { started: boolean; goals: number }>();
  const unmatched: string[] = [];
  for (const p of ours.players) {
    const who = findPlayer(roster, p);
    if (who) rows.set(who.id, { started: p.started, goals: 0 });
    else unmatched.push(p.first && !p.shirt.includes(' ') ? `${p.first} ${p.shirt}` : p.shirt);
  }
  // Own goals count for nobody; a scorer who isn't in the line-ups we matched is a sign something's misread.
  let scored = 0;
  for (const g of (f.scorers ?? []).filter((x) => x.side === side && !x.og)) {
    const who = findPlayer(roster, { shirt: g.player });
    const row = who && rows.get(who.id);
    if (row) row.goals++;
    else unmatched.push(`${g.player} (scorer)`);
    scored++;
  }
  const json = JSON.stringify([...rows].map(([entity, r]) => ({ entity, started: r.started ? 1 : 0, goals: r.goals })));
  return {
    counted: { id, played: rows.size, scored, unmatched },
    statements: [
      { sql: `INSERT OR REPLACE INTO tally_games (match_id, entity_id, started, goals) SELECT ?, value ->> 'entity', value ->> 'started', value ->> 'goals' FROM json_each(?)`, params: [id, json] },
      { sql: `INSERT OR REPLACE INTO tally_runs (match_id, date, counted_at, unmatched) VALUES (?, ?, ?, ?)`, params: [id, f.date, new Date().toISOString(), JSON.stringify(unmatched)] },
    ],
  };
}

/**
 * Counts every finished game since the seed that hasn't been counted yet: a competitive game, settled for a few hours,
 * whose BBC page gives a full set of final line-ups. A page that doesn't is left, and tried again next run.
 */
export async function countGames(
  store: Store,
  club: ClubConfig,
  fixtures: Fixture[],
  now: Date,
  fetchPage: (link: string) => Promise<string> = (link) => fetchText(`https://www.bbc.co.uk${link}`),
): Promise<CountedGame[]> {
  const since = await tallySince(store);
  if (!since) return [];
  const [counted] = await store.batch([{ sql: `SELECT match_id FROM tally_runs` }]);
  const done = new Set(counted.map((r) => String(r.match_id)));
  const due = fixtures
    .filter((f) => f.status === 'done' && f.link && f.date.slice(0, 10) > since && countable(f.competition) && now.getTime() - Date.parse(f.date) > SETTLE_MS && !done.has(gameId(f)))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!due.length) return [];

  const roster = await loadPlayers(store);
  const out: CountedGame[] = [];
  for (const f of due) {
    try {
      const game = countGame(f, club, playedIn(initialData(await fetchPage(f.link!))), roster);
      if (!game) {
        console.warn(`Tally: ${f.home} v ${f.away} (${f.date.slice(0, 10)}) has no final line-ups yet`);
        continue;
      }
      await store.batch(game.statements);
      if (game.counted.unmatched.length) console.warn(`Tally: ${f.home} v ${f.away}: couldn't match ${game.counted.unmatched.join(', ')} to the squad list`);
      out.push(game.counted);
    } catch (err) {
      console.warn(`Tally: couldn't read ${f.home} v ${f.away}: ${(err as Error).message}`);
    }
  }
  return out;
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
export async function loadTotals(store: Store, upTo?: string): Promise<Totals[]> {
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

export interface Milestone {
  id: string;
  name: string;
  kind: 'apps' | 'goals';
  /** The round number: 100. */
  mark: number;
  /** Where he is now. */
  total: number;
  /** He got there in the last game counted. */
  reached: boolean;
  /** Games (or goals) still to go; 0 when reached. */
  to: number;
}

/** Players who are close to a round number, or who reached one in the last game counted. */
export function findMilestones(totals: Totals[]): Milestone[] {
  const out: Milestone[] = [];
  for (const t of totals) {
    const check = (kind: Milestone['kind'], marks: number[], total: number, near: number, justNow: boolean) => {
      for (const mark of marks) {
        const to = mark - total;
        if (to === 0 && justNow) out.push({ id: t.id, name: t.name, kind, mark, total, reached: true, to });
        else if (to > 0 && to <= near) out.push({ id: t.id, name: t.name, kind, mark, total, reached: false, to });
      }
    };
    check('apps', APP_MILESTONES, t.apps, NEAR_APPS, Boolean(t.latest?.played));
    check('goals', GOAL_MILESTONES, t.goals, NEAR_GOALS, (t.latest?.goals ?? 0) > 0);
  }
  // Reached ones first, then the closest, appearances before goals.
  return out.sort((a, b) => Number(b.reached) - Number(a.reached) || a.to - b.to || (a.kind === 'apps' ? -1 : 1));
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
export async function auditTally(store: Store, records: PlayerRecord[]): Promise<{ upTo: string; since: string; counted: number; checked: number; drift: Drift[] }> {
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
