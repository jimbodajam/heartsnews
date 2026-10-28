import { drawHeart } from './icons';
import { C, shade } from './palette';
import { ditherV, offscreen, rect, W, H, type Ctx } from './screen';
import type { Weather } from '../../../shared/weather';

/** The ground our reporter is at: the home support's colours, and whether the floodlights are doing the work. */
export interface Ground {
  colours: [string, string];
  night: boolean;
  /** The weather at the ground, if we know it; without it the sky is the usual grey afternoon (or night). */
  weather?: Pick<Weather, 'sky' | 'windy'>;
}

/** The sky above the roof, top to bottom, by weather and whether the floodlights are on. */
const SKIES: Record<Weather['sky'], { day: string[]; night: string[] }> = {
  clear: { day: ['#5f94cf', '#86b0dc', '#b3cfe8'], night: ['#05060f', C.navyDark, '#1b2140'] },
  overcast: { day: ['#7d8ea3', '#a7b4c4', '#c3ccd6'], night: ['#0c0e1a', '#171b2e', '#262c45'] },
  rain: { day: ['#4f5b6b', '#6c7889', '#8993a1'], night: ['#0a0c16', '#141829', '#20263a'] },
  snow: { day: ['#aab3bf', '#c8cfd8', '#e4e8ee'], night: ['#1a1e30', '#2c3249', '#464e69'] },
  fog: { day: ['#b5bcc4', '#c9cfd5', '#dde1e5'], night: ['#202538', '#323850', '#454c68'] },
};

interface Fan {
  x: number;
  y: number;
  /** Size of one sprite pixel: back rows are small, front rows bigger. */
  s: number;
  shirt: string;
  skin: string;
  hat?: string;
  /** Holds a scarf up when cheering. */
  scarf: boolean;
  phase: number;
}

const SKINS = ['#f0c4a0', '#f0c4a0', '#e8b796', '#e6ad8c', '#d9a07c', '#c98e6a', '#8d5a3b', '#5c3a26'];
const JACKETS = ['#2a2630', '#3a3d4a', '#1b1f3a', '#4a3a2a', '#5a5f6e', '#26262e'];
/** Stairways down through the stand, where nobody sits. */
const AISLES = [[58, 66], [250, 258]];
/** Clear of the channel logo and the clock in the top corners. */
const PYLONS = [140, 228];
/** Back rows (small, under the roof), then front rows (bigger, nearer the camera): first y, last y, row and seat pitch. */
const BANDS = [
  { s: 1, from: 31, to: 60, row: 5, seat: 4 },
  { s: 2, from: 63, to: 104, row: 9, seat: 7 },
];

