# Frame generation queue (#72)

Generates the standing presenters' missing frames in James's signed-in Gemini app, with checks and a contact sheet, then hands approved frames to the bake (`tools/bake/`). No paid generation, and no scripted clicking outside Claude in Chrome: scripting the consumer Gemini app risks the Google account.

Run from the repo root, in WSL (node is only there): `npm run frames -- <command> <presenter> ...`.

## Files

- `art/presenters/<name>/prompts.json`: one entry per frame, `source` (the frame to attach), `prompt` (pasted as is), and optionally `expect` (`{ dir: "left" | "right", measure: "changed" | "dark" }`) for frames that have to go a particular way. This replaces the `standing-*.md` files as the source for the queue; those stay as the written history.
- `art/presenters/<name>/queue.json`: the state. Commit it so each day's run resumes from it.
- `art/presenters/<name>/queue/staged/`: downloads waiting for approval (not committed).

## The loop

```bash
npm run frames -- queue fraser         # frames in frames.json with a prompt and no image yet (--redo v8,b7 to remake finished ones)
npm run frames -- next fraser          # what to attach, the prompt, the name to save as
npm run frames -- mark fraser h4v6 saved   # after saving the image (or: failed <why>, limit <note>)
npm run frames -- collect fraser       # pick up the downloads, stage them, run the checks
npm run frames -- sheet fraser         # tools/frames/out/fraser-contact.html, for James to approve by eye
npm run frames -- approve fraser h4v6 h4v7   # or --all; copies into the standing folder
npm run frames -- bake fraser          # runs tools/bake/bake.mjs; commit the images, the sheets and queue.json
```

Statuses: `pending` → `saved` → `passed` or `rejected` → `approved` → `baked`. A rejected frame goes back on the queue (`next` hands it out again) with the reason in `reasons`, so the next day's quota retries it. `reject <p> <frame> <why>` does the same for a frame rejected by eye on the contact sheet.

## Head crops (#71)

#71 decided that mouths and blinks come from an enlarged head crop (they change a third as many cells outside the face, and drift less), while nods, turns and tilts stay on full frames. A frame marked `"crop": true` in `frames.json` works that way:

- `frames.json` has one `crop` block: `box` (left, top, width, height in image pixels, the head and collar) and `scale` (3, nearest-neighbour).
- `queue` cuts the crop of the frame's parent head into `art/presenters/<name>/queue/crops/<parent>.png` (not committed) and that is what `next` hands out to attach. The prompt is the same.
- The image Gemini returns is the crop. `collect` and the bake register it onto the parent's grid (`tools/bake/crop.mjs`: scale and shift by image match, then read at the parent's cells) and take only the frame's box from `boxes` in `frames.json`; everything else stays the parent's. `approve` saves it as `<frame>-crop.jpg`, so it cannot be mistaken for a full-frame image of the same name.
- The checks add the fit: `stats.fit` is the scale (about 1) and the match error over what should not have changed. Over 30 means the crop redrew more than the face, and the frame is rejected. A typical good one is under 10.

## Checks (`check.mjs`)

Each new frame is read on the presenter grid and compared with its parent:

- **Outside its area:** solid groups of changed cells outside the editable area (the same areas the bake clamps to: `head` above `headCut`, `legs` below `feetTop`, `arm` below `headCut`, `mouth` and `eyes` inside their box, `patch` inside the face boxes). Scattered specks are generator drift and are ignored. The limit (80 cells) sits above everything already accepted, so it catches a redrawn head or a moved body, not noise.
- **Wrong way:** `measure: "changed"` compares where an arm's new pixels sit with the middle of the figure; `"dark"` compares where the pupils sit, read from the full-size image because a pupil is under one grid cell. On the existing frames it flags the old `v8` and `v8-redo` (both glance right) and `b7` (arm out on the wrong side).
- Wrong shape, or nothing changed inside the area.

Isla's `patch` frames (`v1` to `v9`) have no face boxes in `frames.json`, so their outside-area check is skipped.

## Collecting downloads

`collect` reads the Windows Downloads folder when run in WSL, or whatever `--from <dir>` last named (remembered in `queue.json`; Chrome on this machine saves to `D:Downloads`, so the first run is `collect <p> --from /mnt/d/Downloads`). Downloads up to 5 minutes older than the `saved` mark still count, so marking after the download is fine. Older files do not: an unnamed `Gemini_*` file left from an earlier run is paired with the first saved frame and shifts every frame after it by one, so move strays out of the folder (or name them) before a run, and look at the contact sheet before approving. A file named for its frame (`h4v6.png`) is matched by name. Gemini's own names (`Gemini_Generated_Image_...`) are paired with the frames marked `saved`, in the order they were saved: one download per frame, and it refuses if the counts differ (`--force` pairs them anyway).

## Background run (Claude in Chrome, Haiku is enough)

1. `npm run frames -- status <p>`. If `limitHit` is under a day old, stop: the quota has not reset.
2. `npm run frames -- next <p> --json` for the frame: `attach` is a Windows path, `prompt` is the text, `saveAs` the name.
3. In the signed-in Gemini (`gemini.google.com/images?dest=create`), start a fresh chat. Find "Upload & tools" and the prompt box by ref, click "Upload & tools" so the menu is open (the file input only exists in the page while it is, and appears a moment after it opens), then `find` "Upload files menu item or file input" and use the ref whose name is "(file input)" (layout banners shift the box, so never click by coordinates), upload `attach` with the file input, type the prompt, press Enter. Use the Chrome batch call for the fixed steps.
4. When the image appears, download it (one download per frame) and run `mark <p> <frame> saved`. If no image has appeared after about 2 minutes (a request can hang with no error), take a screenshot, and if Gemini is still working or shows nothing, run `mark <p> <frame> failed "no image after 2 minutes"`, open a fresh chat and go on to the next frame. Do not wait longer, and do not resend in the same chat.
5. If Gemini says the daily limit is reached ("Image Edit Request Denied" or similar), run `mark <p> <frame> limit "<the message>"` and stop. Do not retry.
6. Repeat from step 2 until `next` says nothing is left, then `collect <p>` and `sheet <p>`.

Without Chrome connected the same queue works by hand: `next` prints everything to paste, save each image into Downloads (named by frame is easiest), then `collect`.

## Not done

- Crops only for mouths and blinks (`area` mouth or eyes): a head, arm or legs frame is still a whole frame.
- Frames not listed in `frames.json` (Fraser's `h5v*`, `h6v*`, `h2v*`, `v8`) are not queued; add the frame to `frames.json` first, and its prompt is already in `prompts.json`.
