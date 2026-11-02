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
