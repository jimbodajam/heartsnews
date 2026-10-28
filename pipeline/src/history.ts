// On this day in Hearts history (issue #8): which of today's birthdays and old games from London Hearts go on air.
//
// Birthdays: current players first, then by what they did at Hearts (appearances, goals). Few viewers remember a player
// whose last game was decades ago, so before PEAK_ERA a player counts for less, halving every ERA_HALF_LIFE years,
// unless he's a legend: LEGEND_APPS or LEGEND_GOALS for Hearts, or on the club's own list (clubs/*.json `legends`).
// Only someone worth a proper look gets the package; the rest are a mention and the list on screen.
//
// Games: competitive wins only, the biggest first: finals, then Europe, then derbies and big clubs, then the margin and
// the goals. Round anniversaries and games with known scorers count for more.
//
// And two extras when the day has them: a great who died on this day, on a round anniversary, and a heavy Hibs defeat
// for Fraser to enjoy.

import { roundYears, type HibsResult, type HistoryBirthday, type HistoryDeath, type HistoryResult, type OnThisDay } from './collectors/londonhearts.ts';
import type { ClubConfig } from './types.ts';

export const PEAK_ERA = 1990;
export const ERA_HALF_LIFE = 5;
export const LEGEND_APPS = 300;
export const LEGEND_GOALS = 100;
/** A birthday this strong (after the era drop) gets the package. */
export const PACKAGE_SCORE = 50;
/** Birthdays in the list on screen, the package's player included. */
export const LIST_MAX = 6;
/** Games mentioned after the featured one. */
export const ALSO_MAX = 2;
/** A Hibs league defeat by this many goals is worth a dig; any defeat in a cup semi-final, final or Europe is. */
export const HIBS_MARGIN = 3;
/** How far back a Hibs defeat can come from, cup finals aside. */
export const HIBS_YEARS = 50;

export interface RankedBirthday extends HistoryBirthday {
  age: number;
  current: boolean;
  legend: boolean;
  score: number;
}

export interface HistoryPicks {
  /** MM-DD */
  day: string;
  /** The player who gets the package, when someone's worth it. */
  star?: RankedBirthday;
  /** Everyone born today, best first (the star included), for the list on screen. */
  birthdays: RankedBirthday[];
  /** The game to look back on, and a couple more from the same date. */
  game?: HistoryResult;
  also: HistoryResult[];
  /** A great who died on this day, on a round anniversary. */
  remember?: HistoryDeath & { years: number };
  /** A Hibs defeat on this date worth a dig: "and across the city…". */
  hibs?: HibsDefeat;
}

export interface HibsDefeat extends HibsResult {
  opponent: string;
  /** Hibs' score first. */
  score: [number, number];
}

const year = (date: string) => Number(date.slice(0, 4));

/** The season that's on now starts in July. */
const seasonStart = (now: Date) => new Date(Date.UTC(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 6, 1));

export function rankBirthday(b: HistoryBirthday, now: Date, legends: string[] = []): RankedBirthday {
  const current = Boolean(b.last) && new Date(b.last) >= seasonStart(now);
  const legend = b.apps >= LEGEND_APPS || b.goals >= LEGEND_GOALS || legends.includes(b.id);
  const last = year(b.last) || b.born + 30;
  const era = legend || last >= PEAK_ERA ? 1 : 0.5 ** ((PEAK_ERA - last) / ERA_HALF_LIFE);
  const score = (b.apps + 2 * b.goals) * era + (current ? 1000 : 0);
  return { ...b, age: now.getUTCFullYear() - b.born, current, legend, score };
}

/** League, Scottish Cup, League Cup and Europe. Not friendlies, tours, local cups or wartime football. */
export function competitive(r: { competition: string }): boolean {
  if (/war|southern|friendly|tour|testimonial|benefit|charity/i.test(r.competition)) return false;
  return /division|premier|championship|^scottish (cup|league)$|^league cup$|uefa|europ|champions|cup winners|fairs|intertoto/i.test(r.competition);
}

// Not "champions" alone: that would match the Championship.
export const isEurope = (r: HistoryResult) => /uefa|europ|champions league|cup winners|fairs|intertoto/i.test(r.competition);

