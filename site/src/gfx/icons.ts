import type { IconId } from '../../../shared/bulletin';
import { C } from './palette';
import { offscreen, type Ctx } from './screen';

// 8×8 icons. Letters pick palette colours; "." is transparent.
const INK: Record<string, string> = {
  k: C.ink, w: C.white, g: C.gold, r: C.red, m: C.maroon, s: C.light, n: C.green, d: C.grey,
};

const ICONS: Record<IconId, string[]> = {
  ball: ['..kkkk..', '.kwwwwk.', 'kwwkkwwk', 'kwkkkkwk', 'kwwkkwwk', 'kwwwwwwk', '.kwwwwk.', '..kkkk..'],
  contract: ['wwwwww..', 'wkkkkw..', 'wwwwww.g', 'wkkkkwg.', 'wwwwwg..', 'wkkkgw..', 'wwwwww..', '........'],
  whistle: ['........', '...ss...', '.sssss..', 'ssskkss.', 'ssssssss', '.ssssss.', '..ssss..', '........'],
  trophy: ['gggggggg', 'g.gggg.g', 'g.gggg.g', '.gggggg.', '..gggg..', '...gg...', '..gggg..', '.gggggg.'],
  medical: ['..wwww..', '.wwrrww.', 'wwwrrwww', 'wrrrrrrw', 'wrrrrrrw', 'wwwrrwww', '.wwrrww.', '..wwww..'],
  mic: ['..ssss..', '..sdds..', '..ssss..', '..sdds..', '..ssss..', '...kk...', '...kk...', '..kkkk..'],
  stadium: ['w......w', 'w......w', 'mmmmmmmm', 'mnnnnnnm', 'mnwnnwnm', 'mnnnnnnm', 'mmmmmmmm', '........'],
  phone: ['........', 'ww......', 'wwww....', '.www....', '..www...', '...wwww.', '....wwww', '.....ww.'],
  chat: ['.wwwwww.', 'wwkwkwkw', 'wwwwwwww', '.wwwwww.', '..ww....', '.w......', '........', '........'],
};

const cache = new Map<IconId, HTMLCanvasElement>();

export function drawIcon(g: Ctx, id: IconId, x: number, y: number, scale = 1): void {
  let c = cache.get(id);
  if (!c) {
    c = offscreen(8, 8, (o) =>
      ICONS[id].forEach((row, j) =>
        [...row].forEach((p, i) => {
          if (p === '.') return;
          o.fillStyle = INK[p];
          o.fillRect(i, j, 1, 1);
        }),
      ),
    );
    cache.set(id, c);
  }
  g.drawImage(c, Math.round(x), Math.round(y), 8 * scale, 8 * scale);
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

/** The channel's heart logo, 7×6 pixels before scaling. */
export function drawHeart(g: Ctx, x: number, y: number, scale: number, color: string): void {
  g.fillStyle = color;
  HEART.forEach((row, j) =>
    [...row].forEach((p, i) => p === '#' && g.fillRect(Math.round(x + i * scale), Math.round(y + j * scale), scale, scale)),
  );
}
