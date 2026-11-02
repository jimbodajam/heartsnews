// Head-crop frames (#71, #72): a mouth or blink generated from an enlarged crop of its parent head, registered back onto the parent's grid.
// frames.json: `crop` { box: [left, top, width, height] in image pixels, scale } and `"crop": true` on a frame. The frame's image is the generated crop as it came back (`<name>-crop.jpg`).
// Only the frame's editable box (cfg.boxes[parent][area]) is taken from it; everything else stays the parent's.
import sharp from 'sharp';
import { registerCrop, cropToGrid } from './grid.mjs';

/** The image file of a frame: a crop frame has its own name so it cannot be mistaken for a full-frame image of the same frame. */
export const frameFile = f => f.file || f.name + (f.crop ? '-crop' : '') + '.jpg';

const blk = cfg => cfg.grid.blk || 5.865;

/** The crop in grid cells: [x0, y0, x1, y1), as registerCrop and cropToGrid take it. */
export function cropCells(cfg) {
  const [l, t, w, h] = cfg.crop.box, k = blk(cfg);
  return [Math.round(l / k), Math.round(t / k), Math.round((l + w) / k), Math.round((t + h) / k)];
}

/** Cuts the enlarged crop of a parent frame, to attach to the generator. */
export async function makeCrop(cfg, parentFile, to) {
  const [left, top, width, height] = cfg.crop.box, s = cfg.crop.scale;
  await sharp(parentFile).extract({ left, top, width, height }).resize(width * s, height * s, { kernel: 'nearest' }).png().toFile(to);
}

/** The boxes (inclusive grid cells) a mouth or eyes frame may change; a `patch` frame (seated sets) falls back to the windows round the master's eyes and mouth. */
export const editBoxes = (cfg, f) => cfg.boxes?.[f.parent]?.[f.area] || (f.area === 'patch' ? [cfg.face?.heads?.[cfg.face?.patch?.base || 'b1']?.eyeWin, cfg.face?.heads?.[cfg.face?.patch?.base || 'b1']?.mouthWin].filter(Boolean) : []);

/**
 * Reads a generated crop for `f` onto the parent's grid. `img` is the crop as raw RGBA ({ data, w, h }), `parentGrid` the parent frame's grid.
 * Returns the parent with the editable boxes taken from the crop, and how well the crop fitted (`err` is the mean luminance error over what should not have changed, `scale` against the size asked for).
 */
export function readCrop(img, parentGrid, cfg, f) {
  const box = cropCells(cfg), [, , bw, bh] = cfg.crop.box, k = blk(cfg), s = cfg.crop.scale, edit = editBoxes(cfg, f);
  const nominal = [k * s * img.w / (bw * s), k * s * img.h / (bh * s)];
  const skip = [Math.min(...edit.map(b => b[0])), Math.min(...edit.map(b => b[1])), Math.max(...edit.map(b => b[2])) + 1, Math.max(...edit.map(b => b[3])) + 1];
  const fit = registerCrop(img, parentGrid, box, nominal, skip), P = cropToGrid(img, fit, box, cfg.grid), all = cropToGrid(img, fit, box, cfg.grid, 0), out = parentGrid.clone();
  // where the parent has face, the crop has face too: a dark mouth line can sit close enough to the background colour to be keyed out, so those cells are read without the key
  for (const [x0, y0, x1, y1] of edit) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (P.has(x, y)) out.set(x, y, P.get(x, y)); else if (parentGrid.has(x, y) && all.has(x, y)) out.set(x, y, all.get(x, y)); else out.d[out.idx(x, y) + 3] = 0;
  }
  return { P: out, err: fit.e, scale: fit.sx / nominal[0] };
}