export function gameScore(r: HistoryResult, club: ClubConfig, now: Date): number {
  const [us, them] = r.score;
  const ago = now.getUTCFullYear() - year(r.date);
  const big = club.bigGames?.opponents.findIndex((o) => o.names.includes(r.opponent)) ?? -1;
  return (
    (/^final$/i.test(r.round) ? 100 : /semi|^sf/i.test(r.round) ? 40 : /quarter|^qf/i.test(r.round) ? 20 : 0) +
    (isEurope(r) ? 40 : 0) +
    // The first of the big opponents is the derby.
    (big === 0 ? 40 : big > 0 ? 25 : 0) +
    // A cricket score against a small side shouldn't beat a famous European night.
    5 * Math.min(us - them, 5) +
    2 * us +
    (ago % 25 === 0 ? 30 : ago % 10 === 0 ? 10 : 0) +
    (r.scorers.length && r.scorers.every((g) => g.player !== 'Unknown') ? 10 : -20) +
    (ago <= 40 ? 20 : 0)
  );
}

const HIBS = 'Hibernian';

/** Hibs' league (their codes: L1, L2, P, SPR, SPL, SCH), the cups and Europe. */
const hibsCompetitive = (c: string) => /^(L1|L2|P|SPR|SPL|SCH)$|^scottish cup$|^league cup$|uefa|europ|champions league|cup winners|fairs/i.test(c);

/**
 * The Hibs defeat to mention, if any: not against us (that's in our own results), and only a heavy one (by
 * HIBS_MARGIN or more) or one in a cup semi-final, final or Europe, from the last HIBS_YEARS (a lost final from any
 * time). Finals first, then the margin, recent ones ahead.
 */
export function hibsDefeat(results: HibsResult[], club: ClubConfig, now: Date): HibsDefeat | undefined {
  return results
    .flatMap((r): HibsDefeat[] => {
      const home = r.home === HIBS;
      if (!home && r.away !== HIBS) return [];
      const opponent = home ? r.away : r.home;
      const score: [number, number] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
      if (opponent === club.name || score[0] >= score[1] || !hibsCompetitive(r.competition)) return [];
      return [{ ...r, opponent, score }];
    })
    .map((r) => {
      const big = /^final$/i.test(r.round) ? 100 : /semi|^sf/i.test(r.round) ? 40 : /uefa|europ|champions|fairs|winners/i.test(r.competition) ? 30 : 0;
      const margin = r.score[1] - r.score[0];
      const ago = now.getUTCFullYear() - year(r.date);
      // Like the birthdays, nobody remembers a league defeat from a century ago; a lost final is another matter.
      const ok = big >= 100 || (ago <= HIBS_YEARS && (big > 0 || margin >= HIBS_MARGIN));
      return { r, ok, score: big + 5 * Math.min(margin, 5) + (ago <= 40 ? 20 : 0) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score)[0]?.r;
}

/** A legend (as for birthdays) who died on this day, on a round anniversary: 10, 20, 25, 30… years. */
export function remembered(deaths: HistoryDeath[], club: ClubConfig, now: Date): (HistoryDeath & { years: number }) | undefined {
  const legends = club.legends?.map((l) => l.id) ?? [];
  return deaths
    .map((d) => ({ ...d, years: now.getUTCFullYear() - d.died }))
    .filter((d) => roundYears(d.years) && ((d.apps ?? 0) >= LEGEND_APPS || (d.goals ?? 0) >= LEGEND_GOALS || legends.includes(d.id)))
    .sort((a, b) => (b.apps ?? 0) + 2 * (b.goals ?? 0) - ((a.apps ?? 0) + 2 * (a.goals ?? 0)))[0];
}

export function pickHistory(day: OnThisDay, club: ClubConfig, now: Date): HistoryPicks {
  const birthdays = day.birthdays
    .map((b) => rankBirthday(b, now, club.legends?.map((l) => l.id)))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIST_MAX);
  const star = birthdays[0] && birthdays[0].score >= PACKAGE_SCORE ? birthdays[0] : undefined;
  const wins = day.results
    .filter((r) => r.result === 'w' && competitive(r))
    .map((r) => ({ r, score: gameScore(r, club, now) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
  return {
    day: day.day,
    star,
    birthdays,
    game: wins[0],
    also: wins.slice(1, 1 + ALSO_MAX),
    remember: remembered(day.deaths, club, now),
    hibs: hibsDefeat(day.hibs ?? [], club, now),
  };
}
