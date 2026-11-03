import type { Graphic } from '../../../../shared/bulletin';
import { el, FACE_EM, picture, type Place, shell, shirt } from './common';

/**
 * One player of the team sheet, big as the team news is read out: the portrait (or a shirt with the number), then the
 * number, first name, surname and position, with the armband and NEW (not in the last XI, blinking) as tags. The card
 * slides in from the right; one card after another keeps the panel up rather than wiping it again (GraphicBox).
 */
export function player(g: Extract<Graphic, { type: 'player' }>, place: Place): HTMLElement {
  const { root, body } = shell('player', g.team);
  const card = el('div', 'card');
  const parts = g.name.split(' ');
  const first = parts.length > 1 ? parts[0] : '';
  const surname = parts.length > 1 ? parts.slice(1).join(' ') : g.name;
  const info = el('div', 'info');
  if (g.number !== undefined) info.append(el('div', 'num', String(g.number)));
  if (first) info.append(el('div', 'first', first));
  info.append(el('div', 'sur', surname));
  if (g.position) info.append(el('div', 'pos', g.position));
  const tags = el('div', 'tags');
  if (g.captain) tags.append(el('span', 'cap', 'CAPTAIN'));
  if (g.isNew) tags.append(el('span', 'new', 'NEW'));
  if (tags.childElementCount) info.append(tags);
  // As big as the panel's height allows: full screen scales the text up by 1.3, so less of it in em.
  card.append(picture(g.face, shirt(g.number), FACE_EM * (place === 'full' ? 1.4 : 1.8)), info);
  body.append(card);
  return root;
}
