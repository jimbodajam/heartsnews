// Plays a baked presenter (#69, made by tools/bake): stacks cropped layers from one sprite sheet. No keying or detection here.
// The TypeScript port of site/public/test/presenter-player.js.

import { loadImage } from './set';

/** One frame: head, arm pose and feet are frame names, eye is open or a key of `eyes`, mouth is rest or a key of `mouths`. */
export type FrameKey = { head?: string; pose?: string; feet?: string; eye?: string; mouth?: string };

/** A layer's crop of the sheet and where it lands in the frame: sx, sy, w, h, dx, dy. */
type Layer = [number, number, number, number, number, number];

export type PresenterData = {
  name: string;
  w: number;
  h: number;
  /** The sprite row the legs start at (standing sheets): the upper body above it can breathe. */
  feetTop?: number;
  heads: string[];
  poses: string[];
  feet: string[];
  eyes: string[];
  mouths: string[];
  layers: Record<string, Layer>;
};

export type PresenterArt = PresenterData & { frame(key?: FrameKey): HTMLCanvasElement };

/** Load `<base>.json` and `<base>.png`. Frames are composed once and cached. */
export async function loadPresenter(base: string): Promise<PresenterArt> {
  const [data, sheet] = await Promise.all([
    fetch(`${base}.json`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${base}.json (${r.status})`);
      return r.json() as Promise<PresenterData>;
    }),
    loadImage(`${base}.png`),
  ]);
  const cache = new Map<string, HTMLCanvasElement>();
  const draw = (g: CanvasRenderingContext2D, name: string) => {
    const l = data.layers[name];
    if (l) g.drawImage(sheet, l[0], l[1], l[2], l[3], l[4], l[5], l[2], l[3]);
  };
  const frame = ({ head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouth = 'rest' }: FrameKey = {}) => {
    const k = [head, pose, feet, eye, mouth].join('|');
    const hit = cache.get(k);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = data.w;
    c.height = data.h;
    const g = c.getContext('2d')!;
    for (const n of [`feet/${feet}`, `body/${pose}`, `low/${pose}`, `head/${head}`, `eye/${head}/${eye}`, `mouth/${head}/${mouth}`]) {
      // A change can clear cells as well as paint them: the bake gives those as a cut layer.
      if (data.layers[`cut/${n}`]) {
        g.globalCompositeOperation = 'destination-out';
        draw(g, `cut/${n}`);
        g.globalCompositeOperation = 'source-over';
      }
      draw(g, n);
    }
    cache.set(k, c);
    return c;
  };
  return { ...data, frame };
}
