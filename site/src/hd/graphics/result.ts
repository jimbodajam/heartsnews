import type { Graphic } from '../../../../shared/bulletin';
import { el, shell, status as statusNote } from './common';

/** Scorers listed under each side before the rest go into "+N MORE". */
const MAX_SCORERS = 4;

/** A score: the competition and status in the bar (a live one blinks red), each side's name and scorers either side of it. */
export function result(g: Extract<Graphic, { type: 'result' }>): HTMLElement {
  const status = g.status ?? 'FULL TIME';
  const { root, body } = shell('result', g.competition, statusNote(status));
  const side = (name: string, scorers: readonly string[] = []) => {
    const col = el('div', 'side');
    col.append(el('div', 'team', name));
    const list = el('div', 'scorers');
    const shown = scorers.length > MAX_SCORERS ? scorers.slice(0, MAX_SCORERS - 1) : scorers;
    for (const s of shown) list.append(el('div', '', s));
    if (shown.length < scorers.length) list.append(el('div', 'more', `+${scorers.length - shown.length} MORE`));
    col.append(list);
    return col;
  };
  body.append(side(g.home, g.homeScorers), el('div', 'score', `${g.homeScore}-${g.awayScore}`), side(g.away, g.awayScorers));
  return root;
}
