import type { Graphic } from '../../../../shared/bulletin';
import { chip, el, shell } from './common';

type H2H = Extract<Graphic, { type: 'headtohead' }>;
type Game = NonNullable<H2H['lastWin']>;

/** The most recent meetings on the strip. */
const MAX_RECENT = 8;

/** "3-0 H MAY 2026". */
const place = (p: Game) => `${p.score} ${p.venue} ${p.date}`;

/**
 * Our record against the next opponent: the games played over won/drawn/lost blocks (wider for more, unlike SD's equal
 * thirds), the record at the coming game's ground, the last and biggest wins, and the recent meetings oldest first.
 */
export function headtohead(g: H2H): HTMLElement {
  const { root, body } = shell('headtohead', `HEAD TO HEAD: ${g.team}`);
  body.append(el('div', 'games', `${g.all.played} LEAGUE AND CUP GAMES`));
  const wdl = el('div', 'wdl');
  ([['w', 'W', g.all.won], ['d', 'D', g.all.drawn], ['l', 'L', g.all.lost]] as const).forEach(([cls, k, n]) => {
    const b = el('div', cls, `${k} ${n}`);
    b.style.flexGrow = String(n + Math.max(1, g.all.played / 6));
    wdl.append(b);
  });
  body.append(wdl);
  const lines: [string, string][] = [
    [g.venue === 'H' ? 'AT HOME' : 'AWAY', `W${g.atVenue.won} D${g.atVenue.drawn} L${g.atVenue.lost}`],
    ...(g.lastWin ? [['LAST WIN', place(g.lastWin)] as [string, string]] : []),
    ...(g.biggestWin ? [['BIGGEST', place(g.biggestWin)] as [string, string]] : []),
  ];
  lines.forEach(([label, value], i) => {
    const row = el('div', 'kv');
    row.style.setProperty('--i', String(i));
    row.append(el('span', '', label), el('b', '', value));
    body.append(row);
  });
  if (g.recent.length) {
    const strip = el('div', 'recent');
    strip.append(el('span', 'lbl', 'RECENT'));
    g.recent.slice(0, MAX_RECENT).reverse().forEach((r) => strip.append(chip(r.outcome)));
    body.append(strip);
  }
  return root;
}
