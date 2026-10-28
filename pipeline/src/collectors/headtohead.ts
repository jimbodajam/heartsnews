import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchText } from '../http.ts';
import { dateKey } from '../time.ts';
import { BASE, cells, LONDON_HEARTS_CACHE, text } from './londonhearts.ts';

// Hearts against one opponent, every game since the first, from London Hearts' "Results Only" page for that team
// (issue #34). Kept in OUT/londonhearts for the day like the day page; the record itself is worked out in headtohead.ts.

/** One game against the opponent. */
export interface Meeting {
  date: string;
  /** As London Hearts name it: "Premiership", "Division 1", "Scottish Cup", "Friendly". */
  competition: string;
  /** "35 of 38", "Final", "R2"; empty for friendlies. */
  round: string;
  venue: 'home' | 'away' | 'neutral';
  /** Hearts' score first. */
  score: [number, number];
  result: 'w' | 'd' | 'l';
  crowd?: number;
}

/** Their page name for a team: lower case letters and digits only ("St Mirren" is stmirren, as they spell it). */
export const teamSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The fixture feeds' names that London Hearts file under another. */
const ALIASES: Record<string, string> = { hibs: 'hibernian', dundeeutd: 'dundeeunited', heartofmidlothian: 'hearts', stmirrenfc: 'stmirren', livingston: 'livingston(meadowbankthistle)' };

export const pageSlug = (opponent: string) => {
  const slug = teamSlug(opponent.replace(/\bFC$/i, ''));
  return ALIASES[slug] ?? slug;
};

/** Every game on a team's page, oldest first; abandoned games (no result) are left out. */
export function parseTeamPage(html: string): Meeting[] {
  return [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap(([, row]): Meeting[] => {
    // No, season, no in season, kick-off, date, report, notes, score, competition, round, venue, crowd, referee, scorers, opposition's.
    const c = cells(row);
    const date = c[4]?.match(/games\/(\d{4})(\d{2})(\d{2})\d*\.html/);
    const score = text(c[7] ?? '').match(/^(\d+)-(\d+)$/);
    const result = c[7]?.match(/class="([wdl])"/)?.[1] as Meeting['result'] | undefined;
    const venue = { H: 'home', A: 'away', N: 'neutral' }[text(c[10] ?? '')] as Meeting['venue'] | undefined;
    if (!date || !score || !result || !venue) return [];
    const crowd = Number(text(c[11] ?? ''));
    return [
      {
        date: `${date[1]}-${date[2]}-${date[3]}`,
        competition: text(c[8]),
        round: text(c[9]),
        venue,
        score: [Number(score[1]), Number(score[2])],
        result,
        ...(crowd > 0 && { crowd }),
      },
    ];
  });
}

/** Every game against this opponent, or none when London Hearts have no page for them (cached for the day). */
export async function collectMeetings(opponent: string, now: Date, cacheDir = LONDON_HEARTS_CACHE): Promise<Meeting[]> {
  const slug = pageSlug(opponent);
  if (!slug) return [];
  const cached = resolve(cacheDir, `${dateKey(now)}-h2h-${slug}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8')) as Meeting[];

  const games = parseTeamPage(await fetchText(`${BASE}/teamcut/${slug}.html`, 30_000));
  // A page that parses to nothing means their layout has changed: fail rather than go on air with no record.
  if (!games.length) throw new Error(`London Hearts: no games found on the ${slug} page`);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, JSON.stringify(games));
  return games;
}
