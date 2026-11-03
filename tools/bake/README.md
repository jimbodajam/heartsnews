# Presenter bake (#69)

Turns the generated standing frames into one indexed PNG sheet and one JSON file per presenter, in `site/public/presenters/`. The browser only stacks layers (`site/public/test/presenter-player.js`). Keying, face detection and colour matching all happen here.

Run from the repo root, in WSL:

```bash
node tools/bake/bake.mjs
```

Commit the sheets and JSON it writes. Each run prints the sheet size and its checks, and writes a before and after picture to `tools/bake/out/`.

## Inputs

- **Frame list:** `art/presenters/<name>/frames.json`. Each frame has a name, a parent and an editable area. A frame with no image yet is skipped and picked up on a later bake.
- **Palette:** `art/presenters/<name>/palette.json`, 128 colours. It is locked: later bakes snap to it, so new frames and touch-ups stay in the same colours. `--new-palette` rebuilds it, and changes the colours of every frame. 32 and 64 colours were tried and dull Isla's eyes.
- **Touch-ups:** `art/presenters/<name>/touchups/<frame>.png` replaces that frame's generated image. To make one, run `node tools/bake/bake.mjs --export`, copy the frame from `tools/bake/out/export/<name>/`, edit it in Aseprite or similar at 145x216, and bake.

## Editable areas

Everything outside a frame's area goes back to its parent, so generator drift cannot flicker between frames.

| Area | Keeps |
|---|---|
| `head` | Rows above `headCut` |
| `legs` | Rows from `feetTop` down |
| `arm` | Solid groups of changed cells below `headCut`; specks stay on the parent |
| `mouth`, `eyes` | That head's box in `boxes` in `frames.json`. `--boxes` prints where a head's frames changed |
| `patch` | Cut by the compose code, for the `v` frames |

## How layers are made

