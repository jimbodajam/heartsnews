// Standing Fraser. Generated: the hands-down master b1, the two head turns h1 (right) and h2 (left), and the arm poses b2-b8.
// Made in code from b1: head nods and tilts (h3-h6), weight shifts (f1-f3), blinks, glances and mouths. Frame names match Isla's.
// Faces use pixel-derive.js on each head's own eyes and mouth; head moves and weight shifts use body-warps.js.
import { toGrid, detectEyes, detectMouth, gaze, blink, mouth } from './pixel-derive.js';
import { warpHead, warpLegs } from './body-warps.js';
import { composeFace } from './head-faces.js';

export const FRASER_GRID = { w: 145, h: 216, bg: [184, 52, 137] };
// rough windows round the eyes and mouth of each generated head (the turned heads see the face at an angle)
const FACE = { b1: { eye: [58, 20, 90, 36], mouth: [66, 37, 80, 42] }, h1: { eye: [72, 22, 92, 32], mouth: [75, 36, 88, 41] }, h2: { eye: [56, 22, 76, 32], mouth: [58, 36, 71, 41] } };
const FACE_BOXES = { EBL: [61, 25, 71, 31], EBR: [73, 25, 83, 31], MB: [64, 35, 80, 43] };   // eye and mouth boxes on the master head, for the generated v frames
const HEAD = { piv: [72, 46], rows: 45 };
const SEAM = 40;       // above this row everything is the head's (hair, face, ears, neck)
const HEAD_CUT = 46;   // rows above come from the head frame, below from the arm pose
const LEGS = { cx: 72, top: 138, foot: 210, fill: [40, 36, 60] };

export const HEADS = [['b1', 'centre', {}], ['h1', 'turn right', null], ['h2', 'turn left', null], ['h3', 'nod down', { dy: 1, sy: 0.96 }], ['h4', 'nod up', { dy: -1, sy: 1.03 }], ['h5', 'tilt left', { rot: -0.12, dx: -1 }], ['h6', 'tilt right', { rot: 0.12, dx: 1 }]];
export const FEET = [['b1', 'together', null], ['f1', 'weight right leg', { L: { dx: -4, lift: 2 }, R: { dx: 0, lift: 0 } }], ['f2', 'weight left leg', { L: { dx: 0, lift: 0 }, R: { dx: 4, lift: 2 } }], ['f3', 'apart', { L: { dx: -3, lift: 0 }, R: { dx: 3, lift: 0 } }]];
export const POSES = [['b1', 'arms down'], ['b2', 'point'], ['b3', 'open palm'], ['b4', 'hands together'], ['b5', 'tablet'], ['b6', 'hand on hip'], ['b7', 'arm out'], ['b8', 'welcome']];
export const EYES = ['open', 'blink', 'gazeL', 'gazeR'];
export const MOUTHS = ['rest', 'smile', 'closed', 'small', 'wide', 'O', 'A'];

