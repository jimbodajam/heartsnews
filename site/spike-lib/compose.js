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
  const faces = {}, faceOf = n => faces[n] ??= heads[n].eyeWin ? { eyes: detectEyes(ref[n], heads[n].eyeWin), mouthFit: detectMouth(ref[n], heads[n].mouthWin) } : findFace(ref[n], heads[P.base]);
  const centres = n => faceOf(n).eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const off = {}, warp = {};
  for (const [n, s] of Object.entries(heads)) {
    if (!ref[n]) continue;
    if (s.mode === 'patch') {
      if (fc.register === 'iris') off[n] = headOffsets(ref[P.base], ref[n], ref[P.registerMouth]);
      else if (fc.register === 'shift') off[n] = rigidOffsets(ref[P.base], ref[n], P.boxes);
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

/** How a nodded or tilted head sits against the master, as one rigid move (shift and a small turn) fitted over the whole face, eyes to mouth, so it is steadier than fitting an eye or the mouth alone.
 *  Returns the offsets composeFace takes: each eye and the mouth move to where that rigid move carries their centres, and the mouth patch is turned by the same angle. */
function rigidOffsets(base, head, B, R = 8) {
  const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const mid = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], pL = mid(B.EBL), pR = mid(B.EBR), pM = mid(B.MB);
  const win = [Math.floor(B.EBL[0]) - 3, Math.floor(B.EBL[1]) - 4, Math.ceil(B.EBR[2]) + 3, Math.ceil(B.MB[3]) + 2], c = [(win[0] + win[2]) / 2, (win[1] + win[3]) / 2];
  let best = [0, 0, 0], bestE = Infinity;
  for (let r = -0.36; r <= 0.361; r += 0.03) {
    const co = Math.cos(r), si = Math.sin(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let e = 0, n = 0;
      for (let y = win[1]; y <= win[3]; y++) for (let x = win[0]; x <= win[2]; x++) {
        if (!base.has(x, y)) continue; n++;
        const rx = x - c[0], ry = y - c[1], hx = Math.round(c[0] + dx + rx * co - ry * si), hy = Math.round(c[1] + dy + rx * si + ry * co);
        e += head.has(hx, hy) ? Math.abs(lum(base.get(x, y)) - lum(head.get(hx, hy))) : 255;
      }
      e = n ? e / n + (Math.abs(dx) + Math.abs(dy)) * 0.03 + Math.abs(r) * 2 : Infinity;
      if (e < bestE) { bestE = e; best = [dx, dy, r]; }
    }
  }
  const [dx, dy, r] = best, co = Math.cos(r), si = Math.sin(r);
  const move = p => { const rx = p[0] - c[0], ry = p[1] - c[1]; return [Math.round(c[0] + dx + rx * co - ry * si - p[0]), Math.round(c[1] + dy + rx * si + ry * co - p[1])]; };
  const off = { eyeL: move(pL), eyeR: move(pR), mouth: move(pM) };
  if (Math.abs(r) > 0.005) off.mouthRot = +r.toFixed(3);
  return off;
}

/** Face of a head that has moved (nods and tilts shift it by several rows): eyes from a wide window, then the mouth window sits about 11 rows below the eyes, perpendicular to the line between them, so it follows a tilt. */
function findFace(P, base = {}) {
  // seated sets give the master's windows: the search goes a little wider than the master's eye window, the mouth sits as far below the eyes as it does on the master
  const ew = base.eyeWin, mw = base.mouthWin, drop = ew && mw ? (mw[1] + mw[3]) / 2 - (ew[1] + ew[3]) / 2 : 11, [mx, my] = mw ? [(mw[2] - mw[0]) / 2, (mw[3] - mw[1]) / 2] : [6, 3];
  const eyes = detectEyes(P, ew ? [ew[0] - 8, ew[1] - 8, ew[2] + 8, ew[3] + 8] : [56, 16, 92, 38]);
  const c = eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
  const mid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], dx = c[1][0] - c[0][0], dy = c[1][1] - c[0][1], len = Math.hypot(dx, dy) || 1;
  const m = [mid[0] - dy / len * drop, mid[1] + dx / len * drop];
  return { eyes, mouthFit: detectMouth(P, [Math.round(m[0] - mx), Math.round(m[1] - my), Math.round(m[0] + mx), Math.round(m[1] + my)]) };
}
