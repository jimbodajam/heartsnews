import type { Graphic } from '../../../../shared/bulletin';
import { el, FACE_EM, picture, type Place, shell, shirt } from './common';

/** The most substitutes shown: two columns of six beside the presenter, two rows of six full screen. */
const MAX_PLAYERS = 12;

/**
 * The substitutes. Beside the presenter, two columns as SD: a small portrait (or a shirt with the number), the number and
 * the name. Full screen, a grid of cards: the portrait over the number and name.
 */
export function bench(g: Extract<Graphic, { type: 'bench' }>, place: Place): HTMLElement {
  const { root, body } = shell('bench', `BENCH: ${g.team}`);
  const list = g.players.slice(0, MAX_PLAYERS);
  const full = place === 'full';
  // Column-first beside the presenter, like the SD panel.
  if (!full) body.style.setProperty('--rows', String(Math.max(1, Math.ceil(list.length / 2))));
  else body.style.setProperty('--cols', String(Math.min(6, Math.max(3, Math.ceil(list.length / 2)))));
  list.forEach((p, i) => {
    const row = el('div', 'sub');
    row.style.setProperty('--i', String(i));
    const num = p.number !== undefined ? String(p.number) : '';
    row.append(picture(p.face, shirt(p.number), FACE_EM * (full ? 0.55 : 0.32)), el('b', '', num), el('span', '', p.name));
    body.append(row);
  });
  return root;
}
