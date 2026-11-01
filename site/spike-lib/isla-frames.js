// Standing Isla: arm poses (b2-b8 and the palm master over b1), head frames (h1-h5, centre = b1), feet frames (f1-f3), with faces laid over the heads.
// Moved out of /test for the offline bake (#69); the browser no longer runs this.
import { headOffsets, composeFace, fitEye, composeEyesWarped } from './head-faces.js';

const HEADS = { b1: [1, 1], h1: [1, 1], h2: [1, 1], h3: [1, 1], h4: [1, 1], h5: [1, 1] };   // [eyes, mouth]; h1 uses its own mouth frames, and h1 and h5 get warped eyes (fitted shift, tilt and squeeze) because a plain shift breaks on them
const NUDGE = { h2: { eye: -1, mouth: 0 } };
const H1M = { smile: 'h1v1', small: 'h1v2', wide: 'h1v3', O: 'h1v4', A: 'h1v5', press: 'h1v6' };
const HEAD_CUT = 49;   // rows above this come from the head frame, below from the arm pose, from row 119 the feet frame
export const ISLA_MOUTHS = ['smile', 'closed', 'small', 'wide', 'O', 'A', 'press'];
export const ISLA_EYES = ['blink', 'gazeL', 'gazeR'];

const patches = G => { const vs = Array.from({ length: 9 }, (_, i) => G['v' + (i + 1)]); return { base: G.b1, mouthBase: vs[0], mouths: { smile: vs[0], small: vs[1], wide: vs[2], O: vs[3], A: vs[4], press: vs[5] }, blink: vs[6], gazeL: vs[7], gazeR: vs[8] }; };

/** Offsets and eye warps are fitted on `ref` (the frames before any palette snap); frames are composed from `G`. */
export function buildIsla(G, ref = G) {
  const WARP = {}; for (const n of ['h1', 'h5']) WARP[n] = { L: fitEye(ref.b1, ref[n], 'L'), R: fitEye(ref.b1, ref[n], 'R') };
  const OFF = {}; for (const n of Object.keys(HEADS)) OFF[n] = headOffsets(ref.b1, ref[n], ref.v6);
  for (const [n, a] of Object.entries(NUDGE)) { const o = OFF[n]; OFF[n] = { eyeL: [o.eyeL[0] + a.eye, o.eyeL[1]], eyeR: [o.eyeR[0] + a.eye, o.eyeR[1]], mouth: [o.mouth[0] + a.mouth, o.mouth[1]] }; }
  return { G, V: patches(G), WARP, OFF };
}

/** One full frame, the way /test composed it. */
export function composeIsla({ G, V, WARP, OFF }, { head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouthKey = 'rest' } = {}) {
  const [eyeOk, mouthOk] = HEADS[head], mk = mouthKey === 'closed' ? 'smile' : mouthKey === 'rest' ? null : mouthKey, ek = eyeOk && eye !== 'open' ? eye : null;
  let h = head === 'h1' ? G[H1M[mk] || 'h1'] : head === 'b1' ? composeFace(G.b1, OFF.b1, V, eye === 'open' ? null : eye, mk) : composeFace(G[head], OFF[head], V, WARP[head] ? null : ek, mouthOk ? mk : null);
  if (WARP[head] && eye !== 'open') h = composeEyesWarped(h, V, WARP[head], eye);
  const PO = G[pose] || G.b1, X = PO.clone(), F = G[feet], B = G.b1;
  // below the split the feet frame supplies the legs, but where the arm pose changed something (a hand lifted off the skirt, or still low) the pose wins
  const poseChanged = (x, y) => PO.has(x, y) !== B.has(x, y) || (PO.has(x, y) && Math.abs(PO.get(x, y)[0] - B.get(x, y)[0]) + Math.abs(PO.get(x, y)[1] - B.get(x, y)[1]) + Math.abs(PO.get(x, y)[2] - B.get(x, y)[2]) > 40);
  for (let y = 0; y < X.h; y++) for (let x = 0; x < X.w; x++) { const src = y < HEAD_CUT ? h : y >= 119 && !poseChanged(x, y) ? F : null; if (!src) continue; if (src.has(x, y)) X.set(x, y, src.get(x, y)); else X.d[X.idx(x, y) + 3] = 0; }
  return X;
}
