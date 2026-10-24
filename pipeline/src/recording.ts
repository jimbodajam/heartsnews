// A recorded match as BBC Sport had it at any moment, and live.json replayed from it through the Worker's own code
// (worker/src/feed.ts) on a sped-up clock. The recording is either the trimmed one committed as a test fixture
// (shared/test/fixtures/, from `npm run trim-recording`) or a full one from `npm run record` (pipeline/out/recordings/,
// home PC only).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BbcData, type BbcEvent, block, eventsIn } from '../../shared/bbc.ts';
import { liveFeed } from '../../worker/src/feed.ts';
import { pageAt, type Recording } from './trim-recording.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The match recorded for the live matchday work: Trabzonspor 2-0 Hearts, 22 Oct 2026 (kick-off 16:45 UTC). */
export const FIXTURE = '2026-10-22-trabzonspor-hearts';

export interface RecordedMatch {
  name: string;
  /** When the recording starts and ends, ms. */
  start: number;
  end: number;
  /** A BBC page's data by path at a time, as the Worker would have read it then. Throws for a page not recorded. */
  page(path: string, t: number): Promise<BbcData>;
}

/** The latest of some time-stamped items at or before `t`, or the first if `t` is before them all. */
function latest<T extends { at: number }>(items: T[], t: number): T {
  let found = items[0];
  for (const i of items) if (i.at <= t) found = i;
  return found;
}

const notRecorded = (path: string) => new Error(`BBC ${path}: HTTP 404 (not in the recording)`);
const teamPage = (path: string) => path.endsWith('/scores-fixtures');

/** The trimmed recording committed as a test fixture. Its team page is just the match, as at the start. */
export function openFixture(name = FIXTURE): RecordedMatch {
  const rec = JSON.parse(readFileSync(resolve(ROOT, 'shared/test/fixtures', `${name}.json`), 'utf8')) as Recording;
  const snapshots = rec.snapshots.map((s) => ({ at: Date.parse(s.at), page: s.page }));
  const team: BbcData = { 'sport-data-scores-fixtures': { data: { eventGroups: [{ secondaryGroups: [{ events: [rec.teamEvent] }] }] } } };
  return {
    name,
    start: snapshots[0].at,
    end: snapshots[snapshots.length - 1].at,
    async page(path, t) {
      if (teamPage(path)) return team;
      if (path === rec.teamEvent.onwardJourneyLink) return pageAt(rec, t);
      throw notRecorded(path);
    },
  };
}

/** A full recording from `npm run record`: every change to the team and match pages, read from disk as needed. */
export function openRecording(name: string): RecordedMatch {
  const dir = resolve(ROOT, 'pipeline/out/recordings', name);
  if (!existsSync(dir)) throw new Error(`no recording at ${dir}`);
  const date = name.slice(0, 10);
  const files = readdirSync(dir).sort();
  const stamped = (suffix: string) =>
    files
      .filter((f) => f.endsWith(suffix))
      .map((f) => ({ at: Date.parse(`${date}T${f.slice(0, 2)}:${f.slice(2, 4)}:${f.slice(4, 6)}Z`), file: f }));
  const teams = stamped('-team.json');
  const matches = stamped('-match.json');
  if (!teams.length || !matches.length) throw new Error(`${dir} has no team or match pages`);

  // Each page is 20-300KB and a replay reads the same one many times over: keep the last one read of each.
  const kept: Record<string, { file: string; data: BbcData }> = {};
  const load = (kind: string, file: string) => {
    if (kept[kind]?.file !== file) kept[kind] = { file, data: JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as BbcData };
    return kept[kind].data;
  };

  // The match page's address, from the team page's entry for the match the match page is about.
  const header = block<{ sportDataEvent: BbcEvent }>(load('match', matches[0].file), 'live-header?')?.sportDataEvent;
  const link = eventsIn(load('team', teams[0].file)).find(
    (e) => e.home.shortName === header?.home.shortName && e.away.shortName === header?.away.shortName,
  )?.onwardJourneyLink;
  if (!link) throw new Error('match not found on the recorded team page');

  return {
    name,
    start: Math.min(teams[0].at, matches[0].at),
    end: Math.max(teams[teams.length - 1].at, matches[matches.length - 1].at),
    async page(path, t) {
      if (teamPage(path)) return load('team', latest(teams, t).file);
      if (path === link) return load('match', latest(matches, t).file);
      throw notRecorded(path);
    },
  };
}

export interface ReplayOptions {
  team: string;
  /** Where to start, "HH:MM" or "HH:MM:SS" UTC on the match day (default: the start of the recording). */
  from?: string;
  /** Times faster than real time (default 20). */
  speed?: number;
}

/** live.json replayed from a recording through the Worker's code, on a clock that starts at `from` and runs `speed` times real time. */
export function replay(rec: RecordedMatch, { team, from, speed = 20 }: ReplayOptions) {
  const day = new Date(rec.start).toISOString().slice(0, 10);
  const start = from ? Date.parse(`${day}T${from.length === 5 ? `${from}:00` : from}Z`) : rec.start;
  if (Number.isNaN(start)) throw new Error(`--from ${from}: expected HH:MM`);
  const began = Date.now();
  const now = () => start + (Date.now() - began) * speed;
  const live = liveFeed({ team, now, page: (path) => rec.page(path, now()) });
  return {
    ...live,
    now,
    speed,
    /** Over once the recording has run out, plus long enough for anything still waiting on a description. */
    over: () => now() > rec.end + 5 * 60_000,
  };
}
