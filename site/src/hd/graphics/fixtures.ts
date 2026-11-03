import type { Graphic } from '../../../../shared/bulletin';
import { el, shell, shortDate } from './common';

/** The most fixtures that fit; with only a couple they go big rather than leave the panel empty. */
const MAX_FIXTURES = 5;

/** Fixtures, a row each: the teams over the date and competition in gold. */
export function fixtures(g: Extract<Graphic, { type: 'fixtures' }>): HTMLElement {
  const { root, body } = shell('fixtures', g.title);
  const list = g.fixtures.slice(0, MAX_FIXTURES);
  if (list.length <= 2) root.classList.add('few');
  list.forEach((f, i) => {
    const row = el('div', 'fx');
    row.style.setProperty('--i', String(i));
    row.append(el('div', 'teams', `${f.home} V ${f.away}`), el('b', '', [shortDate(f.date), f.competition].filter(Boolean).join(' · ')));
    body.append(row);
  });
  return root;
}
