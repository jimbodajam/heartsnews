import type { Graphic } from '../../../../shared/bulletin';
import { el, shell } from './common';

type Status = Extract<Graphic, { type: 'transfer' }>['status'];

/** The status stamp's words (its colour is in graphics.css, as SD's). */
const STATUS: Record<Status, string> = { rumour: 'RUMOUR', talks: 'IN TALKS', medical: 'MEDICAL', done: 'DONE DEAL' };

/** A move: the player, from one club to the other, the status stamped in its colour (a done deal flashes) and the fee. */
export function transfer(g: Extract<Graphic, { type: 'transfer' }>): HTMLElement {
  const { root, body } = shell('transfer', 'TRANSFER CENTRE');
  const move = el('div', 'move');
  move.append(el('div', 'club', g.from), el('div', 'arrow', '>'), el('div', 'club', g.to));
  body.append(el('div', 'player', g.player), move, el('div', `stamp ${g.status}`, STATUS[g.status]));
  if (g.fee) body.append(el('div', 'fee', `FEE: ${g.fee}`));
  return root;
}
