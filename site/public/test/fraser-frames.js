// Standing Fraser: every frame made in code from the hands-down master (site/public/spike/fraser/standing/b1.jpg). Only the master is generated.
// Faces use pixel-derive.js on the master's own eyes and mouth; head moves and weight shifts use body-warps.js.
import { toGrid, detectEyes, detectMouth, gaze, blink, mouth } from './pixel-derive.js';
import { warpHead, warpLegs } from './body-warps.js';

export const FRASER_GRID = { w: 145, h: 216, bg: [184, 52, 137] };
const EYE_WIN = [58, 20, 90, 36], MOUTH_WIN = [66, 37, 80, 42];
const HEAD = { piv: [72, 46], rows: 45 };
const LEGS = { cx: 72, top: 138, foot: 210, fill: [40, 36, 60] };

export const HEADS = [['b1', 'centre', {}], ['h3', 'nod down', { dy: 1, sy: 0.96 }], ['h4', 'nod up', { dy: -1, sy: 1.03 }], ['h5', 'tilt right', { rot: 0.12, dx: 1 }], ['h6', 'tilt left', { rot: -0.12, dx: -1 }]];
export const FEET = [['b1', 'together', null], ['f1', 'weight right leg', { L: { dx: -4, lift: 2 }, R: { dx: 0, lift: 0 } }], ['f2', 'weight left leg', { L: { dx: 0, lift: 0 }, R: { dx: 4, lift: 2 } }], ['f3', 'apart', { L: { dx: -3, lift: 0 }, R: { dx: 3, lift: 0 } }]];
export const EYES = ['open', 'blink', 'gazeL', 'gazeR'];
export const MOUTHS = ['rest', 'smile', 'closed', 'small', 'wide', 'O', 'A'];

export async function loadFraser(src) {
  const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const base = toGrid(img, FRASER_GRID), eyes = detectEyes(base, EYE_WIN), mouthFit = detectMouth(base, MOUTH_WIN);
  return { base, eyes, mouthFit };
}

/** One full frame: head pose (with eye and mouth drawn on the master head first, then warped with it), feet pose, rest from the master. */
export function composeFraser(F, { head = 'b1', feet = 'b1', eye = 'open', mouthKey = 'rest' } = {}) {
  let h = F.base;
  if (eye === 'blink') h = blink(h, F.eyes); else if (eye === 'gazeL') h = gaze(h, F.eyes, -1); else if (eye === 'gazeR') h = gaze(h, F.eyes, 1);
  if (mouthKey !== 'rest') h = mouth(h, F.mouthFit, mouthKey);
  const hp = HEADS.find(x => x[0] === head)[2];
  const out = Object.keys(hp).length ? warpHead(h, hp, HEAD) : h.clone();
  const fp = FEET.find(x => x[0] === feet)[2];
  if (fp) { const legs = warpLegs(F.base, fp, LEGS); for (let y = LEGS.top; y < out.h; y++) for (let x = 0; x < out.w; x++) { if (legs.has(x, y)) out.set(x, y, legs.get(x, y)); else out.d[out.idx(x, y) + 3] = 0; } }
  return out;
}
