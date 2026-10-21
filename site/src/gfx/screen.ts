export const W = 320;
export const H = 180;

export type Ctx = CanvasRenderingContext2D;

/** Set the canvas to the native 320×180 resolution and scale it up to fill the window with crisp pixels. */
export function createScreen(canvas: HTMLCanvasElement): Ctx {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  const fit = () => {
    const ratio = Math.min(innerWidth / W, innerHeight / H);
    // Whole-number scaling keeps every pixel the same size; only drop it on very small screens.
    const s = ratio >= 2 ? Math.floor(ratio) : ratio;
    canvas.style.width = `${W * s}px`;
    canvas.style.height = `${H * s}px`;
  };
  fit();
  addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  return g;
}

export function offscreen(w: number, h: number, draw: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g);
  return c;
}

export function rect(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 1px outline inside the given box. */
export function frame(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  rect(g, x, y, w, 1, color);
  rect(g, x, y + h - 1, w, 1, color);
  rect(g, x, y, 1, h, color);
  rect(g, x + w - 1, y, 1, h, color);
}

/** Vertical gradient through `cols`, blended with 2×2 ordered dithering instead of smooth colour. */
export function ditherV(g: Ctx, x: number, y: number, w: number, h: number, cols: string[]): void {
  const bayer = [
    [0, 2],
    [3, 1],
  ];
  for (let j = 0; j < h; j++) {
    const t = (j / Math.max(1, h - 1)) * (cols.length - 1);
    const i = Math.min(cols.length - 1, Math.floor(t));
    const f = t - i;
    for (let k = 0; k < w; k++) {
      const threshold = (bayer[j % 2][k % 2] + 0.5) / 4;
      g.fillStyle = f > threshold && i + 1 < cols.length ? cols[i + 1] : cols[i];
      g.fillRect(x + k, y + j, 1, 1);
    }
  }
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
