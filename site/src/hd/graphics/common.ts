// Pieces the native HD graphics (#87) share: elements, the panel shell, pictures and dates.

import type { IconId } from '../../../../shared/bulletin';
import { drawIcon } from '../../gfx/icons';

/** Where a graphic goes: beside the presenter in a close-up, or full screen over the dimmed studio. */
export type Place = 'beside' | 'full';

/** A portrait's width and height in frame em (1em = a hundredth of the frame), beside the presenter; full screen scales it with the text. One place to change it once the faces bake-off (#93) has decided. */
export const FACE_EM = 8;

/** Makes an element with a class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The panel every graphic sits in: a maroon title bar (with an optional right-hand note) over a body. Returns both. */
export function shell(type: string, title: string, note?: HTMLElement): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', `in g-${type}`);
  const bar = el('h2');
  bar.append(el('span', 't', title));
  if (note) bar.append(note);
  const body = el('div', 'body');
  root.append(bar, body);
  return { root, body };
}

/** One of the 8×8 story icons, as a canvas scaled up with crisp pixels. */
export function icon(id: IconId): HTMLCanvasElement {
  const c = el('canvas', 'icon');
  c.width = c.height = 8;
  const g = c.getContext('2d');
  if (g) drawIcon(g, id, 0, 0);
  return c;
}

/** A portrait (faces/<slug>.png) in a gold frame, or the icon when there's none or it won't load. */
export function picture(face: string | undefined, fallback: IconId): HTMLElement {
  const box = el('div', 'pic');
  box.style.setProperty('--face', `${FACE_EM}em`);
  const ico = icon(fallback);
  box.append(ico);
  if (face) {
    const img = el('img', 'face');
    img.alt = '';
    img.onload = () => ico.remove();
    img.onerror = () => img.remove();
    img.src = face;
    box.append(img);
  }
  return box;
}

const UK = 'Europe/London';

/** "SAT 1 NOV · 12:30" in UK time. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: UK });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK });
  return `${day.replace(',', '')} · ${time}`.toUpperCase();
}

/** Whether `iso` falls on today's UK date. */
export function isToday(iso: string | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: UK });
  return day(d) === day(now);
}

/** "KICK-OFF IN 2H 14M" inside a day, "IN PROGRESS" for a couple of hours after, else the date (as the SD panel). */
export function countdown(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return '';
  if (ms < 0) return ms > -2.25 * 3_600_000 ? 'IN PROGRESS' : shortDate(iso);
  if (ms < 24 * 3_600_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `KICK-OFF IN ${h ? `${h}H ` : ''}${m}M`;
  }
  return shortDate(iso);
}

/** "+5", "0", "-3". */
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
