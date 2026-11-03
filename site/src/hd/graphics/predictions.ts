import type { Graphic } from '../../../../shared/bulletin';
import { el, shell } from './common';

/** The most pundits side by side. */
const MAX_PICKS = 4;

/** The pundits' picks for a fixture: a column each, the name in gold over the score, with their record under it. */
export function predictions(g: Extract<Graphic, { type: 'predictions' }>): HTMLElement {
  const { root, body } = shell('predictions', 'PREDICTIONS');
  body.append(el('div', 'fixture', g.fixture));
  const picks = el('div', 'picks');
  g.picks.slice(0, MAX_PICKS).forEach((p, i) => {
    const col = el('div', 'pick');
    col.style.setProperty('--i', String(i));
    col.append(el('b', '', p.name), el('div', 'score', p.pick));
    if (p.record) col.append(el('span', '', p.record));
    picks.append(col);
  });
  body.append(picks);
  return root;
}
