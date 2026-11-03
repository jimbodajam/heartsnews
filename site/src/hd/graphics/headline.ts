import type { Graphic } from '../../../../shared/bulletin';
import { el, picture, shell } from './common';

/** A story: its portrait (or icon) beside the title, the source along the bottom. */
export function headline(g: Extract<Graphic, { type: 'headline' }>): HTMLElement {
  const { root, body } = shell('headline', 'LATEST');
  const row = el('div', 'row');
  row.append(picture(g.face, g.icon ?? 'ball'), el('div', 'title', g.title));
  body.append(row);
  if (g.source) body.append(el('div', 'src', `SOURCE: ${g.source}`));
  return root;
}
