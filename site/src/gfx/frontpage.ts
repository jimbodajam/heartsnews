import { drawText, fit, LINE_H, measure, wrap } from './font';
import { shade } from './palette';
import { frame, rect, type Ctx } from './screen';

// The papers round-up's front page (#112): a small newspaper page drawn in code, a masthead band of our own design for
// each paper (evocative of its flavour, never its real logo or lettering), the headline, a placeholder photo and grey
// columns. Nothing is fetched; the page carries only the headline text it is given.

/** A 7x7 emblem, '#' lit. */
type Emblem = readonly string[];

const EMBLEMS: Record<string, Emblem> = {
  // A burst: the red-top's shout.
  'daily-record': ['#..#..#', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '#..#..#'],
  // A plain shield.
  herald: ['#######', '#.#.#.#', '#..#..#', '#######', '#.#.#.#', '.#.#.#.', '..###..'],
  // A thistle.
  scotsman: ['.#.#.#.', '..###..', '.#####.', '..###..', '...#...', '.#.#.#.', '...#...'],
  // A setting sun.
  'evening-news': ['...#...', '#..#..#', '.#...#.', '..###..', '.#####.', '#######', '.......'],
  generic: ['.#####.', '#..#..#', '#######', '#..#..#', '#######', '#..#..#', '.#####.'],
};

function emblem(g: Ctx, id: string, x: number, y: number, color: string): void {
  (EMBLEMS[id] ?? EMBLEMS.generic).forEach((row, j) => [...row].forEach((p, i) => p === '#' && rect(g, x + i, y + j, 1, 1, color)));
}

interface Masthead {
  name: string;
  band: string;
  ink: string;
  accent: string;
  page: string;
  /** Heavy lettering: the colour of its drop shadow. */
  shadow?: string;
  /** Band height (small box, big box). */
  h: [number, number];
}

const MASTHEADS: Record<string, Masthead> = {
  // Red-top: heavy block lettering on a red band.
  'daily-record': { name: 'DAILY RECORD', band: '#c8202c', ink: '#ffffff', accent: '#f6d33c', page: '#dcdad2', shadow: '#7a0f18', h: [13, 17] },
  // Sober dark blue, centred.
  herald: { name: 'THE HERALD', band: '#17284f', ink: '#efe9d6', accent: '#b9975b', page: '#d6d6d0', h: [12, 16] },
  // Broadsheet: black on cream between double rules.
  scotsman: { name: 'THE SCOTSMAN', band: '#e7dfc6', ink: '#16130f', accent: '#16130f', page: '#e7dfc6', h: [13, 17] },
  // Compact tabloid with a warm accent.
  'evening-news': { name: 'EVENING NEWS', band: '#f2e5cc', ink: '#2a1a12', accent: '#e8731c', page: '#ddd9cf', h: [11, 14] },
};

const GENERIC: Masthead = { name: 'THE PAPERS', band: '#3a3d4a', ink: '#f2efe6', accent: '#c9ccd6', page: '#d9d7cf', h: [12, 16] };

/** The wordmark in a band `bandH` tall, at scale 2 if it fits and the band is tall enough, else 1; optionally struck twice for weight. */
function wordmark(g: Ctx, name: string, x: number, y: number, maxW: number, color: string, shadow: string | undefined, centre: boolean, bandH: number): void {
  const scale = measure(name, 2) + (shadow ? 1 : 0) <= maxW && bandH >= 15 ? 2 : 1;
  const text = measure(name, scale) > maxW ? fit(name, maxW, scale) : name;
  const w = measure(text, scale);
  const tx = centre ? x + Math.round((maxW - w) / 2) : x;
  const ty = y + Math.round((bandH - 5 * scale) / 2);
  // Heavy lettering sits on a shadow in a second colour, one pixel down and across.
  if (shadow) drawText(g, text, tx + 1, ty + 1, shadow, scale);
  drawText(g, text, tx, ty, color, scale);
}

const easeOut = (v: number) => 1 - (1 - v) ** 3;

/**
 * Draws the page into the box. The page is a top crop of a front page that bleeds off the bottom, slides in from the
 * right with `age`, and casts a shadow.
 */
