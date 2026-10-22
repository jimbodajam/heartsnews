import { offscreen, type Ctx } from './screen';

// A hand-made 5px-tall bitmap font. Rows are separated by "|", "#" is a lit pixel.
// Most glyphs are 3px wide; M, N and W need more room. Text is drawn in capitals only.
const GLYPHS: Record<string, string> = {
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#...#|##.##|#.#.#|#...#|#...#', N: '#..#|##.#|#.##|#..#|#..#', O: '.#.|#.#|#.#|#.#|.#.',
  P: '##.|#.#|##.|#..|#..', Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.',
  T: '###|.#.|.#.|.#.|.#.', U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.',
  W: '#...#|#...#|#.#.#|##.##|#...#', X: '#.#|#.#|.#.|#.#|#.#', Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#', '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
  ' ': '..|..|..|..|..', '.': '.|.|.|.|#', ',': '.|.|.|#|#', '!': '#|#|#|.|#', '?': '##.|..#|.#.|...|.#.',
  "'": '#|#|.|.|.', '"': '#.#|#.#|...|...|...', '-': '...|...|###|...|...', '+': '...|.#.|###|.#.|...',
  ':': '.|#|.|#|.', ';': '.|#|.|#|#', '/': '..#|..#|.#.|#..|#..', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.',
  '&': '.#.|#.#|.#.|#.#|.##', '£': '.##|.#.|###|.#.|###', '%': '#.#|..#|.#.|#..|#.#', '=': '...|###|...|###|...',
  '>': '#..|.#.|..#|.#.|#..', '<': '..#|.#.|#..|.#.|..#', '•': '.|.|#|.|.', '#': '#.#|###|#.#|###|#.#',
};

// A larger 5×7 face for headlines, names, scores and stings: anything drawn at scale 2 or more uses it,
// which reads far more smoothly than blowing the tiny font up.
const BIG: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '###|.#.|.#.|.#.|.#.|.#.|###', J: '..###|...#.|...#.|...#.|#..#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####', '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|....#|.###.',
  ' ': '...|...|...|...|...|...|...', '.': '.|.|.|.|.|.|#', ',': '.|.|.|.|.|#|#', '!': '#|#|#|#|#|.|#',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', "'": '#|#|.|.|.|.|.', '"': '#.#|#.#|...|...|...|...|...',
  '-': '....|....|....|####|....|....|....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  ':': '.|.|#|.|.|#|.', ';': '.|.|#|.|.|#|#', '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
  '(': '.#|#.|#.|#.|#.|#.|.#', ')': '#.|.#|.#|.#|.#|.#|#.', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#',
  '£': '..##.|.#..#|.#...|###..|.#...|.#...|#####', '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##',
  '=': '.....|.....|#####|.....|#####|.....|.....', '>': '#....|.#...|..#..|...#.|..#..|.#...|#....',
  '<': '....#|...#.|..#..|.#...|..#..|...#.|....#', '•': '...|...|.#.|###|.#.|...|...',
  '#': '.#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.',
};

interface Glyph {
  w: number;
  h: number;
  rows: string[];
}

const parsed = new Map<string, Glyph>();
function glyph(ch: string, big = false): Glyph {
  const key = (big ? 'B' : 'S') + ch;
  let gl = parsed.get(key);
  if (!gl) {
    const set = big ? BIG : GLYPHS;
    const rows = (set[ch] ?? set['?']).split('|');
    gl = { w: rows[0].length, h: rows.length, rows };
    parsed.set(key, gl);
  }
  return gl;
}

/** Scale 2+ uses the big face at a pixel size that keeps text roughly the height callers expect. */
function face(scale: number): { big: boolean; px: number } {
  return scale >= 2 ? { big: true, px: Math.max(1, Math.round((scale * 5) / 7)) } : { big: false, px: scale };
}

export const GLYPH_H = 5;
export const LINE_H = 7;

export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ø/gi, 'O')
    .replace(/æ/gi, 'AE')
    .toUpperCase();
}

export function measure(text: string, scale = 1): number {
  const { big, px } = face(scale);
  let w = 0;
  for (const ch of normalise(text)) w += (glyph(ch, big).w + 1) * px;
  return Math.max(0, w - px);
}

const glyphCache = new Map<string, HTMLCanvasElement>();
function glyphCanvas(ch: string, color: string, big: boolean): HTMLCanvasElement {
  const key = (big ? 'B' : 'S') + ch + color;
  let c = glyphCache.get(key);
  if (!c) {
    const gl = glyph(ch, big);
    c = offscreen(gl.w, gl.h, (g) => {
      g.fillStyle = color;
      gl.rows.forEach((row, y) => [...row].forEach((p, x) => p === '#' && g.fillRect(x, y, 1, 1)));
    });
    glyphCache.set(key, c);
  }
  return c;
}

/** Draws text with its top-left at (x, y). Returns the width drawn. */
export function drawText(g: Ctx, text: string, x: number, y: number, color: string, scale = 1): number {
  const { big, px } = face(scale);
  let cx = Math.round(x);
  // The big face is 7 rows tall: centre it in the space the small face would have taken.
  const top = Math.round(y + (big ? (GLYPH_H * scale - 7 * px) / 2 : 0));
  for (const ch of normalise(text)) {
    const gl = glyph(ch, big);
    if (ch !== ' ') g.drawImage(glyphCanvas(ch, color, big), cx, top, gl.w * px, gl.h * px);
    cx += (gl.w + 1) * px;
  }
  return cx - Math.round(x);
}

export function drawTextCentred(g: Ctx, text: string, cx: number, y: number, color: string, scale = 1): void {
  drawText(g, text, Math.round(cx - measure(text, scale) / 2), y, color, scale);
}

export function drawTextRight(g: Ctx, text: string, right: number, y: number, color: string, scale = 1): void {
  drawText(g, text, right - measure(text, scale), y, color, scale);
}

/** Greedy word wrap to a pixel width. */
export function wrap(text: string, maxW: number, scale = 1): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, scale) > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cut text down to fit a width, ending with "...". */
export function fit(text: string, maxW: number, scale = 1): string {
  if (measure(text, scale) <= maxW) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}...`, scale) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}
