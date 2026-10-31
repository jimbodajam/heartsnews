// Standing-presenter frames made in code from the hands-down master (no generation): head moves and weight shifts.
// Both work on a Pix (see pixel-derive.js). Written for #68 and checked on Isla's generated h/f frames first.

/** Head frame: rows [0, rows] of `P` warped about `piv` (neck): shift dx,dy, rotation `rot` (radians, + is clockwise on screen), horizontal squeeze `sx`, vertical squeeze `sy`. Rows below stay as in `P`. */
export function warpHead(P, { dx = 0, dy = 0, rot = 0, sx = 1, sy = 1 }, { piv, rows }) {
  const O = P.clone(), c = Math.cos(rot), s = Math.sin(rot);
  for (let y = 0; y <= rows; y++) for (let x = 0; x < P.w; x++) {
    const px = x - piv[0] - dx, py = y - piv[1] - dy;
    const qx = Math.round(piv[0] + (c * px + s * py) / sx), qy = Math.round(piv[1] + (-s * px + c * py) / sy);
    if (qy <= rows + 4 && P.has(qx, qy)) O.set(x, y, P.get(qx, qy)); else O.d[O.idx(x, y) + 3] = 0;
  }
  return O;
}

/**
 * Legs frame: below row `top` each leg slides sideways (more the nearer the foot) and the foot can lift. `cx` is the column between the legs.
 * L and R are { dx, lift } at the foot (dx in pixels, + is screen right, lift in pixels up). Rows above `top` are untouched; the sliver that opens
 * between the legs is filled with the dark inner-leg colour so it does not show background.
 */
export function warpLegs(P, { L = { dx: 0, lift: 0 }, R = { dx: 0, lift: 0 } }, { cx, top, foot, fill }) {
  const O = P.clone();
  for (let y = top; y < P.h; y++) for (let x = 0; x < P.w; x++) O.d[O.idx(x, y) + 3] = 0;
  const f = y => Math.min(1, Math.max(0, (y - top) / (foot - top)));
  for (const [side, T] of [['L', L], ['R', R]]) {
    for (let y = top; y < P.h; y++) {
      const k = f(y);
      for (let x = 0; x < P.w; x++) {
        if (side === 'L' ? x > cx : x <= cx) continue;
        const sy = Math.round(y + T.lift * k * k), sx = Math.round(x - T.dx * k);
        if (sy >= top && sy < P.h && (side === 'L' ? sx <= cx : sx > cx) && P.has(sx, sy)) O.set(x, y, P.get(sx, sy));
      }
    }
  }
  if (fill) for (let y = top; y < P.h; y++) { let a = -1, b = -1; for (let x = 0; x < P.w; x++) if (O.has(x, y)) { if (a < 0 || x <= cx) a = x; if (x > cx && b < 0) b = x; } for (let x = a + 1; x < b; x++) if (a >= 0 && b >= 0 && !O.has(x, y) && y < top + 18 && b - a < 8) O.set(x, y, fill); }
  return O;
}
