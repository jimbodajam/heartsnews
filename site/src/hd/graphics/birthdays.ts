import type { Graphic } from '../../../../shared/bulletin';
import { el, shell } from './common';

/** The most rows shown. */
const MAX_ROWS = 8;

/** On This Day: a row per player born today, like the table, with the one getting the package in maroon. */
export function birthdays(g: Extract<Graphic, { type: 'birthdays' }>): HTMLElement {
  const { root, body } = shell('birthdays', g.title);
  const head = el('div', 'tr th');
  for (const t of ['PLAYER', '', 'APPS', 'GLS']) head.append(el('span', '', t));
  body.append(head);
  g.rows.slice(0, MAX_ROWS).forEach((r, i) => {
    const row = el('div', `tr${r.star ? ' me' : ''}`);
    row.style.setProperty('--i', String(i));
    for (const [cls, t] of [['', r.name], ['yr', r.years], ['', String(r.apps)], ['', String(r.goals)]]) row.append(el('span', cls, t));
    body.append(row);
  });
  return root;
}
