import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from '../http.ts';
import { dateKey } from '../time.ts';

// London Hearts (londonhearts.com), the supporters' club's stats site, has a page for every day of the year with
// that day's Hearts birthdays, deaths and every Hearts result on that date since 1875. It's a fan-run site, so the
// page is fetched once a day and kept in OUT/londonhearts; the segment credits it on screen.

export const BASE = 'https://www.londonhearts.com/scores';
export const LONDON_HEARTS_CACHE = fileURLToPath(new URL('../../out/londonhearts', import.meta.url));

/** A Hearts player born on this day. `first` and `last` are his first and last Hearts games (friendlies count). */
export interface HistoryBirthday {
  /** London Hearts' player id ("h01422"), the same on every page of theirs. */
  id: string;
  name: string;
  born: number;
  birthplace: string;
  first: string;
  last: string;
  apps: number;
  goals: number;
}

/** A Hearts player who died on this day. */
export interface HistoryDeath {
  id: string;
  name: string;
  died: number;
  place: string;
  first: string;
  last: string;
  /**
   * His Hearts appearances and goals. The day's page doesn't give them, so they're looked up in the list of every
   * player only when it's a round anniversary (roundYears) and might go on air.
   */
  apps?: number;
  goals?: number;
}

/** A Hibs game on this date in some year, as London Hearts lists them (for "and across the city…"). */
export interface HibsResult {
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** Their own short codes for the league ("L1", "P", "SPL"); cups and Europe by name. */
  competition: string;
  round: string;
}

export interface HistoryGoal {
  /** "Unknown" where the old records don't say. */
  player: string;
  /** The minute as it's said: "16", "90+1". Missing for most games before the war. */
  minute?: string;
  pen?: boolean;
  /** An own goal: listed with the side it counted for, under the name of the player who put it in. */
  og?: boolean;
}

/** One Hearts game played on this date in some year. */
export interface HistoryResult {
  /** London Hearts' match id (YYYYMMDD and a game number), for the match page at BASE/games/<id>.html. */
  id: string;
  date: string;
  competition: string;
  /** "12 of 22" for a league game, "Final", "R2", "Matchday 2"; empty for friendlies. */
  round: string;
  venue: 'home' | 'away' | 'neutral';
  ground: string;
  opponent: string;
  /** Hearts' score first. */
  score: [number, number];
  /** Aggregate for the second leg of a tie, as they give it. */
  agg?: string;
  result: 'w' | 'd' | 'l';
  /** Missing when unknown (they give 0). */
  crowd?: number;
  scorers: HistoryGoal[];
  oppScorers: HistoryGoal[];
}

export interface OnThisDay {
  /** MM-DD */
  day: string;
  birthdays: HistoryBirthday[];
  deaths: HistoryDeath[];
  /** Oldest first. */
  results: HistoryResult[];
  /** Oldest first. Missing from pages kept before they were read. */
  hibs?: HibsResult[];
}

/** 10, 20, 25, 30… years: an anniversary worth marking. */
export const roundYears = (years: number) => years > 0 && (years % 10 === 0 || years % 25 === 0);

export const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export const cells = (row: string) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);

/** The HTML between a section's anchor and the end of its table. */
function section(html: string, anchor: string): string {
  const start = html.indexOf(`name="${anchor}"`);
  if (start < 0) return '';
  const end = html.indexOf('</table>', start);
  return html.slice(start, end < 0 ? undefined : end);
}

const playerId = (cell: string) => cell.match(/newplayers\/(h\d+)\.html/)?.[1] ?? '';
const gameDate = (cell: string) => text(cell).slice(0, 10);

/** Every row's cells, header rows left out. */
const rows = (html: string) => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1])).filter((c) => c.length);

/** People rows (birthdays, deaths) that link to a player page. */
const people = (html: string) => rows(html).filter((c) => playerId(c[0] ?? ''));

/** "Colin Cameron pen 1:22", "John McNeil [2] 8", "[Billy Davies 46]", "Brian Martin og 51", "-----". */
export function parseGoals(cell: string): HistoryGoal[] {
  return text(cell)
    .split(';')
    .map((s) => s.trim().replace(/^\[|\]$/g, '').trim())
    .filter((s) => s && !/^-+$/.test(s) && s !== 'Missing')
    .map((s) => {
      const m = s.match(/^(.*?)(?:\s+\[\d+\])?(\s+pen)?(\s+og)?(?:\s+(\d+(?:\+\d+)?(?::\d+)?))?$/)!;
      // Recent games give the clock time, "15:55", which is the 16th minute.
      const clock = m[4]?.match(/^(\d+):\d+$/);
      const minute = clock ? String(Number(clock[1]) + 1) : m[4];
      return { player: m[1], ...(minute && { minute }), ...(m[2] && { pen: true }), ...(m[3] && { og: true }) };
    });
}

