import { drawText, drawTextCentred, measure } from './font';
import { C } from './palette';
import { clamp01, offscreen, rect, W, H, type Ctx } from './screen';

const easeOut = (v: number) => 1 - (1 - v) ** 3;

// Marshall's Chunky Chicken, the long-gone club sponsor: a red card with a pink heart-shaped badge round a yellow sunburst
// and a chicken's head. Affectionate parody, redrawn in the canvas.
const RED = '#c8281e';
const RED_DARK = '#8c1a14';
const RED_LIGHT = '#d9473a';
const PINK = '#f0a29a';
const YELLOW = '#f6d630';
const ORANGE = '#f08a24';
const LOGO_RED = '#8c0e0f';
const LOGO_RAY = '#b02222';

/** Which break-in the sponsor card is for. */
export type SponsorKind = 'open' | 'in' | 'out';
const TAG: Record<SponsorKind, string> = { open: 'HEARTS NEWS 24', in: 'BACK AFTER THIS', out: 'WELCOME BACK' };

const HEAD = [
  '.....k.kk.k.....',
  '....kkkkkkkk....',
  '....kkkkkkkk....',
  '...kkkkkkkkkk...',
  '...kkkekkkkkbb..',
  '...kkkkkkkkbbbb.',
  '...kkkkkkkkkbb..',
  '....kkkkkkkkww..',
  '....kkkkkkkkww..',
  '...kkkkkkkkkw...',
  '..kkkkkkkkkkk...',
  '.kkkkkkkkkkkkk..',
  '.kkkkkkkkkkkkk..',
  'kkkkkkkkkkkkkkk.',
  '................',
  '................',
];
const HEAD_INK: Record<string, string> = { k: RED_DARK, e: YELLOW, b: ORANGE, w: RED };

/** The 16×16 chicken head at 3×, top-left at (x, y). */
function drawChickenHead(g: Ctx, x: number, y: number): void {
  HEAD.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== '.') rect(g, x + i * 3, y + j * 3, 3, 3, HEAD_INK[ch]);
    }),
  );
}

/** A filled pixel disc, row by row so the edge is crisp. */
function disc(g: Ctx, cx: number, cy: number, r: number, color: string): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.round(Math.sqrt(r * r - y * y));
    rect(g, cx - half, cy + y, half * 2, 1, color);
  }
}

const hearts = new Map<string, HTMLCanvasElement>();
/** A smooth heart (the classic implicit curve) of half-width about 1.2k, cached per size and colour, with its centre at (k*1.3, k*1.4). */
function heart(g: Ctx, cx: number, cy: number, k: number, color: string): void {
  const key = `${k}|${color}`;
  let c = hearts.get(key);
  if (!c) {
    const w = Math.ceil(k * 2.6);
    const h = Math.ceil(k * 2.6);
    c = offscreen(w, h, (o) => {
      o.fillStyle = color;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = (x - w / 2) / k;
          const v = -(y - k * 1.45) / k;
          if ((u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0) o.fillRect(x, y, 1, 1);
        }
      }
    });
    hearts.set(key, c);
  }
  g.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - k * 1.45));
}

/**
 * The sponsor card. `age` is ms since it came on; `jingle` is ms since the jingle started (negative before it does), when the
 * badge bounces and the sunburst spins up.
 */
export function drawSponsor(g: Ctx, age: number, jingle: number, kind: SponsorKind, logo?: HTMLImageElement): void {
  const pop = easeOut(clamp01(age / 350));
  // The painted logo's own deep red, when we have it, so the badge sits straight on the card.
  rect(g, 0, 0, W, H, logo ? LOGO_RED : RED);
  // Sunburst rays behind the badge, turning slowly.
  const spin = age / (jingle >= 0 ? 500 : 2400);
  g.fillStyle = logo ? LOGO_RAY : RED_LIGHT;
  g.globalAlpha = 0.5;
  for (let i = 0; i < 24; i += 2) {
    const a0 = spin + (i / 24) * Math.PI * 2;
    const a1 = spin + ((i + 1) / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(W / 2, 70);
    g.lineTo(W / 2 + Math.cos(a0) * 360, 70 + Math.sin(a0) * 360);
    g.lineTo(W / 2 + Math.cos(a1) * 360, 70 + Math.sin(a1) * 360);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;

  rect(g, 0, 0, W, 16, RED_DARK);
  rect(g, 0, 16, W, 1, YELLOW);
  drawTextCentred(g, TAG[kind], W / 2, 5, YELLOW);

  // The badge drops in, then bobs on the jingle's beat.
  const bob = jingle >= 0 ? Math.round(Math.abs(Math.sin(jingle / 177)) * -4) : 0;
  const cx = W / 2;
  if (logo) {
    g.drawImage(logo, cx - 64, 24 + Math.round((1 - pop) * -150) + bob, 128, 128);
    if (age > 900) drawTextCentred(g, 'CHAMPION CHICKEN', W / 2, 164, YELLOW);
    return;
  }
  const cy = 66 + Math.round((1 - pop) * -60) + bob;
  heart(g, cx, cy, 37, PINK);
  heart(g, cx, cy, 31, RED);
  disc(g, cx, cy - 6, 27, YELLOW);
  // A broken ring of dashes round the disc.
  const ring = jingle >= 0 ? age / 120 : age / 600;
  for (let i = 0; i < 20; i++) {
    const a = ring + (i / 20) * Math.PI * 2;
    if (i % 2) rect(g, Math.round(cx + Math.cos(a) * 33) - 1, Math.round(cy - 6 + Math.sin(a) * 33) - 1, 3, 3, ORANGE);
  }
  drawChickenHead(g, cx - 24, cy - 24);

  // The name, in lettering that gets a bounce of its own on the jingle.
  const nameIn = easeOut(clamp01((age - 250) / 300));
  const bounce = jingle >= 0 ? (Math.floor(jingle / 150) % 2 ? 1 : 0) : 0;
  const y1 = 118 + Math.round((1 - nameIn) * 40);
  const word = "MARSHALL'S";
  const x1 = Math.round(W / 2 - measure(word, 3) / 2);
  drawText(g, word, x1 + 1, y1 + 1 - bounce, RED_DARK, 3);
  drawText(g, word, x1, y1 - bounce, YELLOW, 3);
  drawTextCentred(g, 'CHUNKY CHICKEN', W / 2, y1 + 24, C.white, 2);
  if (age > 900) drawTextCentred(g, 'CHAMPION CHICKEN', W / 2, 166, YELLOW);
}
