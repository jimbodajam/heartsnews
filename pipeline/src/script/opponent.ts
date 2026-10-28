import { spokenList } from '../time.ts';
import type { Graphic } from '../../../shared/bulletin.ts';
import type { Meeting } from '../collectors/headtohead.ts';
import type { HeadToHead } from '../headtohead.ts';
import { scoreWords } from './history.ts';
import type { Fixture, Lineup, OpponentFocus } from '../types.ts';

// Helpers for the opposition focus: results from one team's point of view, and line-ups in words.

export interface TeamResult {
  against: string;
  score: string; // from the team's point of view, e.g. "2-0"
  outcome: 'W' | 'D' | 'L';
  venue: 'H' | 'A';
  competition: string;
}

export function resultFor(team: string, f: Fixture): TeamResult {
  const home = f.home === team;
  const us = (home ? f.homeScore : f.awayScore) ?? 0;
  const them = (home ? f.awayScore : f.homeScore) ?? 0;
  return {
    against: home ? f.away : f.home,
    score: `${us}-${them}`,
    outcome: us > them ? 'W' : us < them ? 'L' : 'D',
    venue: home ? 'H' : 'A',
    competition: f.competition,
  };
}

export function formOf(o: OpponentFocus): TeamResult[] {
  return o.results.map((f) => resultFor(o.opponent, f));
}

/** "Onana in goal, Franculino Djú leading the line" style summary of an XI. */
export function describeXI(xi: Lineup): string {
  const keeper = xi.rows[0]?.[0];
  const front = xi.rows[xi.rows.length - 1] ?? [];
  return `a ${xi.formation} with ${keeper} in goal and ${spokenList(front)} up front`;
}

/** The XI as plain text for the AI prompt: "4-2-3-1: Onana | Wagner Pina, Nwaiwu, … | …". */
export function xiText(xi: Lineup): string {
  return `${xi.formation}: ${xi.rows.map((r) => r.join(', ')).join(' | ')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n: number) => (n < 20 ? UNITS[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${UNITS[n % 10]}` : ''}`);

/** "nineteen fifty-two", "nineteen oh-five", "two thousand and six", "twenty twenty-six": the voice reads 1952 as "nineteen hundred and fifty-two". */
export function spokenYear(year: number): string {
  const [hi, lo] = [Math.floor(year / 100), year % 100];
  if (year >= 2000 && year < 2010) return year === 2000 ? 'two thousand' : `two thousand and ${UNITS[lo]}`;
  if (!lo) return `${under100(hi)} hundred`;
  return `${under100(hi)} ${lo < 10 ? `oh-${UNITS[lo]}` : under100(lo)}`;
}

const where = (v: Meeting['venue']) => ({ home: 'at home', away: 'away', neutral: 'at a neutral ground' })[v];
const when = (m: Meeting) => `in ${MONTHS[Number(m.date.slice(5, 7)) - 1]} ${spokenYear(Number(m.date.slice(0, 4)))}`;
/** Digits for the screen and the AI prompt, words ("five-nil") for the voice. */
const scoreOf = (m: Meeting) => `${m.score[0]}-${m.score[1]}`;
const said = (m: Meeting) => scoreWords(m.score);

/**
 * The head-to-head said aloud, entirely from the records so no figure is made up: the record, the record at the coming
 * game's ground, the last win and the biggest.
 */
export function headToHeadLine(h: HeadToHead, club: string): string {
  const parts = [`Head to head, in ${h.all.played} league and cup meetings ${club} have won ${h.all.won}, drawn ${h.all.drawn} and lost ${h.all.lost}.`];
  if (h.atVenue.played >= 3) {
    parts.push(`${h.venue === 'home' ? 'At home' : 'Away from home'} it's ${h.atVenue.won} wins, ${h.atVenue.drawn} draws and ${h.atVenue.lost} defeats.`);
  }
  if (h.lastWin) {
    parts.push(`The last time ${club} beat ${h.opponent} was ${when(h.lastWin)}, ${said(h.lastWin)} ${where(h.lastWin.venue)}.`);
    if (h.lastWinAtVenue && h.lastWinAtVenue !== h.lastWin) parts.push(`The last win ${where(h.venue)} was ${when(h.lastWinAtVenue)}, ${said(h.lastWinAtVenue)}.`);
  } else {
    parts.push(`${club} have not beaten them in a league or cup game.`);
  }
  if (h.biggestWin && h.biggestWin !== h.lastWin) parts.push(`The biggest win was ${said(h.biggestWin)}, ${when(h.biggestWin)}.`);
  return parts.join(' ');
}

const short = (m: Meeting) => ({ date: `${MONTHS[Number(m.date.slice(5, 7)) - 1].slice(0, 3).toUpperCase()} ${m.date.slice(0, 4)}`, score: scoreOf(m), venue: ({ home: 'H', away: 'A', neutral: 'N' } as const)[m.venue] });

/** The card for the head-to-head. */
export function headToHeadGraphic(h: HeadToHead): Extract<Graphic, { type: 'headtohead' }> {
  const { played, won, drawn, lost } = h.all;
  const at = h.atVenue;
  return {
    type: 'headtohead',
    team: h.opponent,
    venue: h.venue === 'home' ? 'H' : 'A',
    all: { played, won, drawn, lost },
    atVenue: { played: at.played, won: at.won, drawn: at.drawn, lost: at.lost },
    ...(h.lastWin && { lastWin: short(h.lastWin) }),
    ...(h.biggestWin && { biggestWin: short(h.biggestWin) }),
    recent: h.recent.map((m) => ({ outcome: m.result.toUpperCase() as 'W' | 'D' | 'L', score: scoreOf(m), venue: short(m).venue })),
  };
}

/** The head-to-head as plain text for the AI prompt. */
export function headToHeadText(h: HeadToHead, club: string): string {
  const rec = (r: HeadToHead['all']) => `played ${r.played}, won ${r.won}, drawn ${r.drawn}, lost ${r.lost}, goals ${r.for}-${r.against}`;
  const game = (m?: Meeting) => (m ? `${scoreOf(m)} ${where(m.venue)} ${when(m)} (${m.competition})` : 'none');
  return `${club} against ${h.opponent}, league and cup games only (London Hearts' records): ${rec(h.all)}. ${h.venue === 'home' ? 'At home' : 'Away'}: ${rec(h.atVenue)}.
Last meeting: ${game(h.last)}. Last ${club} win: ${game(h.lastWin)}. Biggest ${club} win: ${game(h.biggestWin)}.`;
}
