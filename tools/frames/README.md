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

## New standing sets (#89)

A new presenter's standing set is scaffolded like a seated one: write `art/presenters/<name>/standing.json` (`pronoun`, `look`, `top`, `legs`, `mouth`, `crop`) and run `node tools/frames/standing.mjs <name>`. The prompts are Fraser's, with every direction named by the image edge. The master is made by hand first (`art/presenters/ross/master-prompts.md` is the recipe: Fraser's standing master attached for framing only, then the seated master from the new standing one). Leans and the left glance are left out (made in code). The left turn `h2` gets one try (Gemini turned Fraser the wrong way but got Isla right); if it fails, mirror `h1` and `h1v*`. Round 1 is 22 frames, round 2 is `h1v1`-`h1v7` and `h2v1`-`h2v7` once each head is approved. Re-running overwrites `frames.json`. `"screen": "left"` in `standing.json` (Kirsty, #90: the touchscreen is on the left of the picture) points `b2`/`b3` at the left edge and `b6`/`b7` at the right, and adds `b9`, a hand on the touchscreen (23 frames in round 1).

**Face boxes for the straight-head mouths and blinks.** The `v` crops read back as unchanged until `face.patch.boxes` (`EBL`, `EBR`, `MB`) and `face.heads.b1` (`eyeWin`, `mouthWin`) are set. `node tools/frames/face-boxes.mjs <set>` reads each staged `v` crop over the whole head and lists where it changed (`face-boxes.mjs <set> h1` does the same for a turned head's set and suggests `boxes.h1`, before any of it is approved); ignore the specks at the hair and ear edges, take the eyes from `v7`/`v9` and the mouth from the rest, add a cell, then `recheck`. Works for standing and seated sets. The right glance `v9` cannot be measured on a crop (`direction: null`), so judge it by eye and `approve --force`.

**After an unattended run, name the downloads before `collect`.** On Ross's first run two clicks gave no file, so pairing Gemini's unnamed downloads in save order slipped by one frame twice. Copy each download to a folder as `<frame>.jpg` (check by looking: a mouth crop, an arm pose, a leg pose are easy to tell apart), then `collect <p> --from <that folder>`. Never `--force`.

## Seated sets (#78)

`isla-seated` and `fraser-seated` are queued like any presenter. `node tools/frames/seated.mjs <p>` wrote their `frames.json` and `prompts.json`; the masters are `site/public/spike/<name>/seated/b1.jpg`. Run in two rounds, because the turned-head mouths and blinks (`h1v1`-`h1v7`, `h2v1`-`h2v7`) are made from the turned head, so `queue` holds them back until `h1` and `h2` are approved (it prints "Waiting for a parent image").

**Round 1** (18 frames each, about a day of free quota per presenter): `h1`-`h6`, `v1`-`v7`, `d1`-`d5`. Everything depends only on the master.

**Between rounds**, by hand with James: approve `h1` and `h2` on the contact sheet, then add `boxes.h1` and `boxes.h2` (`eyes` and `mouth`, found with `node tools/bake/bake.mjs <p> --boxes`) to the seated `frames.json`, and re-run `queue`.

**Round 2** (14 frames each): `h1v1`-`h1v7`, `h2v1`-`h2v7`.

Frames to look at hardest on the contact sheet: `h1`/`h2` (direction, the check catches a wrong way), `d4`/`d5` (arm direction, and that nothing appears below the desk edge), and the `v` frames (the face must not move).

Brief for a background Haiku run, per presenter (`isla-seated`, then `fraser-seated`): follow "Background run" above. Use `npm run frames -- next <p> --json` for each frame, never click by coordinates, one download per frame, stop at the daily limit with `mark ... limit`, and finish with `collect <p>` and `sheet <p>`. Do not approve, bake or commit; James approves from the contact sheet.

**What was learned on the seated run**

- **The direction check misreads small head turns** (`h1`/`h2`): it measures changed cells against the middle of the figure. Look at the frame and use `approve <p> <frame> --force` to accept a frame the checks rejected.
- **Gemini turns Fraser the wrong way** for the left turn. Mirror the right turn instead: flip `h1` (and the `h1v*` crops) for `h2`. Isla's `h2` was made the same way.
- **The content filter.** A refusal reads "I can't generate the image you requested right now due to interests of third-party content providers". It is the copyright and likeness filter, not an error and not the daily limit, and it fires at random on some mouth requests for Fraser's face. Do not resend the same prompt: use a shorter one (drop "do not change the pose…" and "his mouth is thin…", and ask for "the mouth slightly open and rounded, as if saying the letter O"), or mirror the frame from the other turned head if one exists.
- **The upload menu is flaky.** The first click on "Upload & tools" often finds no file input; press Escape, click it again, then `find` "(file input)". Text typed right after an upload can be lost, so find the prompt box again first.
- **`recheck <p> [frame...]`** runs the checks again on the staged images, after the boxes in `frames.json` change. **`next`** hands out a frame whose last run failed last, so one refusal does not hold up the rest.
- **The `v` frames need boxes.** A `patch` crop frame takes its pixels from the master's `eyeWin`/`mouthWin` (or `boxes.b1.patch`); with none the whole frame is read back as unchanged.
- **Leans are not generated** (see `tools/bake/README.md`): the nods use the `v` patches and the leans are the master head turned by code, so no `h5`/`h6` frames are needed. The ones already generated stay in the repo.
