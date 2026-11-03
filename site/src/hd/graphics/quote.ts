import type { Graphic } from '../../../../shared/bulletin';
import { el, picture, shell } from './common';

/** Past this many characters the words go smaller so the whole quote fits. */
const LONG = 150;

/** A quote: the speaker in the title bar (as SD: the panel's foot is often under the captions), their portrait or a big quote mark, the words. */
export function quote(g: Extract<Graphic, { type: 'quote' }>): HTMLElement {
  const { root, body } = shell('quote', `IN QUOTES: ${g.author}`);
  if (g.text.length > LONG) root.classList.add('long');
  const row = el('div', 'row');
  row.append(g.face ? picture(g.face, 'chat') : el('div', 'mark', '"'), el('div', 'text', g.text));
  body.append(row);
  return root;
}
