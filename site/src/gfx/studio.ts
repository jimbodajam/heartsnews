import { drawText, drawTextCentred, measure } from './font';
import { drawHeart } from './icons';
import { C, shade } from './palette';
import { ditherV, frame, H, offscreen, rect, W, type Ctx } from './screen';

// Static backgrounds are drawn pixel by pixel once, then cached as images.
const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, draw: (g: Ctx) => void): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = offscreen(W, H, draw);
    cache.set(key, c);
  }
  return c;
}

function stripes(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  for (let k = -h; k < w; k += 10) {
    for (let j = 0; j < h; j++) {
      const px = x + k + j;
      if (px >= x && px < x + w - 1) rect(g, px, y + j, 2, 1, color);
    }
  }
}

function filledCircle(g: Ctx, cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
  }
}

/** Pixel line (Bresenham). */
export function line(g: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  g.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** The main studio: navy walls, a 3×2 video wall and light pillars. `pan` shifts the set for close-ups. */
export function drawDeskBackground(g: Ctx, pan: number): void {
  g.drawImage(
    cached(`desk:${pan}`, (o) => {
      ditherV(o, 0, 0, W, 104, [C.navyDark, C.navy, C.navyLight]);
      rect(o, 0, 104, W, H - 104, C.navyDark);
      for (let x = 8; x < W; x += 24) {
        rect(o, x, 2, 4, 1, C.white);
        rect(o, x - 1, 3, 6, 1, shade(C.white, -0.5));
      }
      for (const px of [10 - pan / 2, 302 - pan / 2]) {
        rect(o, px, 16, 8, 88, C.navyLight);
        for (let y = 20; y < 100; y += 6) rect(o, px + 3, y, 2, 2, C.blue);
      }
      const vx = 38 - pan;
      const vy = 12;
      rect(o, vx - 2, vy - 2, 247, 74, C.black);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const sx = vx + i * 81;
          const sy = vy + j * 35;
          ditherV(o, sx, sy, 79, 33, [C.maroonDark, C.maroon, C.maroonLight]);
          if (i !== 1) stripes(o, sx, sy, 79, 33, shade(C.maroonLight, 0.08));
        }
      }
      drawHeart(o, vx + 81 + 40 - 10, vy + 6, 3, C.gold);
      drawTextCentred(o, 'HEARTS NEWS 24', vx + 81 + 40, vy + 35 + 14, C.white);
    }),
    0,
    0,
  );
}

/** The presenters' desk: a light worktop over a maroon front with the channel logo. */
export function drawDesk(g: Ctx, y0: number, x0: number, x1: number): void {
  const w = x1 - x0;
  rect(g, x0, y0, w, 1, C.white);
  rect(g, x0, y0 + 1, w, 5, C.light);
  rect(g, x0, y0 + 6, w, 1, C.grey);
  rect(g, x0 + 10, y0 + 7, w - 20, H - y0 - 7, C.maroon);
  rect(g, x0 + 10, y0 + 7, w - 20, 1, C.maroonDark);
  rect(g, x0 + 10, y0 + 11, w - 20, 2, C.gold);
  const cx = x0 + w / 2;
  const tw = measure('HN24', 2);
  drawHeart(g, cx - (tw + 18) / 2, y0 + 18, 2, C.gold);
  drawText(g, 'HN24', cx - (tw + 18) / 2 + 18, y0 + 19, C.white, 2);
}

/** Hands resting on the desk in front of a seated presenter. */
export function drawHands(g: Ctx, cx: number, deskY: number, s: number, skin: string): void {
  rect(g, cx - 10 * s, deskY - s, 3 * s, 2 * s, skin);
  rect(g, cx + 7 * s, deskY - s, 3 * s, 2 * s, skin);
}

export function drawTransferBackground(g: Ctx): void {
  g.drawImage(
    cached('transfer', (o) => {
      ditherV(o, 0, 0, W, H, [C.black, '#1d1a22', '#2a2630']);
      for (let x = 0; x < W; x++) for (let y = 0; y < 5; y++) if (((x + y) >> 2) % 2) rect(o, x, y, 1, 1, C.gold);
      rect(o, 0, 5, W, 1, C.goldDark);
      rect(o, 0, 128, W, H - 128, '#141218');
      for (let x = 0; x < W; x += 16) rect(o, x, 128, 8, 1, '#2a2630');
      filledCircle(o, 112, 38, 11, C.goldDark);
      filledCircle(o, 112, 38, 10, C.white);
      for (let h = 0; h < 12; h++) {
        const a = (h / 12) * Math.PI * 2;
        rect(o, 112 + Math.round(Math.sin(a) * 8), 38 - Math.round(Math.cos(a) * 8), 1, 1, C.ink);
      }
    }),
    0,
    0,
  );
}

/** Ticking wall clock in the Transfer Centre (deadline-day feel). */
export function drawWallClock(g: Ctx, now: Date): void {
  const cx = 112;
  const cy = 38;
  const m = now.getMinutes() + now.getSeconds() / 60;
  const h = (now.getHours() % 12) + m / 60;
  const s = now.getSeconds();
  const hand = (frac: number, len: number, color: string) => {
    const a = frac * Math.PI * 2;
    line(g, cx, cy, cx + Math.sin(a) * len, cy - Math.cos(a) * len, color);
  };
  hand(h / 12, 4, C.ink);
  hand(m / 60, 7, C.ink);
  hand(s / 60, 8, C.red);
}

export function drawPodium(g: Ctx, cx: number, y0: number, label: string): void {
  rect(g, cx - 34, y0, 68, 1, C.white);
  rect(g, cx - 34, y0 + 1, 68, 4, C.light);
  rect(g, cx - 30, y0 + 5, 60, H - y0 - 5, '#2a2630');
  rect(g, cx - 30, y0 + 9, 60, 2, C.gold);
  drawTextCentred(g, label, cx, y0 + 16, C.gold);
}

export function drawTouchBackground(g: Ctx): void {
  g.drawImage(
    cached('touch', (o) => {
      ditherV(o, 0, 0, W, 138, [C.navyDark, C.navy, C.navyLight]);
      rect(o, 0, 138, W, H - 138, '#15172a');
      for (let x = 4; x < W; x += 20) rect(o, x, 141, 10, 1, C.navyLight);
      rect(o, 8, 28, 212, 92, C.black);
      frame(o, 9, 29, 210, 90, C.dark);
      rect(o, 112, 120, 4, 18, C.dark);
      rect(o, 96, 136, 36, 2, C.dark);
      for (let x = 236; x < W; x += 28) rect(o, x, 12, 2, 120, C.navyLight);
    }),
    0,
    0,
  );
}

export function drawGraphicBackground(g: Ctx): void {
  g.drawImage(
    cached('graphic', (o) => {
      ditherV(o, 0, 0, W, H, [C.maroonDark, C.maroon, C.maroonDark]);
      stripes(o, 0, 0, W, H, shade(C.maroon, 0.06));
    }),
    0,
    0,
  );
}

/** Screen filler when a big screen has nothing specific to show. */
export function drawIdleScreen(g: Ctx, x: number, y: number, w: number, h: number, label: string): void {
  ditherV(g, x, y, w, h, [C.maroonDark, C.maroon]);
  frame(g, x, y, w, h, C.gold);
  drawHeart(g, x + w / 2 - 14, y + h / 2 - 22, 4, C.gold);
  drawTextCentred(g, label, x + w / 2, y + h / 2 + 8, C.white, 2);
}
