// Lay the generated mouth and eye patches (cut for the master head) onto a moved head frame, no new generation.
// Each feature is registered by a landmark (iris centroid per eye, dark lip-line centroid for the mouth), then only the
// feature's own pixels are pasted, so skin and hair on the moved head are left alone.

const EYE_WIN = [54, 20, 100, 40], EYE_SPLIT = 72;
const EBL = [62, 24, 71, 35], EBR = [74, 24, 82, 35], MB = [65, 35, 85, 47];   // one box per eye, mouth box

const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const l1 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const greenIris = (P, x0, x1) => {
  let sx = 0, sy = 0, n = 0;
  for (let y = EYE_WIN[1]; y <= EYE_WIN[3]; y++) for (let x = x0; x <= x1; x++) if (P.has(x, y)) { const c = P.get(x, y); if (c[1] > c[0] + 12 && c[1] > c[2] - 10) { sx += x; sy += y; n++; } }
  return n ? [sx / n, sy / n] : null;
};
/** Best whole-pixel shift of `src` onto `tgt` around centre SC (luminance with the window mean removed, so skin tone differences between frames do not matter). */
function fitShift(src, tgt, SC, W, R) {
  let best = null;
  for (let dx = -R[0]; dx <= R[0]; dx++) for (let dy = -R[1]; dy <= R[1]; dy++) {
    const a = [], b = [];
    for (let y = -W[1]; y <= W[1]; y++) for (let x = -W[0]; x <= W[0]; x++) { const px = SC[0] + x + dx, py = SC[1] + y + dy, qx = SC[0] + x, qy = SC[1] + y; if (tgt.has(px, py) && src.has(qx, qy)) { a.push(lum(tgt.get(px, py))); b.push(lum(src.get(qx, qy))); } }
    if (a.length < W[0] * W[1]) continue;
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs((a[i] - ma) - (b[i] - mb));
    if (!best || e < best.e) best = { e, dx, dy };
  }
  return best ? [best.dx, best.dy] : [0, 0];
}

/** Offsets of `head` relative to `base` (both Pix, same grid): iris landmark per eye, image fit for the mouth. `baseMouth` is a closed-mouth frame (the pressed lips) cut for the master. */
export function headOffsets(base, head, baseMouth = base) {
  const sub = (a, b) => a && b ? [Math.round(a[0] - b[0]), Math.round(a[1] - b[1])] : [0, 0];
  return {
    eyeL: sub(greenIris(head, 0, EYE_SPLIT), greenIris(base, 0, EYE_SPLIT)),
    eyeR: sub(greenIris(head, EYE_SPLIT + 1, 144), greenIris(base, EYE_SPLIT + 1, 144)),
    mouth: fitShift(baseMouth, head, [75, 41], [8, 4], [8, 3]),   // validated on the six generated h1 mouths, which land at +4/+5
  };
}

/** Pixels in `box` that are not plain skin: the median colour of the box is taken as skin. */
function featurePixels(P, [x0, y0, x1, y1], thr = 70) {
  const cs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (P.has(x, y)) cs.push(P.get(x, y));
  const med = i => cs.map(c => c[i]).sort((a, b) => a - b)[cs.length >> 1], skin = [med(0), med(1), med(2)], set = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (P.has(x, y) && l1(P.get(x, y), skin) > thr) set.add(x + ',' + y);
  return set;
}

/** Pixels of `src` that differ from `ref` inside `box`. */
function diffPixels(src, ref, [x0, y0, x1, y1], thr = 40) {
  const set = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (src.has(x, y) !== ref.has(x, y) || (src.has(x, y) && l1(src.get(x, y), ref.get(x, y)) > thr)) set.add(x + ',' + y);
  return set;
}

const dilate = set => { const o = new Set(set); for (const k of set) { const [x, y] = k.split(',').map(Number); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) o.add((x + dx) + ',' + (y + dy)); } return o; };

/**
 * Compose a face onto `head` (Pix). V = { base, mouthBase, mouths:{key:Pix}, blink, gazeL, gazeR } as Pix on the same grid, `base` being
 * the master head the eye frames were cut for and `mouthBase` the closed-mouth frame. `eye`/`mouthKey` null leaves the head's own.
 */
