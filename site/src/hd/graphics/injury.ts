import type { Graphic } from '../../../../shared/bulletin';
import { el, picture, shell } from './common';

type Injury = Extract<Graphic, { type: 'injury' }>;

/**
 * A player's injury record (#108): his portrait and name, the injury, a status chip (REPORTED beside it while only one
 * outlet has said it), then since when, the expected return and the games missed.
 */
export function injury(g: Injury): HTMLElement {
  const { root, body } = shell('injury', 'INJURY');
  const head = el('div', 'head');
  const who = el('div', 'who');
  who.append(el('b', 'name', g.name), el('span', 'what', g.injury));
  const chip = el('div', 'chips');
  chip.append(el('i', `status ${g.status.toLowerCase()}`, g.status));
  const note = [g.reported ? 'REPORTED' : '', g.kind ?? ''].filter(Boolean).join(' ');
  if (note) chip.append(el('span', 'note', note));
  who.append(chip);
  head.append(picture(g.face, 'medical'), who);
  const facts = el('div', 'facts');
  const rows: [string, string][] = [
    ['SINCE', g.since],
    ['DUE BACK', g.back],
    ...(g.gamesMissed != null ? [['MISSED', `${g.gamesMissed} ${g.gamesMissed === 1 ? 'game' : 'games'}`] as [string, string]] : []),
  ];
  for (const [label, value] of rows) {
    const row = el('div', 'fact');
    row.append(el('span', 'lbl', label), el('b', 'val', value));
    facts.append(row);
  }
  body.append(head, facts);
  return root;
}