`site/spike-lib/compose.js` is the one compose for every presenter (#70). It runs here, once per head, eye, mouth, pose and feet choice. Each result is saved as a cropped layer, or as the cells that differ from its base. A `cut/` layer lists cells a change clears. The bake then compares every combination it checks against the composed frame and prints any that differ.

Expected differences: eyes and mouth changing together. On Fraser's mouth-set heads the old code lost the mouth during a blink, and the layers keep it. On Isla a few cells differ where the two patches touch.

## Grids and crops

Full frames use the fixed grid (5.865 px, offset 0.25) that every cut row and box was tuned on. They have no art grid to detect: the strongest period is 5.297 px, the same on both presenters, which is the generator's upscale.

Head crops do not land on the master's cells, so `registerCrop` fits scale and shift against the master, using what is meant to stay the same, and `cropToGrid` reads the crop at the master's cells. The palette snap restores the edges. `node tools/bake/crop-proof.mjs` shows it on the #71 test crops: `tools/bake/out/crop-proof.png`, with the full frame, the old resample and the registered crop side by side. To use a crop in a bake, `frames.json` still needs a crop entry that calls these two functions.

## Sizes

| | Before | Baked |
|---|---|---|
| Isla | 9.9MB of JPEGs | 33.5KB PNG + 3.7KB JSON |
| Fraser | 18.7MB of JPEGs | 36.6KB PNG + 3.2KB JSON |

## Face rules (`face` in `frames.json`)

A new presenter needs `frames.json` and its frames, no code. The `face` block says how each head gets its eyes and mouth:

| Key | Meaning |
|---|---|
| `register` | `iris` lines a patch head up by iris landmark and image fit; `detect` finds the eyes and mouth on the head itself |
| `patch` | Generated eye and mouth frames cut for the master head: `base`, `mouthBase`, `registerMouth` (iris only), `mouths`, `eyes`, optional `boxes` |
| `mouthAlias` | A mouth key that borrows another's frame, e.g. `closed` to `smile` |
| `heads.<name>.mode` | `patch` lays the patch frames over the head by offset. `set` uses the head's own generated frames named `<head><patch frame>` (`h1v1`, blink `h1v7`). `code` draws eyes and mouth in code |
| `eyeWin`, `mouthWin` | Rough windows round the eyes and mouth for detection. Without them the face is found in a wide window |
| `warpEyes` | Patch eyes through a fitted shift, tilt and squeeze, for turned and tilted heads |
| `nudge` | `{eye, mouth}` hand shift in x on top of the registered offset |
| `mouthScale` | `code` mode only: `{w, open}` scale on the drawn mouth, for a foreshortened head |

Keep the modes few. A one-off fix is a touch-up PNG, not a new mode.

## Seated sets (#78)

A seated presenter is a second set beside the standing one: `art/presenters/<name>-seated/` (`frames.json`, `prompts.json`, `queue.json`) baked to `site/public/presenters/<name>-seated.{json,png}`. The grid is 240x131 (the same 5.865 px cell), with no feet and no legs. The frames come from the same queue as the standing ones (`tools/frames/README.md`, "Seated sets").

**Adding one**

1. **Master (`b1`).** Make it by hand, not through the queue. Attach the presenter's *standing* master to Gemini and ask for the same scale, seated, hands clasped, neutral face, no desk. Check the head height against the standing master. The old desk master was tried first and Gemini ignored "make it smaller", and the standing heads cannot be reused (the seated heads are about 20-25% larger and redrawn).
2. **Scaffold.** Write `<name>-seated/seated.json` (`standing`, `pronoun`, `look`, `clothes`, `mouth`) and run `node tools/frames/seated.mjs <name>`. Running it again overwrites `frames.json`, so stop once the values below are tuned.
3. **Tune `frames.json` by hand.** `paletteFrom` shares the standing palette (the bake then does not write one). `feet: []` with `feetTop` equal to the grid height means no feet. `handsTop` is the first row the `hands` area may change, and it is written into the baked JSON. `heads.b1` needs `eyeWin`, `mouthWin` and `mode: "patch"`, and `face.patch.boxes` (`EBL`, `EBR`, `MB`) must hug the eyes and mouth: without them the patches change nothing, and loose boxes make the detector return the window edge.
4. **Heads.**
   - **Nods (`h3`, `h4`):** `mode: "patch"`, with `face.register: "shift"`. The shift fit slides the head over the master (shift and a small turn, over the whole face) because the eye and mouth detectors were not steady on the larger seated heads.
   - **Turns (`h1`, `h2`):** `mode: "set"`, with their own `h1v1`-`h1v7` and `h2v1`-`h2v7` frames and `boxes.h1`/`boxes.h2` in `frames.json`. A patch from the straight head does not fit a turned face. Gemini turns a head the wrong way for the left turn; mirror `h1` (and `h1v*`) for `h2`.
   - **Leans (`tilt-6`, `tilt-3`, `tilt3`, `tilt6`):** `mode: "tilt"` with `deg`, and a `face.tilt` block (`chin`, `neck`, `cx`, `maxY`, `seed`, `pivot`). No generated frames: the bake turns the master head's own pixels about the neck, with each mouth and the blink composed first. The outline is flood-filled from the face over colours the head uses and the clothes do not, cut at the chin row so the neck stays still, and the turn is RotSprite-style (8x sub-samples, commonest colour wins). Fine to about 10 degrees; the plan caps it at 6. Generated lean frames were tried first and the straight-head mouth patches could not be turned far enough to look right.
5. **Poses (`d1`-`d5`).** Hands resting, clasped, holding papers, an open-hand gesture, turned to the other presenter. Prompts say there is no desk, because a master with no desk makes Gemini draw one.
6. **Bake** with `node tools/bake/bake.mjs <name>-seated`, then look at it on `/test/seated.html` (every head, pose and mouth) and `/test/tilt.html` (the lean on its own).

**Showing them.** The seated figures sit behind the desk and the desk is drawn over them, so it cuts them off at the waist. Drawing the arms in front of the desk was tried: the torso and sleeves are one colour, and every version either hung the arms off the front, cut them at the back edge or put the body on the desk. `site/pixel-broadcast-spike.html?seated=1` plays them (`hcut`, `propx`, `idx idy fdx fdy` in the URL, or the panel, K hides it). They do not bob; a seated figure does not move up and down. They nod, lean and turn to the other presenter (`seatedHead` in the spike) while they speak or listen.

**The desk.** The seated sets use `art/desk-pixel-v3.jpg` (`site/public/spike/desk-pixel-v3.jpg`): the first desk with the top surface about 50% deeper and a dark back edge, made by giving Gemini the old desk and asking for just that. Its grid starts at image row 272, where the old one started at 352 (`deskFromGrid(img, badge, top)`), and the props stand 15 rows lower. `?olddesk=1` brings the first desk back.
