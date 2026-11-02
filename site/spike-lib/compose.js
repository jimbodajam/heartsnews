// One compose for every standing presenter (#70). What differs per presenter is the `face` block of art/presenters/<name>/frames.json:
//   register     how a patch head is lined up with the master: "iris" (iris landmark and image fit) or "detect" (eyes and mouth found on the head itself)
//   patch        generated eye and mouth frames cut for the master head: base, mouthBase, registerMouth (iris only), mouths, eyes, boxes (optional)
//   mouthAlias   a mouth key that borrows another's frame, e.g. closed -> smile
//   heads[name]  mode, plus eyeWin and mouthWin (rough windows round the eyes and mouth for detection), nudge, warpEyes, mouthScale
// Modes: "patch" lays the patch frames over the head by registered offsets; "set" uses the head's own generated mouth frames (<head><patch mouth frame>, e.g. h1v1);
// "code" draws eyes and mouth in code from the head's own face. A one-off fix is a touch-up PNG, not a new mode.
import { detectEyes, detectMouth, gaze, blink, mouth, MOUTH_PRESETS } from './pixel-derive.js';
import { headOffsets, composeFace, fitEye, composeEyesWarped } from './head-faces.js';

/** Offsets and eye warps are fitted on `ref` (the frames before any palette snap, detection thresholds were set on those); frames are composed from `G`. */
export function buildPresenter(cfg, G, ref = G) {
  const fc = cfg.face, P = fc.patch, heads = fc.heads;
  const faces = {}, faceOf = n => faces[n] ??= heads[n].eyeWin ? { eyes: detectEyes(ref[n], heads[n].eyeWin), mouthFit: detectMouth(ref[n], heads[n].mouthWin) } : findFace(ref[n]);
  const centres = n => faceOf(n).eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const off = {}, warp = {};
  for (const [n, s] of Object.entries(heads)) {
    if (!ref[n]) continue;
    if (s.mode === 'patch') {
      if (fc.register === 'iris') off[n] = headOffsets(ref[P.base], ref[n], ref[P.registerMouth]);
      else { const c = centres(n), c0 = centres(P.base), m = faceOf(n).mouthFit, m0 = faceOf(P.base).mouthFit; off[n] = { eyeL: [Math.round(c[0][0] - c0[0][0]), Math.round(c[0][1] - c0[0][1])], eyeR: [Math.round(c[1][0] - c0[1][0]), Math.round(c[1][1] - c0[1][1])], mouth: [Math.round(m.cx - m0.cx), Math.round(m.yc - m0.yc)] }; }
      if (s.nudge) { const o = off[n], a = s.nudge; off[n] = { eyeL: [o.eyeL[0] + a.eye, o.eyeL[1]], eyeR: [o.eyeR[0] + a.eye, o.eyeR[1]], mouth: [o.mouth[0] + a.mouth, o.mouth[1]] }; }
    }
    if (s.warpEyes) warp[n] = { L: fitEye(ref[P.base], ref[n], 'L'), R: fitEye(ref[P.base], ref[n], 'R') };
  }
  const pick = names => Object.fromEntries(Object.entries(names).map(([k, f]) => [k, G[f]]));
  const V = { base: G[P.base], mouthBase: G[P.mouthBase], mouths: pick(P.mouths), ...pick(P.eyes), boxes: P.boxes };
  return { cfg, G, V, off, warp, faceOf };
}

/** Eyes drawn in code on a head's own detected eyes. */
function codeEyes(h, eye, eyes) {
  if (eye === 'blink') return blink(h, eyes);
  if (eye === 'gazeL') return gaze(h, eyes, -1);
  if (eye === 'gazeR') return gaze(h, eyes, 1);
  return h;
}

function composeHead(F, head, eye, mouthKey) {
  const { cfg, G, V, off, warp, faceOf } = F, fc = cfg.face, P = fc.patch;
  const src = G[head] ? head : 'b1', spec = fc.heads[src];   // a head frame that is not generated yet falls back to the master head
  const mk = mouthKey === 'rest' ? null : fc.mouthAlias?.[mouthKey] ?? mouthKey, open = eye === 'open';
  let h = G[src];
  if (spec.mode === 'patch') {
    const own = !spec.warpEyes && !open && V[eye] ? eye : null;
    h = composeFace(h, off[src], V, own, mk);
    if (spec.warpEyes) { if (!open) h = composeEyesWarped(h, V, warp[src], eye); }
    else if (!open && !own) h = codeEyes(h, eye, faceOf(src).eyes);
  } else if (spec.mode === 'set') {
    const frame = f => G[src + f] || h, mouthFrame = mk && P.mouths[mk];
    if (spec.warpEyes) { h = mouthFrame ? frame(mouthFrame) : h; if (!open) h = composeEyesWarped(h, V, warp[src], eye); }
    else if (eye === 'blink') h = frame(P.eyes.blink);
    else { h = mouthFrame ? frame(mouthFrame) : h; if (!open) h = codeEyes(h, eye, faceOf(src).eyes); }
  } else {
    const { eyes, mouthFit } = faceOf(src), sc = spec.mouthScale, pre = MOUTH_PRESETS[mk];
    h = codeEyes(h, eye, eyes);
    if (mk) h = mouth(h, mouthFit, sc && pre ? { ...pre, w: (pre.w ?? 1) * sc.w, open: (pre.open ?? 0) * sc.open } : mk);
  }
  return h;
}

const diff = (A, B, x, y) => A.has(x, y) !== B.has(x, y) || (A.has(x, y) && Math.abs(A.get(x, y)[0] - B.get(x, y)[0]) + Math.abs(A.get(x, y)[1] - B.get(x, y)[1]) + Math.abs(A.get(x, y)[2] - B.get(x, y)[2]) > 40);

/** One full frame: head rows from the head frame (face laid on first), arm pose between, feet frame from `feetTop` down. */
export function composePresenter(F, { head = 'b1', pose = 'b1', feet = 'b1', eye = 'open', mouthKey = 'rest' } = {}) {
  const { cfg, G } = F, h = composeHead(F, head, eye, mouthKey), PO = G[pose] || G.b1, X = PO.clone(), Fr = G[feet], B = G.b1;
  for (let y = 0; y < X.h; y++) for (let x = 0; x < X.w; x++) {
    // below the split the feet frame supplies the legs, but where the arm pose changed something (a hand lifted off the skirt, or still low) the pose wins
    const src = y < cfg.headCut ? h : y >= cfg.feetTop && Fr && !diff(PO, B, x, y) ? Fr : null;
    if (!src) continue;
    if (src.has(x, y)) X.set(x, y, src.get(x, y)); else X.d[X.idx(x, y) + 3] = 0;
  }
  return X;
}

/** Face of a head that has moved (nods and tilts shift it by several rows): eyes from a wide window, then the mouth window sits about 11 rows below the eyes, perpendicular to the line between them, so it follows a tilt. */
function findFace(P) {
  const eyes = detectEyes(P, [56, 16, 92, 38]);
  const c = eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const mid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], dx = c[1][0] - c[0][0], dy = c[1][1] - c[0][1], len = Math.hypot(dx, dy) || 1;
  const m = [mid[0] - dy / len * 11, mid[1] + dx / len * 11];
  return { eyes, mouthFit: detectMouth(P, [Math.round(m[0] - 6), Math.round(m[1] - 3), Math.round(m[0] + 6), Math.round(m[1] + 3)]) };
}