export function parseDayPage(html: string, day: string): OnThisDay {
  const birthdays = people(section(html, 'Birthdays')).map(
    (c): HistoryBirthday => ({
      id: playerId(c[0]),
      name: text(c[0]),
      born: Number(text(c[1])),
      birthplace: text(c[3]),
      first: gameDate(c[4]),
      last: gameDate(c[5]),
      apps: Number(text(c[6])) || 0,
      goals: Number(text(c[7])) || 0,
    }),
  );

  const deaths = people(section(html, 'Deaths')).map(
    (c): HistoryDeath => ({ id: playerId(c[0]), name: text(c[0]), died: Number(text(c[1])), place: text(c[3]), first: gameDate(c[4]), last: gameDate(c[5]) }),
  );

  // Each result is two rows: the game, with our scorers in its last cell, then a row with the opposition's.
  const res = section(html, 'Results').replace(/<\/table>[\s\S]*/, '');
  const results = [...res.matchAll(/<tr>\s*<td rowspan="2">\d+<\/td>([\s\S]*?)<\/tr>\s*<tr>\s*<td[^>]*class="oppscorers">([\s\S]*?)<\/td>/g)].flatMap(
    ([, row, opp]): HistoryResult[] => {
      const c = cells(row);
      // How long ago, date, report, notes, competition, round, ground, opponent, score, agg, crowd, scorers.
      const id = c[1]?.match(/games\/(\d+)\.html/)?.[1];
      const score = text(c[8] ?? '').match(/^(\d+)-(\d+)$/);
      const result = c[8]?.match(/class="([wdl])"/)?.[1] as HistoryResult['result'] | undefined;
      if (!id || !score || !result) return [];
      const venue = c[6].match(/class="(Home|Away|Neutral)"/)?.[1].toLowerCase() as HistoryResult['venue'] | undefined;
      const crowd = Number(text(c[10]));
      const agg = text(c[9]);
      return [
        {
          id,
          date: gameDate(c[1]),
          competition: text(c[4]),
          round: text(c[5]),
          venue: venue ?? 'home',
          ground: text(c[6]),
          opponent: text(c[7]),
          score: [Number(score[1]), Number(score[2])],
          ...(agg && { agg }),
          result,
          ...(crowd > 0 && { crowd }),
          scorers: parseGoals(c[11] ?? ''),
          oppScorers: parseGoals(opp),
        },
      ];
    },
  );

  const hibs = rows(section(html, 'HibsResults')).flatMap((c): HibsResult[] => {
    // Rank, how long ago, report, date, "Sat 24 Oct 1885 Hibernian 6 Boness 0", competition, round, replay, venue, crowd.
    const date = c[3]?.match(/(\d{4})(\d{2})(\d{2})\.html/);
    const m = text(c[4] ?? '').match(/^\w{3} \d{1,2} \w{3} \d{4} (.+?) (\d+) (.+?) (\d+)$/);
    if (!date || !m) return [];
    return [
      {
        date: `${date[1]}-${date[2]}-${date[3]}`,
        home: m[1],
        away: m[3],
        homeScore: Number(m[2]),
        awayScore: Number(m[4]),
        competition: text(c[5]),
        round: text(c[6]),
      },
    ];
  });

  return { day, birthdays, deaths, results, hibs };
}

/** Every player's Hearts appearances and goals by id, from their list of players by birthday. */
export function parsePlayerTotals(html: string): Map<string, { apps: number; goals: number }> {
  // Name, day, month, year, birthplace, nationality, years, first, last, career length, apps, goals.
  return new Map(people(html).filter((c) => c.length >= 12).map((c) => [playerId(c[0]), { apps: Number(text(c[10])) || 0, goals: Number(text(c[11])) || 0 }]));
}

/** One row of their list of every Hearts player: who he is, his last Hearts game, and his career apps and goals. */
export interface PlayerRecord {
  id: string;
  name: string;
  /** YYYY-MM-DD; friendlies count, and so does a game on the bench. */
  last: string;
  apps: number;
  goals: number;
}

/** Every player on their list by birthday (the same columns as parsePlayerTotals). */
export function parsePlayerRecords(html: string): PlayerRecord[] {
  return people(html)
    .filter((c) => c.length >= 12)
    .map((c) => ({ id: playerId(c[0]), name: text(c[0]), last: gameDate(c[8]), apps: Number(text(c[10])) || 0, goals: Number(text(c[11])) || 0 }));
}

/** Today's page (UK date), from the cache if it was already fetched today. */
export async function collectOnThisDay(now: Date, cacheDir = LONDON_HEARTS_CACHE): Promise<OnThisDay> {
  const today = dateKey(now);
  const day = today.slice(5);
  const cached = resolve(cacheDir, `${today}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8')) as OnThisDay;

  const page = parseDayPage(await fetchText(`${BASE}/datesall/${day.replace('-', '')}.html`, 30_000), day);
  // A page that parses to nothing means their layout has changed: fail rather than go on air with no history.
  if (!page.results.length) throw new Error(`London Hearts: no results found on the ${day} page`);
  // A round anniversary of someone's death might be marked on air, if he was a great: look up what he did for us.
  const year = Number(today.slice(0, 4));
  if (page.deaths.some((d) => roundYears(year - d.died))) {
    try {
      const totals = parsePlayerTotals(await fetchText(`${BASE}/newplayers/aaplayersbirth.html`, 30_000));
      for (const d of page.deaths) Object.assign(d, totals.get(d.id));
    } catch {
      // Then only the club's own list of legends can be marked.
    }
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cached, JSON.stringify(page));
  return page;
}