export async function loadFraser(dir) {
  const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
  const G = {};
  await Promise.all(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9'].map(async n => { const im = await load(dir + n + '.jpg'); if (im) G[n] = toGrid(im, FRASER_GRID); }));
  const face = {};
  for (const n of Object.keys(G)) if (n[0] === 'h' || n === 'b1') face[n] = FACE[n] ? { eyes: detectEyes(G[n], FACE[n].eye), mouthFit: detectMouth(G[n], FACE[n].mouth) } : findFace(G[n]);
  // generated mouth and eye frames (v1-v9) cut for the master head, laid over the master and the nod and tilt heads by registered offsets (not the turned heads, the angle is wrong)
  const V = G.v1 && G.v7 ? { base: G.b1, mouthBase: G.b1, mouths: { smile: G.v1, small: G.v2, wide: G.v3, O: G.v4, A: G.v5, closed: G.v6 }, blink: G.v7, gazeR: G.v9, boxes: FACE_BOXES } : null;
  const centres = n => BLINK_AT[n] || face[n].eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const off = {}, c0 = centres('b1'), m0 = face.b1.mouthFit;
  for (const n of ['b1', 'h3', 'h4', 'h5', 'h6']) if (G[n]) { const c = centres(n), m = face[n].mouthFit; off[n] = { eyeL: [Math.round(c[0][0] - c0[0][0]), Math.round(c[0][1] - c0[0][1])], eyeR: [Math.round(c[1][0] - c0[1][0]), Math.round(c[1][1] - c0[1][1])], mouth: [Math.round(m.cx - m0.cx), Math.round(m.yc - m0.yc)] }; }
  return { G, face, V, off };
}

/** One full frame: head pose (face drawn on the head first, then warped with it), arm pose, feet pose. */
export function composeFraser(F, { head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouthKey = 'rest' } = {}) {
  const src = F.G[head] ? head : 'b1';   // a head frame that is not generated yet falls back to the master head
  let h = F.G[src];
  const { eyes, mouthFit } = F.face[src];
  if (F.V && F.off[src]) {
    // v8 (asked for a left glance) came out looking right like v9, so the generated glance is right only; left is the code glance
    h = composeFace(h, F.off[src], F.V, eye === 'blink' || eye === 'gazeR' ? eye : null, mouthKey === 'rest' ? null : mouthKey);
    if (eye === 'gazeL') h = gaze(h, eyes, -1);
  } else {
    if (eye === 'blink') h = BLINK_AT[src] ? blinkAt(h, BLINK_AT[src]) : blink(h, eyes); else if (eye === 'gazeL') h = gaze(h, eyes, -1); else if (eye === 'gazeR') h = gaze(h, eyes, 1);
    if (mouthKey !== 'rest') h = mouth(h, mouthFit, mouthKey);
  }
  const hp = HEADS.find(x => x[0] === head)[2];
  if (src !== head && hp && Object.keys(hp).length) h = warpHead(h, hp, HEAD);   // only a head that is not generated is warped from the master
  const out = (F.G[pose] || F.G.b1).clone();
  // Head pixels only near the seam: below SEAM the head frame carries a strip of its own jacket (recoloured in the generated turns, rotated in the tilts), so take just skin from it and keep the pose's jacket, collar and tie.
  const skin = c => c[0] > 150 && c[0] > c[1] + 10 && c[1] >= c[2] - 8;
  for (let y = 0; y < HEAD_CUT; y++) for (let x = 0; x < out.w; x++) {
    const q = h.has(x, y) ? h.get(x, y) : null, p = out.has(x, y) ? out.get(x, y) : null;
    if (y < SEAM || (q && (skin(q) || (p && skin(p))))) { if (q) out.set(x, y, q); else out.d[out.idx(x, y) + 3] = 0; }
  }
  const fp = FEET.find(x => x[0] === feet)[2];
  if (fp) { const legs = warpLegs(F.G.b1, fp, LEGS); for (let y = LEGS.top; y < out.h; y++) for (let x = 0; x < out.w; x++) { if (legs.has(x, y)) out.set(x, y, legs.get(x, y)); else out.d[out.idx(x, y) + 3] = 0; } }
  return out;
}

/** Face of a head that has moved (nods and tilts shift it by several rows): eyes from a wide window, then the mouth window sits about 11 rows below the eyes, perpendicular to the line between them, so it follows a tilt. */
function findFace(P) {
  const eyes = detectEyes(P, [56, 16, 92, 38]);
  const c = eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const mid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], dx = c[1][0] - c[0][0], dy = c[1][1] - c[0][1], len = Math.hypot(dx, dy) || 1;
  const m = [mid[0] - dy / len * 11, mid[1] + dx / len * 11];
  return { eyes, mouthFit: detectMouth(P, [Math.round(m[0] - 6), Math.round(m[1] - 3), Math.round(m[0] + 6), Math.round(m[1] + 3)]) };
}

// Eye centres for heads where the eye whites are too small for detectEyes to find the far eye (checked by eye on the 145x216 grid).
const BLINK_AT = { h4: [[64.5, 22], [77.5, 22]], h6: [[73.5, 25], [82.5, 29.5]] };

/** Blink by hand: wipe a small box round each eye to the skin round it and draw a two-pixel lid line, bowed down in the middle. */
function blinkAt(P, centres) {
  const out = P.clone(), lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], skinLike = c => c[0] > 150 && c[0] > c[1] + 10 && c[1] >= c[2] - 8;
  for (const [cx0, cy0] of centres) {
    const cx = Math.round(cx0), cy = Math.round(cy0), ring = [];
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 6; x <= cx + 6; x++) if (P.has(x, y) && skinLike(P.get(x, y)) && (Math.abs(x - cx) > 3 || Math.abs(y - cy) > 2)) ring.push(P.get(x, y));
    const med = i => ring.map(c => c[i]).sort((a, b) => a - b)[ring.length >> 1], skin = ring.length ? [med(0), med(1), med(2)] : [230, 170, 130];
    let lash = [40, 24, 36], best = 999;
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 3; x <= cx + 3; x++) if (P.has(x, y)) { const l = lum(P.get(x, y)); if (l < best) { best = l; lash = P.get(x, y); } }
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 3; x <= cx + 3; x++) if (P.has(x, y)) out.set(x, y, skin);
    for (let dx = -3; dx <= 3; dx++) out.set(cx + dx, cy + (Math.abs(dx) <= 1 ? 1 : 0), lash);
  }
  return out;
}
