import { drawText, drawTextCentred, fit, measure, wrap } from './font';
import { drawHeart, drawIcon } from './icons';
import { C } from './palette';
import { clamp01, ditherV, offscreen, rect, W, H, type Ctx } from './screen';

const easeOut = (v: number) => 1 - (1 - v) ** 3;

export const CAPTION_BOTTOM = 125;
export const HEADLINE_Y = 150;
export const TICKER_Y = 166;

/** Channel logo, top left. */
export function drawBug(g: Ctx, name: string, demo: boolean): void {
  const w = measure(name) + 17;
  rect(g, 4, 4, w, 11, C.maroon);
  rect(g, 4, 15, w, 1, C.gold);
  drawHeart(g, 6, 6, 1, C.gold);
  drawText(g, name, 15, 7, C.white);
  if (demo) {
    const label = 'DEMO BULLETIN';
    rect(g, 4, 18, measure(label) + 6, 9, C.gold);
    drawText(g, label, 7, 20, C.ink);
  }
}

/** "LIVE" badge and clock, top right. */
export function drawClock(g: Ctx, now: Date, t: number): void {
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const w = measure(time) + 8;
  const x = W - 4 - w;
  rect(g, x, 4, w, 11, C.black);
  drawText(g, time, x + 4, 7, C.white);
  const lw = measure('LIVE') + 13;
  const lx = x - lw - 2;
  rect(g, lx, 4, lw, 11, C.red);
  if (t % 1.4 < 0.9) rect(g, lx + 3, 8, 3, 3, C.white);
  drawText(g, 'LIVE', lx + 9, 7, C.white);
}

/** Name strap that slides in when a presenter starts talking and slides away after a few seconds (or stays up). */
export function drawStrap(g: Ctx, name: string, role: string, age: number, visibleMs = 5000): void {
  if (age > visibleMs + 400) return;
  const inT = easeOut(clamp01(age / 350));
  const outT = easeOut(clamp01((age - visibleMs) / 400));
  const w = Math.max(measure(name) + 12, measure(role) + 12, 90);
  const x = 8 - (1 - inT) * (w + 10) - outT * (w + 10);
  rect(g, x, 128, w, 11, C.white);
  drawText(g, name, x + 6, 131, C.ink);
  rect(g, x, 139, w, 9, C.maroon);
  drawText(g, role, x + 6, 141, C.gold);
}

/** Gold headline bar with a segment label. */
export function drawHeadlineBar(g: Ctx, label: string, text: string): void {
  const lw = measure(label) + 10;
  rect(g, 0, HEADLINE_Y, W, 14, C.gold);
  rect(g, 0, HEADLINE_Y, lw, 14, C.maroon);
  drawText(g, label, 5, HEADLINE_Y + 5, C.white);
  drawText(g, fit(text, W - lw - 10), lw + 5, HEADLINE_Y + 5, C.ink);
}

/** A ticker item; `score` ones (the live match) stand out in gold. */
export interface TickerItem {
  text: string;
  score?: boolean;
}

/** How long the ticker flashes "GOAL" after the score changes. */
const GOAL_FLASH_MS = 8000;

/**
 * Scrolling news ticker along the bottom. It keeps its own scroll position so the items can change under it (the
 * live score's minute ticking over) without the text jumping.
 */
export class Ticker {
  private pos = 0;
  private last?: number;
  private goalAt = -Infinity;

  /** A goal: bring the first item (the score) to the front now and flash it. */
  goal(now: number): void {
    this.pos = 0;
    this.goalAt = now;
  }

  draw(g: Ctx, items: TickerItem[], now: number): void {
    // Capped so the ticker carries on where it was after an ad break rather than leaping ahead.
    this.pos += Math.min(now - (this.last ?? now), 100) * 0.032;
    this.last = now;
    const flashing = now - this.goalAt < GOAL_FLASH_MS;
    const blink = flashing && now % 500 < 250;

    rect(g, 0, TICKER_Y, W, H - TICKER_Y, C.black);
    rect(g, 0, TICKER_Y, W, 1, C.maroonLight);
    rect(g, 0, TICKER_Y + 1, 32, H - TICKER_Y - 1, blink ? C.gold : C.white);
    drawTextCentred(g, flashing ? 'GOAL' : 'NEWS', 16, TICKER_Y + 5, C.maroon);
    if (!items.length) return;
    const parts = items.map((it) => ({ ...it, text: `${it.text}  •  `, w: measure(`${it.text}  •  `) + 1 }));
    const period = parts.reduce((s, p) => s + p.w, 0);
    this.pos %= period;
    g.save();
    g.beginPath();
    g.rect(33, TICKER_Y + 1, W - 33, H - TICKER_Y);
    g.clip();
    for (let x = 34 - this.pos; x < W; ) {
      for (const p of parts) {
        if (x + p.w > 33 && x < W) drawText(g, p.text, x, TICKER_Y + 5, p.score ? (blink ? C.white : C.gold) : C.white);
        x += p.w;
      }
    }
    g.restore();
  }
}

