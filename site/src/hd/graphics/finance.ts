import type { Graphic } from '../../../../shared/bulletin';
import { el, shell } from './common';

type Finance = Extract<Graphic, { type: 'finance' }>;

/**
 * A club finance story's checked figures (#100): a tile for each with its label, the big value, an arrow when the article
 * compares it to an earlier figure and "WAS …" under it. Two figures stack in a column, three or four make a 2×2 grid.
 * The arrow is always gold: whether up is good depends on the figure, and the card doesn't editorialise.
 */
export function finance(g: Finance): HTMLElement {
  const { root, body } = shell('finance', g.title);
  const tiles = el('div', `tiles n${g.figures.length}`);
  g.figures.forEach((f, i) => {
    const tile = el('div', 'tile');
    tile.style.setProperty('--i', String(i));
    const value = el('b', 'val', f.value);
    if (f.trend) value.append(el('i', `trend ${f.trend}`, f.trend === 'up' ? '▲' : '▼'));
    tile.append(el('span', 'lbl', f.label), value);
    if (f.previous) tile.append(el('span', 'was', `WAS ${f.previous}`));
    tiles.append(tile);
  });
  body.append(tiles, el('div', 'src', [g.period, g.source].filter(Boolean).join(' · ')));
  return root;
}
