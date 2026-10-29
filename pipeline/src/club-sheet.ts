// The club's graphic as a team sheet (issue #40): the printed names matched to the squad table (squad number, position,
// portrait), the shape guessed from the eleven's positions, and the comparison with BBC's sheet.

import type { SheetPlayer, TeamSheet } from '../../shared/live.ts';
import type { ClubXI } from './club-xi.ts';
import { findPlayer, type RosterPlayer } from './tally.ts';
import { slug } from './text.ts';

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface ClubSheet {
  sheet: TeamSheet;
  /** Printed names that matched nobody in the squad: shown as printed, with no number or portrait. */
  unmatched: string[];
}

/** The club site's and BBC's words for a position, as BBC's team sheets say it. */
export function bbcPosition(position?: string): string | undefined {
  if (!position) return undefined;
  if (/goal|keeper/i.test(position)) return 'Goalkeeper';
  if (/defend|back/i.test(position)) return 'Defender';
  if (/mid/i.test(position)) return 'Midfielder';
  if (/forward|striker|attack|winger/i.test(position)) return 'Striker';
  return undefined;
}

/**
 * The shape from how many defenders, midfielders and forwards there are (the graphic carries none): only when it is a
 * clean one, a keeper and ten others split three ways with at least three at the back and one up front.
 */
export function guessFormation(rows: SheetPlayer[][]): string | undefined {
  if (rows.length !== 4 || rows[0].length !== 1) return undefined;
  const [, d, m, f] = rows.map((r) => r.length);
  return d >= 3 && d <= 5 && m >= 2 && f >= 1 && f <= 3 && 1 + d + m + f === 11 ? `${d}-${m}-${f}` : undefined;
}

/**
 * Matches the names to the squad and lays the eleven out by position, in the order the graphic gave them (goalkeeper,
 * then back to front). A name we can't match takes the position of the player before it, and is listed in `unmatched`.
 * If the positions don't make four rows the eleven go in one row after the keeper, with no formation.
 */
export function clubSheet(xi: ClubXI, roster: RosterPlayer[], team: string): ClubSheet {
  const unmatched: string[] = [];
  let last = 'Goalkeeper';
  const player = (name: string, number?: number, listed?: string): SheetPlayer => {
    const shirt = name.trim();
    const who = findPlayer(roster, { shirt, number });
    if (!who) unmatched.push(shirt);
    const position = bbcPosition(who?.position) ?? bbcPosition(listed) ?? last;
    last = position;
    // "Reus" is Beau Reus: the first name is whatever of the squad name comes before the printed one.
    // The squad's spelling and capitalisation (the graphic is in capitals: MCCART).
    const spelt = who && plain(who.name).endsWith(` ${plain(shirt)}`) ? who.name.slice(-shirt.length) : shirt;
    const first = who && plain(who.name).endsWith(` ${plain(shirt)}`) ? who.name.slice(0, -shirt.length).trim() : undefined;
    const shirtNumber = who?.number ?? number;
    return {
      urn: who ? `club:${who.id}` : `club:?${slug(shirt)}`,
      shirt: spelt,
      ...(first ? { first } : {}),
      ...(shirtNumber !== undefined ? { number: shirtNumber } : {}),
      position,
    };
  };
  const starters = xi.starters.map((s) => player(s.name, s.number, s.position));
  const by = (position: string) => starters.filter((p) => p.position === position);
  const rows = [by('Goalkeeper'), by('Defender'), by('Midfielder'), by('Striker')];
  // The club site's positions are loose (Braga and McPake are down as forwards), so a shape that isn't a clean one is not
  // claimed: the keeper, the defenders, then everyone else in the order the graphic gave them.
  const shape = guessFormation(rows);
  const outfield = starters.filter((p) => p.position !== 'Goalkeeper' && p.position !== 'Defender');
  const shaped = shape ? rows : [by('Goalkeeper'), by('Defender'), outfield].filter((r) => r.length);
  const bench = xi.bench.map((x) => {
    const { position: _position, ...p } = player(x.name, x.number);
    return p;
  });
  return { sheet: { team, formation: shape ?? '', rows: shaped, bench }, unmatched };
}

const surname = (p: SheetPlayer) => slug(p.shirt).split('-').at(-1) ?? '';
const same = (a: SheetPlayer, b: SheetPlayer) => surname(a) === surname(b) && (a.number === undefined || b.number === undefined || a.number === b.number);

/** Who differs between the club's XI and BBC's: those the club names that BBC doesn't start, and the reverse. */
export function compareSheets(club: TeamSheet, bbc: TeamSheet): { starts: SheetPlayer[]; notStarting: SheetPlayer[] } {
  const c = club.rows.flat();
  const b = bbc.rows.flat();
  return { starts: c.filter((p) => !b.some((q) => same(p, q))), notStarting: b.filter((q) => !c.some((p) => same(p, q))) };
}
