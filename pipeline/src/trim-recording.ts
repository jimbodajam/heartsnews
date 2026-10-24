// Trims a match recording (from `npm run record`) to what live.json is built from, small enough to commit as a test
// fixture: the team page's event for the match, and each change to the match page's live-header, the key posts in
// its live text stream, the team stats and the teams.
// Usage: npm run trim-recording -- <recording dir name> [out file]
//   e.g. npm run trim-recording -- 2026-10-22-trabzonspor-hearts
// Writes shared/test/fixtures/<name>.json by default.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BbcData, type BbcEvent, block, eventsIn } from '../../shared/bbc.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A trimmed recording: the match's team page event and the match page data over time. The teams change only a few
 * times a match, so they're kept apart from the snapshots rather than repeated in each.
 */
export interface Recording {
  teamEvent: BbcEvent;
  snapshots: { at: string; page: BbcData }[];
  lineups?: { at: string; data: unknown }[];
}

/** The latest of some time-stamped items at or before `t`, or the first if `t` is before them all. */
const latestAt = <T extends { at: string }>(items: T[], t: number) => items.filter((i) => Date.parse(i.at) <= t).pop() ?? items[0];

/** The match page's data at `t` (ms), the teams included. */
export function pageAt(rec: Recording, t: number): BbcData {
  const page = latestAt(rec.snapshots, t).page;
  const lineups = rec.lineups?.length ? latestAt(rec.lineups, t) : undefined;
  return lineups ? { ...page, 'match-lineups?': { data: lineups.data } } : page;
}

async function main() {
  const [name, out = resolve(ROOT, 'shared/test/fixtures', `${name}.json`)] = process.argv.slice(2);
  if (!name) throw new Error('usage: npm run trim-recording -- <recording dir name> [out file]');
  const dir = resolve(ROOT, 'pipeline/out/recordings', name);
  const date = name.slice(0, 10);
  const files = (await readdir(dir)).sort();
  const at = (f: string) => `${date}T${f.slice(0, 2)}:${f.slice(2, 4)}:${f.slice(4, 6)}Z`;
  const load = async (f: string) => JSON.parse(await readFile(resolve(dir, f), 'utf8')) as BbcData;

  const pages = files.filter((f) => f.endsWith('-match.json'));
  const first = await load(pages[0]);
  const header = block<{ sportDataEvent: BbcEvent }>(first, 'live-header?')!.sportDataEvent;
  const team = await load(files.find((f) => f.endsWith('-team.json'))!);
  const teamEvent = eventsIn(team).find((e) => e.home.shortName === header.home.shortName && e.away.shortName === header.away.shortName);
  if (!teamEvent) throw new Error('match not found on the recorded team page');

  const snapshots: Recording['snapshots'] = [];
  const teamSheets: NonNullable<Recording['lineups']> = [];
  let last = '';
  let lastTeams = '';
  for (const f of pages) {
    const data = await load(f);
    const results = block<{ results: Record<string, unknown>[] }>(data, 'stream?')?.results ?? [];
    const e = block<{ sportDataEvent?: BbcEvent }>(data, 'live-header?')?.sportDataEvent;
    const side = ({ shortName, urn, score, scoreUnconfirmed, actions }: BbcEvent['home']) => ({ shortName, urn, score, scoreUnconfirmed, actions });
    // The team stats' top level only (the attack/distribution/... breakdowns repeat or go unused).
    const stats = block<Record<'homeTeam' | 'awayTeam', { stats?: Record<string, unknown> } | undefined>>(data, 'match-stats?');
    const topStats = (t?: { stats?: Record<string, unknown> }) =>
      t?.stats && { stats: Object.fromEntries(Object.entries(t.stats).filter(([, v]) => typeof (v as { total?: unknown })?.total === 'number')) };
    // The teams: only what a team sheet is read from (no player stats or substitutions, which change all game).
    const lineups = block<Record<'homeTeam' | 'awayTeam', Record<string, unknown> | undefined>>(data, 'match-lineups?');
    type Player = { urn: string; name?: { first?: string; shirt?: string }; position?: string; shirtNumber?: unknown; isCaptain?: boolean };
    const sheetPlayer = ({ urn, name, position, shirtNumber, isCaptain }: Player) => ({ urn, name: { first: name?.first, shirt: name?.shirt }, position, shirtNumber, isCaptain });
    const sheet = (t?: Record<string, unknown>) => {
      if (!t) return undefined;
      const players = t.players as { starters?: Player[]; substitutes?: Player[] } | undefined;
      const pitch = t.pitchLayout as { urn: string; name: string; shirtNumber?: string }[][] | undefined;
      return {
        name: { shortName: (t.name as { shortName: string }).shortName },
        formation: { layout: (t.formation as { layout?: string } | undefined)?.layout },
        pitchLayout: pitch?.map((row) => row.map(({ urn, name, shirtNumber }) => ({ urn, name, shirtNumber }))),
        manager: { name: { full: (t.manager as { name?: { full?: string } } | undefined)?.name?.full } },
        players: { starters: players?.starters?.map(sheetPlayer), substitutes: players?.substitutes?.map(sheetPlayer) },
      };
    };
    if (lineups) {
      const teams = JSON.stringify({ homeTeam: sheet(lineups.homeTeam), awayTeam: sheet(lineups.awayTeam) });
      if (teams !== lastTeams) teamSheets.push({ at: at(f), data: JSON.parse(teams) });
      lastTeams = teams;
    }
    const page: BbcData = {
      'live-header?': {
        data: { sportDataEvent: e && { home: side(e.home), away: side(e.away), status: e.status, periodLabel: e.periodLabel, tournament: e.tournament, venue: e.venue } },
      },
      'match-stats?': { data: stats && { homeTeam: topStats(stats.homeTeam), awayTeam: topStats(stats.awayTeam) } },
      // Every coded post, not just the key ones, so the parser's filtering is tested too; only the fields it reads.
      'stream?': {
        data: {
          results: results
            .filter((p) => p.typeCode)
            .map(({ typeCode, headline, header, content, dates }) => ({ typeCode, headline, header, content, dates })),
        },
      },
    };
    const json = JSON.stringify(page);
    if (json === last) continue;
    last = json;
    snapshots.push({ at: at(f), page });
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ teamEvent, snapshots, lineups: teamSheets } satisfies Recording));
  console.log(`${snapshots.length} snapshots and ${teamSheets.length} line-ups of ${pages.length} → ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
