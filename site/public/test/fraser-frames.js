// Standing Fraser. Generated: the hands-down master b1, the two head turns h1 (right) and h2 (left), and the arm poses b2-b8.
// Made in code from b1: head nods and tilts (h3-h6), weight shifts (f1-f3), blinks, glances and mouths. Frame names match Isla's.
// Faces use pixel-derive.js on each head's own eyes and mouth; head moves and weight shifts use body-warps.js.
import { toGrid, detectEyes, detectMouth, gaze, blink, mouth } from './pixel-derive.js';
import { warpHead, warpLegs } from './body-warps.js';

export const FRASER_GRID = { w: 145, h: 216, bg: [184, 52, 137] };
// rough windows round the eyes and mouth of each generated head (the turned heads see the face at an angle)
const FACE = { b1: { eye: [58, 20, 90, 36], mouth: [66, 37, 80, 42] }, h1: { eye: [72, 22, 92, 32], mouth: [75, 36, 88, 41] }, h2: { eye: [56, 22, 76, 32], mouth: [58, 36, 71, 41] } };
const HEAD = { piv: [72, 46], rows: 45 };
const HEAD_CUT = 46;   // rows above come from the head frame, below from the arm pose
const LEGS = { cx: 72, top: 138, foot: 210, fill: [40, 36, 60] };

export const HEADS = [['b1', 'centre', {}], ['h1', 'turn right', null], ['h2', 'turn left', null], ['h3', 'nod down', { dy: 1, sy: 0.96 }], ['h4', 'nod up', { dy: -1, sy: 1.03 }], ['h5', 'tilt right', { rot: 0.12, dx: 1 }], ['h6', 'tilt left', { rot: -0.12, dx: -1 }]];
export const FEET = [['b1', 'together', null], ['f1', 'weight right leg', { L: { dx: -4, lift: 2 }, R: { dx: 0, lift: 0 } }], ['f2', 'weight left leg', { L: { dx: 0, lift: 0 }, R: { dx: 4, lift: 2 } }], ['f3', 'apart', { L: { dx: -3, lift: 0 }, R: { dx: 3, lift: 0 } }]];
export const POSES = [['b1', 'arms down'], ['b2', 'point'], ['b3', 'open palm'], ['b4', 'hands together'], ['b5', 'tablet'], ['b6', 'hand on hip'], ['b7', 'arm out'], ['b8', 'welcome']];
export const EYES = ['open', 'blink', 'gazeL', 'gazeR'];
export const MOUTHS = ['rest', 'smile', 'closed', 'small', 'wide', 'O', 'A'];

export async function loadFraser(dir) {
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  const G = {};
  await Promise.all(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'h1', 'h2'].map(async n => { const im = await load(dir + n + '.jpg'); if (im) G[n] = toGrid(im, FRASER_GRID); }));
  const face = {};
  for (const n of ['b1', 'h1', 'h2']) if (G[n]) face[n] = { eyes: detectEyes(G[n], FACE[n].eye), mouthFit: detectMouth(G[n], FACE[n].mouth) };
  return { G, face };
}

/** One full frame: head pose (face drawn on the head first, then warped with it), arm pose, feet pose. */
export function composeFraser(F, { head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouthKey = 'rest' } = {}) {
  const src = F.G[head] ? head : 'b1';   // a head frame that is not generated yet falls back to the master head
  let h = F.G[src];
  const { eyes, mouthFit } = F.face[src];
  if (eye === 'blink') h = blink(h, eyes); else if (eye === 'gazeL') h = gaze(h, eyes, -1); else if (eye === 'gazeR') h = gaze(h, eyes, 1);
  if (mouthKey !== 'rest') h = mouth(h, mouthFit, mouthKey);
  const hp = HEADS.find(x => x[0] === head)[2];
  if (hp && Object.keys(hp).length) h = warpHead(h, hp, HEAD);
  const out = (F.G[pose] || F.G.b1).clone();
  for (let y = 0; y < HEAD_CUT; y++) for (let x = 0; x < out.w; x++) { if (h.has(x, y)) out.set(x, y, h.get(x, y)); else out.d[out.idx(x, y) + 3] = 0; }
  const fp = FEET.find(x => x[0] === feet)[2];
  if (fp) { const legs = warpLegs(F.G.b1, fp, LEGS); for (let y = LEGS.top; y < out.h; y++) for (let x = 0; x < out.w; x++) { if (legs.has(x, y)) out.set(x, y, legs.get(x, y)); else out.d[out.idx(x, y) + 3] = 0; } }
  return out;
}
