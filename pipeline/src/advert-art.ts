// Makes each advert's backdrop pictures (adverts.json "photos", pixel art) screen-sized, in two versions:
//  - <id>-<n>.png: the SD one, a little wider than the 320×180 screen so the player can pan slowly across, at roughly one
//    source art-pixel per screen pixel so they stay sharp.
//  - <id>-<n>-hd.png (#92): the HD one, 480×270 on the picture's own pixel grid (the AI art is drawn in chunky blocks, about
//    240 across): each output pixel takes the centre of the block it falls in, so a 240-block picture comes out as exact 2×2
//    blocks. No pan in HD (the picture is exactly the frame).
// Re-run after adding or changing a picture. Served from breaks/, not adverts/: ad blockers block any "/adverts/" URL.
// Usage: npm run adverts   → site/public/breaks/<advert id>-<n>[-hd].png

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadAdverts } from './script/adverts.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'site/public/breaks');
/**
 * 12% bigger than the 320×180 screen, for the pan. AI pixel art comes out around 1376 px wide with ~4 px art-pixels,
 * so this lands near one art-pixel per screen pixel. No dithering: the art has its own.
 */
const ADVERT_ART = { width: 360, height: 203 };
/** The HD frame. */
const HD = { width: 480, height: 270 };
/** The picture is drawn on a grid of about this many blocks across. */
const BLOCKS = 240;

type Position = 'centre' | 'top' | 'bottom' | 'left' | 'right';
type Raw = { d: Buffer; w: number; h: number };

/** The picture cropped to 16:9 (as `position` says), as raw RGB. */
async function widescreen(file: string, position: Position): Promise<Raw> {
  const { width = 0, height = 0 } = await sharp(file).metadata();
  const wantH = Math.round((width * HD.height) / HD.width);
  const base = wantH <= height ? sharp(file).extract({ left: 0, top: position === 'top' ? 0 : position === 'bottom' ? height - wantH : Math.floor((height - wantH) / 2), width, height: wantH }) : sharp(file);
  const { data, info } = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
}

/** Where the block edges fall: the offset (in source px, less than the block) with the most colour change across it, along one axis. */
function phase(img: Raw, block: number, axis: 'x' | 'y'): number {
  const n = axis === 'x' ? img.w : img.h;
  const m = axis === 'x' ? img.h : img.w;
  const edge = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < m; j += 2) {
      const a = (axis === 'x' ? j * img.w + i : i * img.w + j) * 3;
      const b = (axis === 'x' ? j * img.w + i - 1 : (i - 1) * img.w + j) * 3;
      sum += Math.abs(img.d[a] - img.d[b]) + Math.abs(img.d[a + 1] - img.d[b + 1]) + Math.abs(img.d[a + 2] - img.d[b + 2]);
    }
    edge[i] = sum;
  }
  let best = 0;
  let bestE = -1;
  for (let o = 0; o < block; o += 0.25) {
    let e = 0;
    for (let k = o; k < n; k += block) e += edge[Math.round(k)] ?? 0;
    if (e > bestE) [best, bestE] = [o, e];
  }
  return best;
}

/** The picture on the 480×270 canvas, one pixel per half block (see the file header). The rows the picture lacks are its edge row repeated, split top and bottom. */
function toHd(img: Raw): Buffer {
  const s = img.w / HD.width;
  const rows = Math.round(img.h / s);
  const pad = Math.floor((HD.height - rows) / 2);
  const block = img.w / BLOCKS;
  const ox = phase(img, block, 'x');
  const oy = phase(img, block, 'y');
  const half = s;
  const snap = (v: number, o: number, max: number) => Math.min(max, Math.max(0, Math.round(o + (Math.floor((v - o) / half) + 0.5) * half)));
  const out = Buffer.alloc(HD.width * HD.height * 3);
  for (let y = 0; y < HD.height; y++) {
    const sy = snap(Math.min(rows - 0.5, Math.max(0.5, y - pad + 0.5)) * s, oy, img.h - 1);
    for (let x = 0; x < HD.width; x++) {
      const sx = snap((x + 0.5) * s, ox, img.w - 1);
      const k = (sy * img.w + sx) * 3;
      const o = (y * HD.width + x) * 3;
      out[o] = img.d[k];
      out[o + 1] = img.d[k + 1];
      out[o + 2] = img.d[k + 2];
    }
  }
  return out;
}

async function main() {
  const cfg = loadAdverts();
  if (!cfg) throw new Error('No adverts.json');
  await mkdir(OUT, { recursive: true });
  for (const ad of cfg.adverts) {
    for (const [n, { from, position = 'centre' }] of (ad.photos ?? []).entries()) {
      const file = resolve(ROOT, from);
      await sharp(file)
        .resize(ADVERT_ART.width, ADVERT_ART.height, { fit: 'cover', position, kernel: 'mitchell' })
        .png({ palette: true, colours: 64, dither: 0 })
        .toFile(resolve(OUT, `${ad.id}-${n}.png`));
      const hd = toHd(await widescreen(file, position));
      await sharp(hd, { raw: { width: HD.width, height: HD.height, channels: 3 } })
        .png({ palette: true, colours: 96, dither: 0 })
        .toFile(resolve(OUT, `${ad.id}-${n}-hd.png`));
      console.log(`  ✔ ${ad.brand} ${n}: ${from}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
