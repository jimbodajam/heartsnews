// One read of BBC's fixtures, results and table, shared by every run (issue #105). The home Mac reads them every half
// hour (agent.ts) and leaves them in the store; the ingest and the programmes use that copy while it's under 65
// minutes old, and read BBC themselves (and store what they read) only when it isn't. Around our kick-offs a
// programme reads BBC fresh anyway, for the confirmed XI, the live score and the result. So BBC is read from home,
// once a half hour, and GitHub reads it only when the Mac is away.

import { collectBbcMatchData, type SheetCache } from './collectors/bbc.ts';
import { loadSharedMatch, sharedMatchWrite, type Store } from './store.ts';
import type { ClubConfig, MatchData } from './types.ts';

/** Older than this, a run reads BBC itself. */
export const MAX_AGE_MS = 65 * 60_000;
/** The Mac reads BBC again once the copy is this old. */
export const REFRESH_MS = 30 * 60_000;
/** A programme reads BBC fresh from this long before one of our kick-offs… */
export const BEFORE_KO_MS = 2 * 3_600_000;
/** …until this long after it. */
export const AFTER_KO_MS = 3 * 3_600_000;
/** When BBC can't be read, a copy up to this old beats TheSportsDB. */
const FALLBACK_AGE_MS = 6 * 3_600_000;

/** Whether `now` is within the window around any of our kick-offs in the match data. */
export function nearKickOff(match: Pick<MatchData, 'next' | 'last'>, now: Date): boolean {
  const t = now.getTime();
  return [...match.next, ...match.last].some((f) => {
    const ko = Date.parse(f.date);
    return t >= ko - BEFORE_KO_MS && t <= ko + AFTER_KO_MS;
  });
}

export interface MatchSource {
  match: MatchData;
  /** Where it came from, for the run's report: "BBC" or "shared copy, 23 min old". */
  from: string;
}

export interface MatchOptions {
  /** Read BBC fresh around our kick-offs, whatever the copy's age (the programmes). */
  freshNearKickOff?: boolean;
  /** Finished matches' line-ups kept in the store. */
  cache?: SheetCache;
  /** Stand-in for BBC in tests. */
  collect?: (club: ClubConfig, now: Date, cache?: SheetCache) => Promise<MatchData>;
}

/**
 * Fixtures, results and table: the shared copy when it's fresh enough, otherwise from BBC (and then stored for the
 * others). Without a store it's always BBC. Throws if BBC can't be read and there's no recent copy to fall back on.
 */
export async function matchFor(store: Store | undefined, club: ClubConfig, now: Date, opts: MatchOptions = {}): Promise<MatchSource> {
  const { freshNearKickOff = false, cache, collect = collectBbcMatchData } = opts;
  const shared = store ? await loadSharedMatch(store).catch(() => undefined) : undefined;
  const age = shared ? now.getTime() - Date.parse(shared.at) : Infinity;
  const mins = Math.round(age / 60_000);
  if (shared && age < MAX_AGE_MS && !(freshNearKickOff && nearKickOff(shared.match, now))) {
    return { match: shared.match, from: `shared copy, ${mins} min old` };
  }
  let match: MatchData;
  try {
    match = await collect(club, now, cache);
  } catch (err) {
    if (shared && age < FALLBACK_AGE_MS) return { match: shared.match, from: `shared copy, ${mins} min old (BBC failed: ${(err as Error).message})` };
    throw err;
  }
  if (store) await store.batch([sharedMatchWrite(match, now)]).catch((err: Error) => console.warn(`Couldn't share the fixtures: ${err.message}`));
  return { match, from: 'BBC' };
}

/**
 * The Mac's half-hourly read (agent.ts): reads BBC and stores the copy once it's REFRESH_MS old, or when there's
 * none. Returns what it did, or undefined when the copy was still fresh.
 */
export async function refreshShared(store: Store, club: ClubConfig, now: Date, collect = collectBbcMatchData, cache?: SheetCache): Promise<string | undefined> {
  const shared = await loadSharedMatch(store);
  if (shared && now.getTime() - Date.parse(shared.at) < REFRESH_MS) return undefined;
  const match = await collect(club, now, cache);
  await store.batch([sharedMatchWrite(match, now)]);
  return `${match.next.length} next, ${match.last.length} results, ${match.table.length} table rows`;
}
