import type { Graphic, TableRow } from '../../../../shared/bulletin';
import { el, shell, signed } from './common';

/** The most rows a table shows; a longer one is cut to the window around the highlighted team. */
const MAX_ROWS = 12;

/** Up to MAX_ROWS rows, keeping `highlight` in view. */
export function around(rows: readonly TableRow[], highlight: string, max = MAX_ROWS): readonly TableRow[] {
  if (rows.length <= max) return rows;
  const at = Math.max(0, rows.findIndex((r) => r.team === highlight));
  const from = Math.min(Math.max(0, at - Math.floor(max / 2)), rows.length - max);
  return rows.slice(from, from + max);
}

/** A league table, our row in maroon, the rows dropping in one at a time. */
export function table(g: Extract<Graphic, { type: 'table' }>): HTMLElement {
  const { root, body } = shell('table', g.title);
  const head = el('div', 'tr th');
  for (const t of ['', 'TEAM', 'P', 'GD', 'PTS']) head.append(el('span', '', t));
  body.append(head);
  around(g.rows, g.highlight).forEach((r, i) => {
    const row = el('div', `tr${r.team === g.highlight ? ' me' : ''}`);
    row.style.setProperty('--i', String(i));
    for (const t of [String(r.pos), r.team, String(r.played), signed(r.gd), String(r.pts)]) row.append(el('span', '', t));
    body.append(row);
  });
  return root;
}
