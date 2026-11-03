import type { Graphic } from '../../../../shared/bulletin';
import { el, type Place, shell } from './common';

/** "Lawrence Shankland" to "Shankland": beside the presenter there's only room for the surname. */
const surname = (name: string) => name.split(' ').pop() ?? name;

/**
 * A starting XI on a pitch attacking left to right, a column per line of the formation from the keeper forwards, a shirt
 * and name for each (ours in maroon, theirs in grey, the changes in gold). Full screen shows the names in full.
 */
export function formation(g: Extract<Graphic, { type: 'formation' }>, place: Place): HTMLElement {
  const changes = new Set(g.changes ?? []);
  const key = changes.size ? el('span', 'key') : undefined;
  if (key) key.append(el('i'), 'CHANGE');
  const { root, body } = shell('formation', `${g.label}: ${g.team} ${g.formation}`, key);
  if (g.ours) root.classList.add('ours');
  const pitch = el('div', 'pitch');
  pitch.style.setProperty('--cols', String(Math.max(1, g.rows.length)));
  for (const m of ['half', 'circle', 'box l', 'box r']) pitch.append(el('i', m));
  let n = 0;
  g.rows.forEach((row, i) => {
    row.forEach((name, j) => {
      const p = el('div', `pl${changes.has(name) ? ' new' : ''}`);
      p.style.left = `${((i + 0.5) / g.rows.length) * 100}%`;
      p.style.top = `${((j + 0.5) / row.length) * 100}%`;
      p.style.setProperty('--i', String(n++));
      p.append(el('b'), el('span', '', place === 'full' ? name : surname(name)));
      pitch.append(p);
    });
  });
  body.append(pitch);
  return root;
}