export function composeFace(head, off, V, eye, mouthKey) {
  const out = head.clone(), eyeSrc = eye && V[eye], mSrc = mouthKey && V.mouths[mouthKey];
  const put = (src, mask, dx, dy) => { for (const k of mask) { const [x, y] = k.split(',').map(Number); if (src.has(x, y)) out.set(x + dx, y + dy, src.get(x, y)); } };
  if (eyeSrc) for (const [box, o] of [[EBL, off.eyeL], [EBR, off.eyeR]]) {
    // Mask in master coordinates: whatever the new eye differs by, plus the master's open eye (to wipe it); offsets register the iris so it lands on the head's own eye.
    const mask = dilate(new Set([...diffPixels(eyeSrc, V.base, box), ...featurePixels(V.base, box)]));
    put(eyeSrc, mask, o[0], o[1]);
  }
  if (mSrc) {
    const mask = dilate(new Set([...diffPixels(mSrc, V.mouthBase, MB), ...featurePixels(V.mouthBase, MB, 90)]));
    // Wipe the head's own (neutral) mouth too, where it sits after the shift.
    const own = featurePixels(head, [MB[0] + off.mouth[0], MB[1] + off.mouth[1], MB[2] + off.mouth[0], MB[3] + off.mouth[1]], 90);
    for (const k of own) { const [x, y] = k.split(',').map(Number); mask.add((x - off.mouth[0]) + ',' + (y - off.mouth[1])); }
    put(mSrc, mask, off.mouth[0], off.mouth[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Eyes with a fitted warp (shift, rotation, horizontal squeeze) for heads that are turned or tilted, where a plain shift is not enough.
// ---------------------------------------------------------------------------------------------
const EYE_C = { L: [67, 29], R: [78, 29] };

/** forward: target = C + d + Rot(rot) * diag(sx, 1) * (src - C). Returns the source coordinate a target pixel samples. */
const toSrc = (C, t, x, y) => {
  const px = x - C[0] - t.dx, py = y - C[1] - t.dy, c = Math.cos(t.rot), s = Math.sin(t.rot);
  return [C[0] + (c * px + s * py) / t.sx, C[1] + (-s * px + c * py)];
};

/** Fit the warp that carries the master's open eye (`base`) onto the head's own open eye. Luminance with the window mean removed. */
export function fitEye(base, head, side, { rots = [-0.14, -0.1, -0.05, 0, 0.05, 0.1, 0.14], sxs = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1], R = [8, 3], W = [5, 4] } = {}) {
  const C = EYE_C[side]; let best = null;
  for (const rot of rots) for (const sx of sxs) for (let dx = -R[0]; dx <= R[0]; dx++) for (let dy = -R[1]; dy <= R[1]; dy++) {
    const t = { dx, dy, rot, sx }, a = [], b = [];
    for (let y = -W[1]; y <= W[1]; y++) for (let x = -W[0]; x <= W[0]; x++) {
      const tx = C[0] + x + dx, ty = C[1] + y + dy; if (!head.has(tx, ty)) continue;
      const [sx_, sy_] = toSrc(C, t, tx, ty), qx = Math.round(sx_), qy = Math.round(sy_); if (!base.has(qx, qy)) continue;
      a.push(lum(head.get(tx, ty))); b.push(lum(base.get(qx, qy)));
    }
    if (a.length < W[0] * W[1]) continue;
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs((a[i] - ma) - (b[i] - mb));
    e /= a.length; if (!best || e < best.e) best = { e, dx, dy, rot, sx };
  }
  return best;
}

/** Lay a blink/glance patch onto one eye of `head` through the fitted warp `t`. `box` is the eye box in master coordinates. */
export function warpEye(out, head, base, eyeSrc, side, t, box) {
  const C = EYE_C[side], mask = dilate(new Set([...diffPixels(eyeSrc, base, box), ...featurePixels(base, box)]));
  const pad = 6;
  for (let y = C[1] - pad + t.dy; y <= C[1] + pad + t.dy; y++) for (let x = C[0] - 8 + t.dx; x <= C[0] + 8 + t.dx; x++) {
    const [fx, fy] = toSrc(C, t, x, y), qx = Math.round(fx), qy = Math.round(fy);
    if (mask.has(qx + ',' + qy) && eyeSrc.has(qx, qy)) out.set(x, y, eyeSrc.get(qx, qy));
  }
}

/** Like composeFace's eye step but warped per eye. `fits` = { L, R } from fitEye. */
export function composeEyesWarped(head, V, fits, eye) {
  const out = head.clone(), src = eye && V[eye]; if (!src) return out;
  warpEye(out, head, V.base, src, 'L', fits.L, EBL); warpEye(out, head, V.base, src, 'R', fits.R, EBR);
  return out;
}
