// One locked palette per presenter (#69): built once from the frames, then kept in art/presenters/<name>/palette.json so later frames and touch-ups snap to the same colours.

/** sRGB to OKLab, so "nearest colour" matches what the eye sees. */
const memo = new Map();
export function lab(c) {
  const key = (c[0] << 16) | (c[1] << 8) | c[2], hit = memo.get(key); if (hit) return hit;
  const [r, g, b] = c.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122 * r + 0.5363 * g + 0.0514 * b), m = Math.cbrt(0.2119 * r + 0.6807 * g + 0.1074 * b), s = Math.cbrt(0.0883 * r + 0.2817 * g + 0.6300 * b);
  const out = [0.2105 * l + 0.7937 * m - 0.0041 * s, 1.9779 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
  memo.set(key, out); return out;
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Median cut then a few rounds of k-means. Counts are square-rooted so a small bright feature (an eye white, a lip) is not swamped by the suit. */
export function buildPalette(frames, size) {
  const counts = new Map();
  for (const P of frames) for (let i = 0; i < P.d.length; i += 4) if (P.d[i + 3]) { const k = (P.d[i] << 16) | (P.d[i + 1] << 8) | P.d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
  const pts = [...counts].map(([k, n]) => { const c = [k >> 16, (k >> 8) & 255, k & 255]; return { c, l: lab(c), w: Math.sqrt(n) }; });
  const boxes = [pts];
  while (boxes.length < size) {
    let bi = -1, bs = 0, axis = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let a = 0; a < 3; a++) { const vs = b.map(p => p.l[a]), s = (Math.max(...vs) - Math.min(...vs)) * Math.sqrt(b.reduce((t, p) => t + p.w, 0)); if (s > bs) { bs = s; bi = i; axis = a; } } });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p.l[axis] - q.l[axis]), half = b.reduce((t, p) => t + p.w, 0) / 2;
    let acc = 0, cut = 1; for (let i = 0; i < b.length - 1; i++) { acc += b[i].w; if (acc >= half) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  let centres = boxes.map(b => { const t = b.reduce((s, p) => s + p.w, 0); return [0, 1, 2].map(i => b.reduce((s, p) => s + p.c[i] * p.w, 0) / t); });
  for (let round = 0; round < 8; round++) {
    const sum = centres.map(() => [0, 0, 0, 0]), labs = centres.map(c => lab(c.map(Math.round)));
    for (const p of pts) { let bi = 0, bd = Infinity; labs.forEach((l, i) => { const d = d2(p.l, l); if (d < bd) { bd = d; bi = i; } }); for (let i = 0; i < 3; i++) sum[bi][i] += p.c[i] * p.w; sum[bi][3] += p.w; }
    centres = sum.map((s, i) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[i]);
  }
  return centres.map(c => c.map(Math.round)).sort((a, b) => lab(a)[0] - lab(b)[0]);
}

/** Maps a colour to its palette index, remembering answers (the frames repeat a lot of colours). */
export function snapper(palette) {
  const labs = palette.map(lab), cache = new Map();
  return c => { const k = (c[0] << 16) | (c[1] << 8) | c[2]; let i = cache.get(k); if (i === undefined) { const l = lab(c); let bd = Infinity; labs.forEach((p, j) => { const d = d2(l, p); if (d < bd) { bd = d; i = j; } }); cache.set(k, i); } return i; };
}

export function snapPix(P, palette, snap = snapper(palette)) {
  const out = P.clone();
  for (let i = 0; i < out.d.length; i += 4) if (out.d[i + 3]) { const c = palette[snap([out.d[i], out.d[i + 1], out.d[i + 2]])]; out.d[i] = c[0]; out.d[i + 1] = c[1]; out.d[i + 2] = c[2]; }
  return out;
}
