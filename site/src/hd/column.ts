// The HD side column (#87): the spike's sliding table / fixtures column (pixel-broadcast-spike.html #side), fed by
// bulletin.sidebar. It slides in from the right over the studio, which moves left to make room.

import type { Sidebar } from '../../../shared/bulletin';
import { countdown, el, isToday, signed } from './graphics/common';

/** Art px the studio moves left while the column is in (as the spike). */
export const COLUMN_SHIFT = 58;
/** How long each pane stays before the next. */
const PANE_MS = 9000;
/** A slide in or out, in steps like the stack's wipes. */
const SLIDE_MS = 400;
const SLIDE_STEPS = 8;

/** The panes the sidebar has: the table, today's result if there is one, and what's next with the last result. */
function buildPanes(sb: Sidebar, now: number): HTMLElement[] {
  const panes: HTMLElement[] = [];
  const pane = (title: string) => {
    const p = el('div', 'pane');
    p.append(el('h2', '', title));
    panes.push(p);
    return p;
  };

  if (sb.table?.length) {
    const p = pane(sb.tableTitle ? `${sb.tableTitle} TABLE` : 'LEAGUE TABLE');
    const head = el('div', 'row hd');
    for (const t of ['', '', 'P', 'PTS', 'GD']) head.append(el('span', '', t));
    p.append(head);
    for (const r of sb.table) {
      const row = el('div', `row${r.team === sb.highlight ? ' me' : ''}`);
      for (const t of [String(r.pos), r.team, String(r.played), String(r.pts), signed(r.gd)]) row.append(el('span', '', t));
      p.append(row);
    }
  }

  const last = sb.last;
  const today = Boolean(last && isToday(last.date, new Date(now)));
  if (last && today) {
    const p = pane('FULL TIME');
    const res = el('div', 'res');
    res.append(
      el('div', `team${last.home === sb.highlight ? ' me' : ''}`, last.home),
      el('div', 'score', `${last.homeScore}-${last.awayScore}`),
      el('div', `team${last.away === sb.highlight ? ' me' : ''}`, last.away),
      el('b', '', last.competition),
    );
    p.append(res);
  }

  if (sb.next || (last && !today)) {
    const p = pane('COMING UP');
    const fx = el('div', 'fx');
    const teams = (home: string, away: string, mid = 'V') => {
      const t = el('span');
      t.append(el('span', home === sb.highlight ? 'me' : '', home), ` ${mid} `, el('span', away === sb.highlight ? 'me' : '', away));
      return t;
    };
    if (sb.next) {
      const n = el('div');
      n.append(el('b', '', countdown(sb.next.date, now)), teams(sb.next.home, sb.next.away), el('i', '', sb.next.competition));
      fx.append(n);
    }
    if (last && !today) {
      const r = el('div');
      r.append(el('b', '', 'LAST RESULT'), teams(last.home, last.away, `${last.homeScore}-${last.awayScore}`), el('i', '', last.competition));
      fx.append(r);
    }
    p.append(fx);
  }
  return panes;
}

/**
 * The column and its panes. `update` each frame says whether it's wanted; it slides in or out over SLIDE_MS (or cuts,
 * with the camera), rotates its panes every PANE_MS while it's up, and returns how far in it is (0 to 1, in steps) for
 * the studio to move by. S toggles it (`on`).
 */
export class SideColumn {
  /** The viewer's switch (S). */
  on = true;
  private readonly root: HTMLElement;
  private panes: HTMLElement[] = [];
  private pane = 0;
  private paneAt = 0;
  private key = '';
  /** How far in it is, and what was last drawn. */
  private p = 0;
  private drawn = -1;
  private last?: number;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'col');
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** `want`: the frame has room for it (no graphic of its own). `cut`: the camera has just cut, so it does too. */
  update(sb: Sidebar | undefined, want: boolean, now: number, cut: boolean): number {
    if (sb) this.build(sb);
    const target = this.on && want && this.panes.length ? 1 : 0;
    const dt = Math.min(now - (this.last ?? now), 100);
    this.last = now;
    if (cut) this.p = target;
    else if (this.p < target) this.p = Math.min(target, this.p + dt / SLIDE_MS);
    else if (this.p > target) this.p = Math.max(target, this.p - dt / SLIDE_MS);
    const q = Math.round(this.p * SLIDE_STEPS) / SLIDE_STEPS;

    if (q > 0 && this.drawn <= 0) this.paneAt = now;
    if (q > 0 && now - this.paneAt > PANE_MS && this.panes.length > 1) {
      this.paneAt = now;
      this.showPane(this.pane + 1);
    }
    if (q !== this.drawn) {
      this.drawn = q;
      this.root.hidden = q === 0;
      this.root.style.transform = `translateX(${Math.round((1 - q) * 100)}%)`;
    }
    return q;
  }

  /** Off screen at once, e.g. under another view. */
  hide(now: number): void {
    this.update(undefined, false, now, true);
  }

  /** The panes again when the sidebar changes, or once a minute for the countdown. */
  private build(sb: Sidebar): void {
    const key = `${JSON.stringify(sb)}|${Math.floor(Date.now() / 60_000)}`;
    if (key === this.key) return;
    this.key = key;
    this.panes = buildPanes(sb, Date.now());
    this.root.replaceChildren(...this.panes);
    this.showPane(this.pane);
  }

  private showPane(i: number): void {
    this.pane = this.panes.length ? i % this.panes.length : 0;
    this.panes.forEach((p, k) => p.classList.toggle('on', k === this.pane));
  }
}