/** Two-line subtitles that page through the line in step with the speech. */
export function drawCaption(g: Ctx, text: string, progress: number): void {
  const lines = wrap(text, W - 28);
  const target = progress * text.length;
  let seen = 0;
  let current = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    seen += lines[i].length + 1;
    if (seen > target) {
      current = i;
      break;
    }
  }
  const first = Math.floor(current / 2) * 2;
  const page = lines.slice(first, first + 2);
  const w = Math.max(...page.map((l) => measure(l))) + 10;
  const h = page.length * 8 + 4;
  const y = CAPTION_BOTTOM - h;
  g.globalAlpha = 0.85;
  rect(g, W / 2 - w / 2, y, w, h, C.black);
  g.globalAlpha = 1;
  page.forEach((l, i) => drawTextCentred(g, l, W / 2, y + 3 + i * 8, C.white));
}

let maroonBg: HTMLCanvasElement | undefined;
function drawMaroon(g: Ctx): void {
  maroonBg ??= offscreen(W, H, (o) => ditherV(o, 0, 0, W, H, [C.maroonDark, C.maroon, C.maroonLight, C.maroon, C.maroonDark]));
  g.drawImage(maroonBg, 0, 0);
}

function splitName(name: string): [string, string] {
  const m = /^(.*?)\s*(\d+)$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

/** Opening ident: the heart pops in, then the channel name types out. Lasts IDENT_MS. */
export const IDENT_MS = 3400;
export function drawIdent(g: Ctx, age: number, name: string): void {
  drawMaroon(g);
  const pop = clamp01(age / 500);
  const s = Math.max(1, Math.round(8 * (pop < 1 ? easeOut(pop) * 1.15 : 1)));
  drawHeart(g, W / 2 - (7 * s) / 2, 62 - 3 * s, s, C.gold);
  const [main, num] = splitName(name);
  const chars = Math.floor(clamp01((age - 600) / 900) * main.length);
  const total = measure(main, 3) + (num ? measure(` ${num}`, 3) : 0);
  const x = W / 2 - total / 2;
  const drawn = drawText(g, main.slice(0, chars), x, 108, C.white, 3);
  if (num && age > 1600) drawText(g, ` ${num}`, x + drawn, 108, C.gold, 3);
  if (age > 2100) drawTextCentred(g, 'ROLLING NEWS FROM GORGIE', W / 2, 134, C.light);
  if (age > IDENT_MS - 300) {
    g.globalAlpha = clamp01((age - (IDENT_MS - 300)) / 300);
    rect(g, 0, 0, W, H, C.black);
    g.globalAlpha = 1;
  }
}

/** Segment sting: a maroon panel sweeps across with the segment title. Lasts STING_MS. */
export const STING_MS = 1600;
export function drawSting(g: Ctx, age: number, label: string, title: string): void {
  const inT = easeOut(clamp01(age / 350));
  const outT = clamp01((age - (STING_MS - 350)) / 350);
  const x = -W + inT * W + outT * outT * W;
  g.save();
  g.translate(Math.round(x), 0);
  drawMaroon(g);
  rect(g, 0, 70, W, 2, C.gold);
  rect(g, 0, 108, W, 2, C.gold);
  drawTextCentred(g, label, W / 2, 78, C.gold);
  drawTextCentred(g, fit(title, W - 20, 2), W / 2, 90, C.white, 2);
  g.restore();
}

/**
 * What kind of break-in it is, for the sound: a goal (the same for either team, so it doesn't give the scorer away),
 * a red card, or calm news. The card itself looks the same for all of them.
 */
export type BreakingLook = 'goal' | 'red' | 'calm';
export const breakingLook = (flash: string): BreakingLook => (flash === 'GOAL' ? 'goal' : flash === 'RED CARD' ? 'red' : 'calm');

/**
 * Flash for a match event: a maroon card with the word stacked big on the left and a gold panel with the heart on the
 * right. The panel sweeps in with a white flash and a shake, the word types in, and the card wipes off to the right
 * into the reporter. Lasts BREAKING_MS.
 */
export const BREAKING_MS = 2800;
const WIPE_MS = 260;
/** Deeper than the channel's yellowy gold, closer to the club's metallic gold. */
const CARD_GOLD = '#c8932a';
const CARD_GOLD_LIGHT = '#dcaa40';
export function drawBreaking(g: Ctx, age: number, flash: string): void {
  const wipe = clamp01((age - (BREAKING_MS - WIPE_MS)) / WIPE_MS);
  g.save();
  if (wipe > 0) {
    g.beginPath();
    g.rect(Math.round(wipe * W), 0, W, H);
    g.clip();
  }
  // Shake that dies away over the first half second.
  const shake = Math.max(0, 1 - age / 500) * 5;
  g.translate(Math.round(Math.sin(age * 0.9) * shake), Math.round(Math.cos(age * 1.3) * shake * 0.6));
  rect(g, -8, -8, W + 16, H + 16, C.maroon);

  // The gold panel slides in from the right on a diagonal, with a white edge.
  const slide = Math.round((1 - easeOut(clamp01(age / 240))) * 140);
  // Drawn a row at a time so the diagonal stays pixel-crisp rather than anti-aliased.
  for (let y = 0; y < H; y++) {
    const x = Math.round(W * 0.86 - W * 0.24 * (y / H)) + slide;
    rect(g, x, y, W + 8 - x, 1, CARD_GOLD);
    rect(g, x + 16, y, 7, 1, CARD_GOLD_LIGHT);
    rect(g, x - 4, y, 4, 1, C.white);
  }
  // The heart beats.
  const big = Math.floor(age / 350) % 2 === 0;
  const hs = big ? 6 : 5;
  drawHeart(g, Math.round(285 + slide - 3.5 * hs), Math.round(82 - 3 * hs), hs, C.maroonDark);

  // The word, stacked a line per space, typing in once the panel has landed.
  const lines = flash.split(' ');
  let scale = 8;
  while (scale > 2 && Math.max(...lines.map((l) => measure(l, scale))) > 205) scale--;
  const lh = scale * 9;
  const top = Math.round(80 - ((lines.length - 1) * lh + 7 * scale) / 2);
  const total = lines.reduce((n, l) => n + l.length, 0);
  let left = Math.ceil(total * clamp01((age - 200) / 300));
  lines.forEach((l, i) => {
    const shown = l.slice(0, Math.max(0, left));
    left -= l.length;
    drawText(g, shown, 14, Math.round(top + i * lh + scale / 2), C.maroonDark, scale);
    drawText(g, shown, 12, top + i * lh, C.white, scale);
  });

  // Channel strip along the bottom.
  const stripY = H - Math.round(14 * easeOut(clamp01((age - 100) / 200)));
  rect(g, 0, stripY, W, H - stripY, C.maroonDark);
  rect(g, 0, stripY, W, 1, C.gold);
  drawHeart(g, 8, stripY + 3, 1, C.gold);
  drawText(g, 'HEARTS NEWS 24', 20, stripY + 4, C.white);
  g.restore();

  // White flash on impact, and a bright edge leading the wipe.
  if (age < 180) {
    g.globalAlpha = 1 - age / 180;
    rect(g, 0, 0, W, H, C.white);
    g.globalAlpha = 1;
  }
  if (wipe > 0 && wipe < 1) rect(g, Math.round(wipe * W) - 3, 0, 3, H, C.white);
}

export function drawSplash(g: Ctx, t: number, name: string, status: string): void {
  drawMaroon(g);
  drawHeart(g, W / 2 - 21, 30, 6, C.gold);
  const [main, num] = splitName(name);
  const total = measure(main, 3) + (num ? measure(` ${num}`, 3) : 0);
  const x = W / 2 - total / 2;
  const drawn = drawText(g, main, x, 82, C.white, 3);
  if (num) drawText(g, ` ${num}`, x + drawn, 82, C.gold, 3);
  if (t % 1.2 < 0.8) drawTextCentred(g, status, W / 2, 112, C.white, 2);
  drawTextCentred(g, 'M MUTE   C CAPTIONS   > SKIP   F FULLSCREEN   T RETRO TV', W / 2, 160, C.light);
}

/**
 * A phone-in caller on the line, in place of the headline bar: phone and a little audio wave on maroon, then
 * "DAVIE IN GORGIE" and what the call is about. The wave just moves; it isn't the caller's real voice.
 */
export function drawCallerBar(g: Ctx, name: string, from: string, topic: string, now: number, age: number): void {
  const label = `${name} IN ${from}`.toUpperCase();
  const lw = measure(label) + 40;
  const slide = easeOut(clamp01(age / 300));
  const y = HEADLINE_Y;
  rect(g, 0, y, W, 14, C.gold);
  rect(g, 0, y, Math.min(W, lw) * slide, 14, C.maroon);
  g.save();
  g.beginPath();
  g.rect(0, y, Math.min(W, lw) * slide, 14);
  g.clip();
  drawIcon(g, 'phone', 4, y + 3);
  // Five bars bobbing out of step, like a voice level.
  for (let i = 0; i < 5; i++) {
    const h = 2 + Math.round(5 * Math.abs(Math.sin(now / 130 + i * 1.7) * Math.sin(now / 410 + i)));
    rect(g, 16 + i * 3, y + 7 - Math.floor(h / 2), 2, h, C.gold);
  }
  drawText(g, label, 36, y + 5, C.white);
  g.restore();
  if (slide > 0.9) drawText(g, fit(topic.toUpperCase(), W - lw - 10), lw + 5, y + 5, C.ink);
}