export function drawFrontPage(g: Ctx, outlet: string, paperName: string, headline: string, x: number, y: number, w: number, h: number, age: number): void {
  const big = w >= 180;
  const m = MASTHEADS[outlet] ?? { ...GENERIC, name: paperName ? paperName.toUpperCase() : GENERIC.name };
  const slide = Math.round((1 - easeOut(Math.min(1, age / 420))) * w * 0.6);

  const px = x + 4 + slide;
  const py = y + 4;
  const pw = w - 10;
  const ph = h - 4;

  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // Backing board and shadow.
  rect(g, x, y, w, h, '#120f22');
  g.globalAlpha = 0.55;
  rect(g, px + 3, py + 3, pw, ph, '#000000');
  g.globalAlpha = 1;

  // Page.
  rect(g, px, py, pw, ph, m.page);
  rect(g, px, py, pw, 1, shade(m.page, 0.35));
  const bandH = m.h[big ? 1 : 0];
  const inner = pw - 8;
  const ix = px + 4;

  if (outlet === 'scotsman') {
    // Broadsheet: thin double rule above and below a cream masthead.
    const ey = py + 5 + Math.floor((bandH - 4 - 7) / 2);
    rect(g, ix, py + 2, inner, 1, m.accent);
    rect(g, ix, py + 4, inner, 1, m.accent);
    wordmark(g, m.name, ix + 10, py + 5, inner - 20, m.ink, undefined, true, bandH - 4);
    emblem(g, outlet, ix, ey, m.ink);
    emblem(g, outlet, ix + inner - 7, ey, m.ink);
    rect(g, ix, py + bandH, inner, 1, m.accent);
    rect(g, ix, py + bandH + 2, inner, 1, m.accent);
  } else if (outlet === 'evening-news') {
    // Compact tabloid: warm underline and a sun tag.
    rect(g, px, py, pw, bandH, m.band);
    emblem(g, outlet, ix, py + Math.floor((bandH - 7) / 2), m.accent);
    wordmark(g, m.name, ix + 10, py, inner - 10, m.ink, undefined, false, bandH);
    rect(g, px, py + bandH, pw, 2, m.accent);
  } else if (outlet === 'daily-record') {
    // Red top with a yellow underline.
    rect(g, px, py, pw, bandH, m.band);
    wordmark(g, m.name, ix, py, inner - 10, m.ink, m.shadow, false, bandH);
    emblem(g, outlet, ix + inner - 7, py + Math.floor((bandH - 7) / 2), m.accent);
    rect(g, px, py + bandH, pw, 1, m.accent);
  } else {
    rect(g, px, py, pw, bandH, m.band);
    emblem(g, outlet, ix, py + Math.floor((bandH - 7) / 2), m.accent);
    wordmark(g, m.name, ix + 10, py, inner - 20, m.ink, m.shadow, true, bandH);
    emblem(g, outlet, ix + inner - 7, py + Math.floor((bandH - 7) / 2), m.accent);
    rect(g, px, py + bandH, pw, 1, m.accent);
  }

  // Headline: big where it fits in two lines, else small; cut with "..." past the room there is.
  let cy = py + bandH + (outlet === 'scotsman' ? 6 : 5);
  const dark = outlet === 'daily-record' || outlet === 'evening-news' ? '#14110f' : '#1a1620';
  let scale = big ? 2 : 1;
  let lines = wrap(headline, inner, scale);
  if (scale === 2 && lines.length > 2) {
    scale = 1;
    lines = wrap(headline, inner, 1);
  }
  const maxLines = scale === 2 ? 2 : big ? 4 : 3;
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    lines = [...lines.slice(0, maxLines - 1), fit(rest, inner, scale)];
  }
  const step = scale === 2 ? 14 : LINE_H;
  lines.forEach((l, i) => {
    drawText(g, l, ix, cy + i * step, dark, scale);
    if (scale === 2) drawText(g, l, ix + 1, cy + i * step, dark, scale);
  });
  cy += lines.length * step + 2;

  // Placeholder photo (left) and grey columns (right), then column lines running off the bottom.
  const photoW = Math.floor(Math.min(pw * 0.38, 56));
  const photoH = 20;
  rect(g, ix, cy, photoW, photoH, '#7d8190');
  rect(g, ix + Math.floor(photoW / 2) - 3, cy + 3, 6, 6, '#a9acb8');
  rect(g, ix + Math.floor(photoW / 2) - 6, cy + 10, 12, photoH, '#a9acb8');
  // Keep the silhouette inside its frame.
  rect(g, ix, cy + photoH, photoW, 12, m.page);
  frame(g, ix, cy, photoW, photoH, dark);
  const colX = ix + photoW + 4;
  const colW = ix + inner - colX;
  for (let r = 0; r < Math.ceil(photoH / 3); r++) rect(g, colX, cy + 1 + r * 3, r % 4 === 3 ? Math.floor(colW * 0.6) : colW, 1, '#8c8f9c');
  const half = Math.floor((inner - 3) / 2);
  for (let yy = cy + photoH + 3, r = 0; yy < py + ph; yy += 3, r++) {
    rect(g, ix, yy, r % 3 === 2 ? half - 8 : half, 1, '#8c8f9c');
    rect(g, ix + half + 3, yy, half, 1, '#8c8f9c');
  }
  rect(g, ix + half + 1, cy + photoH + 2, 1, py + ph - cy - photoH, '#b3b5bf');

  g.restore();
}