/** Small seeded random numbers, so the same ground always gets the same crowd. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sky = (gr: Ground) => gr.weather?.sky;
const keyOf = (gr: Ground) => `${gr.colours.join()}:${gr.night ? 'night' : 'day'}:${sky(gr) ?? 'usual'}`;

// The stand is drawn once per ground and cached; the crowd in front of it is drawn every frame so it can move.
const backgrounds = new Map<string, HTMLCanvasElement>();
const crowds = new Map<string, Fan[]>();

function background(gr: Ground): HTMLCanvasElement {
  const key = keyOf(gr);
  let c = backgrounds.get(key);
  if (c) return c;
  const [main] = gr.colours;
  c = offscreen(W, H, (o) => {
    // Sky above the roof: a dark winter night, or a grey Scottish afternoon, or whatever the weather is doing.
    const s = SKIES[sky(gr) ?? 'overcast'];
    const usual = sky(gr) === undefined;
    ditherV(o, 0, 0, W, 19, gr.night ? (usual ? SKIES.clear.night : s.night) : s.day);

    // Floodlight pylons rising above the roof, each with a bank of lamps.
    for (const px of PYLONS) {
      rect(o, px - 1, 10, 2, 10, C.dark);
      rect(o, px - 9, 1, 18, 10, C.dark);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) rect(o, px - 8 + i * 4, 2 + j * 4, 3, 3, gr.night ? '#fff6d8' : C.light);
      if (gr.night) {
        for (const [pad, a] of [[3, 0.22], [7, 0.12], [12, 0.06]] as const) {
          o.globalAlpha = a;
          rect(o, px - 9 - pad, 1 - pad, 18 + pad * 2, 10 + pad * 2, '#fff6d8');
        }
        o.globalAlpha = 1;
      }
    }

    // Roof fascia in the home colours, with lamps along its edge, then the shadow under the roof.
    rect(o, 0, 19, W, 6, '#2a2630');
    rect(o, 0, 21, W, 2, main);
    rect(o, 0, 25, W, 1, C.ink);
    for (let x = 6; x < W; x += 16) rect(o, x, 24, 4, 1, gr.night ? '#fff6d8' : C.grey);
    ditherV(o, 0, 26, W, 8, ['#141218', shade(main, -0.6)]);

    // Rows of seats in a dark shade of the home colour, a lighter step edge on each row.
    const seat = shade(main, -0.45);
    rect(o, 0, 34, W, H - 34, seat);
    for (const b of BANDS) for (let y = b.from; y <= b.to; y += b.row) rect(o, 0, y + b.row - 1, W, 1, shade(seat, -0.35));

    // Stairways with their steps.
    for (const [x0, x1] of AISLES) {
      rect(o, x0, 30, x1 - x0, H - 30, '#4a4d5a');
      for (let y = 32; y < H; y += 4) rect(o, x0, y, x1 - x0, 1, '#2f3240');
      rect(o, x0 + 3, 30, 1, H - 30, C.grey);
    }

    // Wet seats shine along each row's edge; snow settles on the roof, the lamp banks and the seat edges.
    if (sky(gr) === 'rain') {
      for (const b of BANDS) for (let y = b.from; y <= b.to; y += b.row) rect(o, 0, y + b.row - 2, W, 1, shade(seat, 0.18));
    } else if (sky(gr) === 'snow') {
      rect(o, 0, 19, W, 1, C.white);
      for (const px of PYLONS) rect(o, px - 9, 0, 18, 1, C.white);
      for (let x = 0; x < W; x += 3) rect(o, x, 25, 2, 1, C.light);
      for (const b of BANDS) for (let y = b.from; y <= b.to; y += b.row) rect(o, 0, y + b.row - 1, W, 1, C.light);
    }
  });
  backgrounds.set(key, c);
  return c;
}

function crowd(gr: Ground): Fan[] {
  const key = keyOf(gr);
  let fans = crowds.get(key);
  if (fans) return fans;
  const [main, second] = gr.colours;
  const rand = rng([...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  fans = [];
  for (const b of BANDS) {
    let odd = false;
    for (let y = b.from; y <= b.to; y += b.row, odd = !odd) {
      for (let x = (odd ? b.seat / 2 : 0) - 2; x < W; x += b.seat) {
        if (AISLES.some(([x0, x1]) => x + b.s * 3 > x0 && x - b.s < x1)) continue;
        // The odd empty seat at the back.
        if (b.s === 1 && rand() < 0.06) continue;
        const r = rand();
        fans.push({
          x: Math.round(x + (rand() - 0.5)),
          y,
          s: b.s,
          shirt: r < 0.55 ? main : r < 0.72 ? second : pick(JACKETS),
          skin: pick(SKINS),
          hat: rand() < 0.15 ? (rand() < 0.6 ? main : second) : undefined,
          scarf: rand() < 0.3,
          phase: rand() * 100,
        });
      }
    }
  }
  crowds.set(key, fans);
  return fans;
}

/**
 * The stand behind our reporter: floodlights, the roof, and the home support, who shuffle, bob up and down and now and
 * then get their arms (and scarves) in the air. `cheer` (0 to 1) makes them livelier, e.g. after a goal.
 */
export function drawStadium(g: Ctx, gr: Ground, t: number, cheer = 0.1): void {
  g.drawImage(background(gr), 0, 0);
  const [, second] = gr.colours;
  const bobAbove = 0.92 - cheer * 0.8;
  const armsAbove = 0.95 - cheer * 0.5;
  const wet = sky(gr) === 'rain' || sky(gr) === 'snow';
  const windy = gr.weather?.windy ?? false;
  for (const f of crowd(gr)) {
    const { s } = f;
    const bob = Math.sin(t * (2 + (f.phase % 1.5)) + f.phase) > bobAbove ? s : 0;
    const arms = Math.sin(t * 0.8 + f.phase * 3) > armsAbove;
    const y = f.y - bob;
    const headW = 2 * s;
    const bodyW = s === 1 ? 4 : 6;
    const bx = f.x - (bodyW - headW) / 2;
    rect(g, bx, y + headW, bodyW, s === 1 ? 4 : 7, f.shirt);
    rect(g, f.x, y, headW, headW, f.skin);
    if (f.hat) rect(g, f.x, y, headW, s, f.hat);
    if (wet) {
      // A hood up over the head for some of them.
      if ((f.phase * 7) % 1 < 0.45) rect(g, f.x - (s === 2 ? 1 : 0), y - 1, headW + (s === 2 ? 2 : 0), s + 1, shade(f.shirt, -0.3));
    }
    if (arms) {
      rect(g, bx, y - 2 * s, s, 3 * s, f.shirt);
      rect(g, bx + bodyW - s, y - 2 * s, s, 3 * s, f.shirt);
      rect(g, bx, y - 3 * s, s, s, f.skin);
      rect(g, bx + bodyW - s, y - 3 * s, s, s, f.skin);
      if (f.scarf) rect(g, bx + (windy ? Math.round(Math.sin(t * 6 + f.phase) * 1.5) : 0), y - 3 * s - 1, bodyW, s, second);
    }
  }
  // Phones going off in the crowd at night.
  if (gr.night) {
    const fans = crowd(gr);
    const tick = Math.floor(t * 5);
    for (let k = 0; k < 2; k++) {
      const f = fans[(tick * 7919 + k * 104729) % fans.length];
      rect(g, f.x + f.s, f.y + f.s, f.s, f.s, C.white);
    }
  }
  // Knocked back a little, as if slightly out of focus, so the reporter stands out against them.
  g.globalAlpha = 0.3;
  rect(g, 0, 26, W, H - 26, C.navyDark);
  g.globalAlpha = 1;
  drawWeather(g, gr, t);
}

