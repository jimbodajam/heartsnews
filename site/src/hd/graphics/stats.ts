import type { Graphic } from '../../../../shared/bulletin';
import { el, shell, status } from './common';

/** The most stat rows shown; the rest would sit under the captions. */
const MAX_ROWS = 7;

/**
 * Team stats under the score: the competition and status in the bar (a live one blinks red), the teams either side of the
 * score, then a row per stat with the numbers either side of its label and a bar split between the sides (home gold, away
 * light) growing in from each end as the row drops in.
 */
export function stats(g: Extract<Graphic, { type: 'stats' }>): HTMLElement {
  const { root, body } = shell('stats', g.competition, status(g.status));
  const head = el('div', 'score');
  head.append(el('span', 'team', g.home), el('b', '', `${g.homeScore}-${g.awayScore}`), el('span', 'team', g.away));
  body.append(head);
  g.rows.slice(0, MAX_ROWS).forEach((r, i) => {
    const val = (n: number) => (r.percent ? `${n}%` : String(n));
    const total = r.home + r.away;
    const row = el('div', 'stat');
    row.style.setProperty('--i', String(i));
    const bar = el('div', 'bar');
    const home = el('i', 'h');
    const away = el('i', 'a');
    home.style.width = `${total > 0 ? (r.home / total) * 100 : 0}%`;
    away.style.width = `${total > 0 ? (r.away / total) * 100 : 0}%`;
    bar.append(home, away);
    row.append(el('span', '', val(r.home)), el('span', 'lbl', r.label), el('span', '', val(r.away)), bar);
    body.append(row);
  });
  return root;
}
