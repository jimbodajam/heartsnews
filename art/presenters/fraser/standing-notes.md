# Standing Fraser: what was made in code and what was generated (#68)

Start here for the next presenter (#13 plans a third). Code is `site/spike-lib/fraser-frames.js` (the Fraser set), `body-warps.js` (head and leg warps) and `pixel-derive.js` (eyes, mouths, keying). Preview: `site/pixel-standing-fraser.html`; showcase: `/test`.

## Generated
- `b1` the full-length hands-down master (`standing-prompts.md`, 848 x 1264). Its background came out dull purple-pink (184, 52, 137), not flat magenta, so `toGrid` takes `bg` and keys that colour. Use `bg` for any master whose background is off.

## Made in code from `b1`
| Frame | How | Result |
|---|---|---|
| Nod down / up | `warpHead`: 1 px shift and a 3-4% vertical squeeze about the neck | clean, hair and ears hold |
| Tilt right / left | `warpHead`: rotation of 0.12 rad about the neck, rows above the collar only | clean on a bald head; a haired head (Isla) shows a stray line at the neck |
| Weight right / left leg, feet apart | `warpLegs`: each trouser leg slides sideways up to 3-4 px at the foot, the foot lifts 2 px | fine on straight trousers; will not reproduce Isla's bent knee |
| Blink, glance left / right | `pixel-derive` `blink` and `gaze` on the master eyes (window 58,20,90,36) | works; the glance is a one-pixel move because his irises are small |
| Six mouths (smile, closed, small, wide, O, A) | `pixel-derive` `detectMouth` and `mouth` (window 66,37,80,42), his own lip colours | works; shapes are small because his mouth is thin |
| Eyes and mouths on moved heads | drawn on the master head first, then the whole head is warped | no registration step needed, unlike Isla's generated head frames |

## Generated after the first pass (`standing-gap-prompts.md`)
- Head turn right and left (`h1`, `h2`): a turn changes the nose and ear, a warp cannot fake it. Both came out as a firm three-quarter turn, bigger than the 8 degrees asked for.
- Arm poses `b2` to `b8`: arms are new pixels. They register on `b1` to within about 15 changed pixels outside the arms, so they drop straight in. `b7` was asked for the viewer's left arm but came out on the right (same side as `b3`), so it is a second right-arm pose; regenerate if a left-arm one is wanted.

On `h1`/`h2` the eyes and mouth are found on the turned head itself (windows in `FACE` in `fraser-frames.js`) and drawn with the same `blink`, `gaze` and `mouth`, so no extra frames are needed. Blinks close the near eye cleanly but the far eye is a sliver and barely changes.

## What we learned
- Validating on Isla first: a plain global shift or rotation cannot match her generated head frames pixel for pixel (they are re-drawn, not moved), so a changed-pixel score is noisy and misleading. Judge by eye on the zoomed frames. Only tilt and the small nods are close to code-made.
- Frame names are shared between presenters (`b1`-`b8`, `h1`-`h5`, `f1`-`f3`), so a broadcast can pick frames by name. Fraser uses `h3` (nod down), `h4` (nod up), `h5` (tilt left, as Isla's), `h6` (tilt right, new), `f1`-`f3`.

## Nods and tilts generated too (31 Oct)
`h3`-`h6` were generated from `standing-head-prompts.md` and now replace the code warps (the warp is kept as a fallback for any head that is not generated). The generated heads move the face by several rows (nod up lifts it about 5), so fixed eye and mouth windows do not work: `findFace` in `fraser-frames.js` finds the eyes in a wide window and puts the mouth window about 11 rows below them, perpendicular to the eye line, which follows the tilt. Mouths land well on all four. Blinks close one eye cleanly on `h4` and `h6`, because the far eye's white is too small for `detectEyes`; a fix is to find that eye by hand or lower the brightness threshold for Fraser's grey-blue eyes.