/** A cheap repeatable 0–1 number for particle `i`, so the weather looks the same every frame it's at the same time. */
const unit = (i: number, salt: number) => {
  const n = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

/** What's falling or hanging in the air in front of the stand: rain, snow, or fog. */
function drawWeather(g: Ctx, gr: Ground, t: number): void {
  const sky = gr.weather?.sky;
  const windy = gr.weather?.windy ?? false;
  if (sky === 'rain') {
    // Streaks falling fast, leaning with the wind.
    const lean = windy ? 3 : 1;
    g.globalAlpha = 0.8;
    for (let i = 0; i < 140; i++) {
      const speed = 70 + unit(i, 1) * 40;
      const y = (unit(i, 2) * H + t * speed) % H;
      const x = (unit(i, 3) * W + y * (lean / 6)) % W;
      rect(g, x, y, 1, 3, gr.night ? '#9fb4d0' : '#c9d6e6');
      if (windy) rect(g, x + 1, y + 3, 1, 1, gr.night ? '#9fb4d0' : '#c9d6e6');
    }
    g.globalAlpha = 1;
  } else if (sky === 'snow') {
    // Flakes drifting down, sideways when it's windy.
    for (let i = 0; i < 70; i++) {
      const fall = 12 + unit(i, 1) * 12;
      const y = (unit(i, 2) * H + t * fall) % H;
      const x = (unit(i, 3) * W + Math.sin(t * 0.9 + i) * 4 + (windy ? t * 25 : 0)) % W;
      rect(g, x < 0 ? x + W : x, y, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1, C.white);
    }
  } else if (sky === 'fog') {
    // The back rows disappear into a bank of mist, thinning towards the front, and it slowly moves.
    const mist = gr.night ? '#5a6280' : '#dfe3e8';
    g.globalAlpha = 0.5;
    rect(g, 0, 26, W, 50, mist);
    g.globalAlpha = 0.25;
    rect(g, 0, 76, W, H - 76, mist);
    g.globalAlpha = 0.18;
    for (let i = 0; i < 6; i++) rect(g, ((unit(i, 4) * W + t * 3 * (1 + i / 6)) % (W + 80)) - 40, 30 + i * 22, 80, 10, mist);
    g.globalAlpha = 1;
  }
}

/** The press bench our reporter sits at, with his laptop. */
export function drawPressDesk(g: Ctx, y0: number): void {
  // The laptop lid, seen from behind, with our sticker on it.
  rect(g, 13, y0 - 18, 32, 18, C.ink);
  rect(g, 14, y0 - 17, 30, 17, '#8a8f9e');
  rect(g, 14, y0 - 17, 30, 1, C.light);
  drawHeart(g, 25, y0 - 12, 1, C.maroon);
  rect(g, 0, y0, W, 1, '#9aa0ad');
  rect(g, 0, y0 + 1, W, 4, '#6a707e');
  rect(g, 0, y0 + 5, W, 1, C.dark);
  rect(g, 0, y0 + 6, W, H - y0 - 6, '#26262e');
  for (let x = 0; x < W; x += 40) rect(g, x, y0 + 6, 1, H - y0 - 6, C.ink);
}

/**
 * Roughly whether it's dark in Scotland at this time, for the floodlights: sunset runs from about 15:40 UTC in
 * December to 21:00 in June, sunrise from about 08:40 to 03:30.
 */
export function isDark(d: Date): boolean {
  const day = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000;
  const swing = Math.cos((2 * Math.PI * (day - 172)) / 365);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h > 18.35 + 2.7 * swing + 0.25 || h < 6.1 - 2.6 * swing;
}
