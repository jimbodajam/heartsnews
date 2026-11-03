import type { Graphic } from '../../../../shared/bulletin';
import { chip, el, shell } from './common';

/** The most results shown. */
const MAX_RESULTS = 6;

/** A team's recent results, a row each: the W/D/L in its colour, the score and who against ("V" at home, "AT" away). */
export function form(g: Extract<Graphic, { type: 'form' }>): HTMLElement {
  const list = g.results.slice(0, MAX_RESULTS);
  const { root, body } = shell('form', `${g.team}: LAST ${g.results.length}`);
  list.forEach((r, i) => {
    const row = el('div', 'res');
    row.style.setProperty('--i', String(i));
    row.append(chip(r.outcome), el('b', '', r.score), el('span', '', `${r.venue === 'H' ? 'V' : 'AT'} ${r.against}`));
    body.append(row);
  });
  return root;
}
