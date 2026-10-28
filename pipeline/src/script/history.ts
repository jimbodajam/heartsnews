import type { Graphic, Line, Segment } from '../../../shared/bulletin.ts';
import type { HistoryGoal, HistoryResult } from '../collectors/londonhearts.ts';
import { isEurope, type HibsDefeat, type HistoryPicks, type RankedBirthday } from '../history.ts';
import { spokenList, spokenYear } from '../time.ts';
import type { ClubConfig } from '../types.ts';
import { firstName, presenter, type Facts } from './facts.ts';

// On This Day (#8): Fraser at the museum with today's Hearts birthdays and a famous win from this date, and, when the
// day has them, a great who died on it and a Hibs defeat to enjoy. Written from London Hearts' records by template,
// not the AI: every name, score and year is read straight from them, so nothing about the club's history can be made
// up. The first line is the shot outside the museum; the rest are inside.

export interface HistoryDraft {
  intro: string;
  /** The package on the star birthday. */
  star?: string;
  /** Everyone else born today (or everyone, when nobody gets the package). */
  birthdays?: string;
  game?: string;
  /** One line for each of the other wins on this date. */
  also: string[];
  /** A great who died on this day, on a round anniversary: straight after the intro, with no card. */
  remember?: string;
  /** "And across the city…": a heavy Hibs defeat on this date, to finish. */
  hibs?: string;
}

const NUMBERS = ['nil', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "two-one", as the style rules want scores said. */
export const scoreWords = ([us, them]: [number, number]) => `${NUMBERS[us] ?? us}-${NUMBERS[them] ?? them}`;

/** "24th of October": the voice reads the ordinal as a word. */
function dayWords(day: string): string {
  const [m, d] = day.split('-').map(Number);
  const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return `${d}${suffix} of ${MONTHS[m - 1]}`;
}

/** Years at Hearts for the card: "1969-77", "1998-2004", "2021-" for a current player. */
const years = (b: RankedBirthday) => {
  const [from, to] = [b.first.slice(0, 4), b.last.slice(0, 4)];
  if (b.current) return `${from}-`;
  if (from === to) return from;
  return from.slice(0, 2) === to.slice(0, 2) ? `${from}-${to.slice(2)}` : `${from}-${to}`;
};

const ground = (r: HistoryResult) => r.ground.replace(/ Park$/, '');

/** "the League Cup final", "the second round of the UEFA Cup", "the league". */
export function occasion(r: HistoryResult): string {
  if (/division|premier|championship|^scottish league$/i.test(r.competition)) return 'the league';
  const comp = r.competition.replace(/^Europa Conference League$/, 'Conference League');
  const round = r.round.trim();
  if (/^final$/i.test(round)) return `the ${comp} final`;
  if (/^(sf|semi)/i.test(round)) return `the ${comp} semi-final`;
  if (/^(qf|quarter)/i.test(round)) return `the ${comp} quarter-final`;
  const n = /^R(\d)$/i.exec(round);
  if (n && ORDINALS[Number(n[1])]) return `the ${ORDINALS[Number(n[1])]} round of the ${comp}`;
  return `the ${comp}`;
}

/** "The goals came from Johnny Hamilton and Alex Young.", "Two from Kenny Black and one from Gary Mackay." */
export function scorersSentence(goals: HistoryGoal[]): string | undefined {
  if (!goals.length || goals.some((g) => g.player === 'Unknown')) return undefined;
  const OG = 'an own goal';
  if (goals.length === 1) return goals[0].og ? 'It came from an own goal.' : `${goals[0].player} got the goal.`;
  const count = new Map<string, number>();
  for (const g of goals) {
    const who = g.og ? OG : g.player;
    count.set(who, (count.get(who) ?? 0) + 1);
  }
  if ([...count].every(([who, n]) => n === 1 || who === OG)) return `The goals came from ${spokenList(goals.map((g) => (g.og ? OG : g.player)))}.`;
  const named = [...count].map(([who, n]) => (who === OG ? (n === 1 ? OG : `${NUMBERS[n] ?? n} own goals`) : n === 3 ? `a hat-trick from ${who}` : `${NUMBERS[n] ?? n} from ${who}`));
  const said = spokenList(named);
  return `${said[0].toUpperCase()}${said.slice(1)}.`;
}

/** "24 OCT 1959", where a result card says "FULL TIME". */
const cardDate = (date: string) => `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3).toUpperCase()} ${date.slice(0, 4)}`;

/** A Hibs defeat's card. London Hearts gives their league as a code ("L1", "SPL"), so it says "League". */
export function hibsCard(r: HibsDefeat): Graphic {
  const league = /^(L1|L2|P|SPR|SPL|SCH)$/i.test(r.competition);
  return {
    type: 'result',
    home: r.home,
    away: r.away,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    competition: league ? 'League' : [r.competition, r.round].filter(Boolean).join(' '),
    status: cardDate(r.date),
  };
}

/** The card for an old game: the result card, with the year where "FULL TIME" would be. */
export function historyResultCard(r: HistoryResult, club: ClubConfig): Graphic {
  const label = (goals: HistoryGoal[]) => {
    const byPlayer = new Map<string, string[]>();
    for (const g of goals.filter((x) => x.player !== 'Unknown')) {
      const name = g.player.split(' ').at(-1)! + (g.og ? ' (og)' : '');
      byPlayer.set(name, [...(byPlayer.get(name) ?? []), g.minute ? `${g.minute}'` : ''].filter(Boolean));
    }
    return [...byPlayer].map(([name, minutes]) => `${name} ${minutes.join(' ')}`.trim());
  };
  const ours = { team: club.shortName, score: r.score[0], scorers: label(r.scorers) };
  const theirs = { team: r.opponent, score: r.score[1], scorers: label(r.oppScorers) };
  const [home, away] = r.venue === 'away' ? [theirs, ours] : [ours, theirs];
  return {
    type: 'result',
    home: home.team,
    away: away.team,
    homeScore: home.score,
    awayScore: away.score,
    competition: [r.competition, /\bof\b/.test(r.round) ? '' : r.round].filter(Boolean).join(' '),
    status: cardDate(r.date),
    homeScorers: home.scorers,
    awayScorers: away.scorers,
  };
}

/** Everyone born today, on screen, with the star (when there is one) picked out. */
export function birthdaysCard(p: HistoryPicks): Graphic {
  return {
    type: 'birthdays',
    title: 'Born on this day',
    rows: p.birthdays.map((b) => ({ name: b.name, years: years(b), apps: b.apps, goals: b.goals, star: b === p.star })),
  };
}

export function historyDraft(f: Facts): HistoryDraft | undefined {
  const p = f.history;
  if (!p || (!p.birthdays.length && !p.game)) return undefined;
  const us = f.club.shortName;
  const intro = `Time for On This Day, our look back through the ${us} history books, and it's the ${dayWords(p.day)}.`;

  let star: string | undefined;
  const s = p.star;
  if (s) {
    const goals = s.goals === 1 ? 'one goal' : `${s.goals} goals`;
    star = s.current
      ? `Happy birthday to ${s.name}, who turns ${s.age} today. He's played ${s.apps} games for ${us} since ${spokenYear(Number(s.first.slice(0, 4)))}, with ${goals}.`
      : // Born on this day rather than an age: the records don't say who is still with us.
        `${s.legend ? `A ${us} great` : `A familiar face`} was born on this day in ${spokenYear(s.born)}: ${s.name}. He played for ${us} from ${spokenYear(Number(s.first.slice(0, 4)))} to ${spokenYear(Number(s.last.slice(0, 4)))}, ` +
        `making ${s.apps} appearances and scoring ${goals}.`;
  }
  const others = p.birthdays.filter((b) => b !== s).map((b) => b.name);
  const birthdays = others.length
    ? s
      ? `Also born on this day: ${spokenList(others)}.`
      : `Former ${us} players born on this day include ${spokenList(others)}.`
    : undefined;

  let game: string | undefined;
  const g = p.game;
  if (g) {
    const where = `${g.venue === 'away' ? 'away ' : ''}at ${ground(g)}`;
    const crowd = g.crowd && g.crowd >= 10_000 ? ` in front of ${g.crowd.toLocaleString('en-GB')}` : '';
    game =
      `And on this day in ${spokenYear(Number(g.date.slice(0, 4)))}, ${us} beat ${g.opponent} ${scoreWords(g.score)} in ${occasion(g)}, ${where}${crowd}.` +
      (scorersSentence(g.scorers) ? ` ${scorersSentence(g.scorers)}` : '');
  }
  const also = p.also.map(
    (r, i) => `${i === 0 ? 'On this date in' : 'And in'} ${spokenYear(Number(r.date.slice(0, 4)))}, ${us} beat ${r.opponent} ${scoreWords(r.score)}${isEurope(r) || occasion(r) !== 'the league' ? ` in ${occasion(r)}` : ''}.`,
  );

  let remember: string | undefined;
  const r = p.remember;
  if (r) {
    const record = r.apps ? `, making ${r.apps} appearances and scoring ${r.goals === 1 ? 'one goal' : `${r.goals ?? 0} goals`}` : '';
    remember =
      `First, we remember ${r.name}, who died on this day in ${spokenYear(r.died)}, ${r.years} years ago. ` +
      `He played for ${us} from ${spokenYear(Number(r.first.slice(0, 4)))} to ${spokenYear(Number(r.last.slice(0, 4)))}${record}.`;
  }

  let hibs: string | undefined;
  const h = p.hibs;
  if (h) {
    const occ = /^final$/i.test(h.round)
      ? ` in the ${h.competition} final`
      : /semi|^sf/i.test(h.round)
        ? ` in the ${h.competition} semi-final`
        : /uefa|europ|champions|fairs|winners/i.test(h.competition)
          ? ` in the ${h.competition}`
          : '';
    hibs = `And across the city, on this day in ${spokenYear(Number(h.date.slice(0, 4)))}, Hibs lost ${scoreWords([h.score[1], h.score[0]])} to ${h.opponent}${occ}. Not that anyone here is counting.`;
  }
  return { intro, remember, star, birthdays, game, also, hibs };
}

/** The segment: the intro outside the museum, then the birthdays and the games inside, each with its card. */
export function historySegment(f: Facts, d: HistoryDraft): Segment | undefined {
  const p = f.history;
  if (!p) return undefined;
  const host = f.channel.cast.history ?? f.channel.cast.anchors[1];
  const card = birthdaysCard(p);
  const lines: Line[] = [{ speaker: host, text: d.intro }];
  if (d.remember) lines.push({ speaker: host, text: d.remember });
  if (d.star) lines.push({ speaker: host, text: d.star, graphic: card });
  if (d.birthdays) lines.push({ speaker: host, text: d.birthdays, graphic: card });
  if (d.game && p.game) lines.push({ speaker: host, text: d.game, graphic: historyResultCard(p.game, f.club) });
  d.also.forEach((text, i) => p.also[i] && lines.push({ speaker: host, text, graphic: historyResultCard(p.also[i], f.club) }));
  if (d.hibs && p.hibs) lines.push({ speaker: host, text: d.hibs, graphic: hibsCard(p.hibs) });
  if (lines.length < 2) return undefined;
  return {
    id: 'history',
    kind: 'history',
    // The sting already says "On This Day" above the title.
    title: dayWords(p.day).replace(' of ', ' '),
    strap: `On this day in ${f.club.shortName} history - stats from London Hearts`,
    scene: 'museum',
    presenters: [host],
    lines,
  };
}

/** For the hand-over into it. */
export const historyHost = (f: Facts) => firstName(presenter(f, f.channel.cast.history ?? f.channel.cast.anchors[1]));
