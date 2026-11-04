# Gregor masters and run (#91)

Gregor Moffat has no earlier art, so the masters are made from a description, the way Ross's and Kirsty's were (`art/presenters/ross/master-prompts.md`, `art/presenters/kirsty/master-prompts.md`). The framing reference is Ross's standing master (`site/public/spike/ross/standing/b1.jpg`): straight on, arms down, on the 145 x 216 grid `tools/frames/standing.mjs` is tuned for. The seated framing is Fraser's seated master, as for Ross and Kirsty.

Look from `channel.json`: light warm skin (#e6ad8c), short grey hair (#a39d94), slate-blue suit (#3c5068), pale blue shirt (#c9d6ea), near-black tie (#26262e), and at the ground a coat, a maroon scarf (#6d1a2a) and a headset. He is in his late 50s, from Kirkcaldy, the pitchside reporter: forty years on the road, warm and breathless. Like the others he wears the small maroon heart pin on his left lapel (on the coat lapel when he wears the coat).

## Two looks, four masters

James wants Gregor to work in the studio later as well as at the ground, so there are two looks:

| Look | Wears | Sets | Masters |
| --- | --- | --- | --- |
| Pitchside (used now) | coat, scarf, headset over the suit | `gregor`, `gregor-seated` | `site/public/spike/gregor/{standing,seated}/b1.jpg` |
| Studio (later) | suit and tie only | `gregor-studio`, `gregor-studio-seated` | `site/public/spike/gregor-studio/{standing,seated}/b1.jpg` |

Only the pitchside sets go through the frame queue in #91. The studio masters are made now so the face is settled, and their frames are a follow-up.

The studio standing master is made first, from the description. The pitchside standing master is an **edit** of it (coat, scarf and headset added), so the face, legs and framing are the same man on the same grid. Each seated master is then made from its own standing master, the proven Ross/Kirsty route.

## What is different for Gregor

- **The coat stops at the hip.** The leg frames `f1`-`f3` and `feetTop` 138 assume trousers below a hem about 65% of the way down. A knee-length overcoat would sit below `feetTop`, and every leg frame would have to redraw it. So it is a short car coat, ending where a suit jacket would.
- **The coat is open**, so the suit, shirt and tie still show and the figure reads as the same man as the studio look.
- **The scarf hangs inside the coat.** It sits below `headCut` (row 48), so the head turns must not move it, and the arm frames must keep it unchanged, like a tie.
- **The boom mic stops at the cheek.** The mouth frames are crops of the head, and a boom across the lips would be redrawn on every one. The boom comes from the ear pad on his left ear (the right side of the picture) and ends at his cheekbone, well clear of the mouth.
- **The headset turns with the head.** On `h1`/`h2` the headband and ear pads move with the head. Check that the boom still ends clear of the mouth on the turns.
- **Grey hair, short.** It is nothing like Kirsty's long hair, so the turns should be easy. A side parting would flip if `h2` has to be mirrored from `h1`, so the hair is cut short with no strong parting.
- **No screen.** Gregor doesn't use the touchscreen, so `standing.json` has no `screen`, and `b2`/`b3` follow Ross's directions (22 frames in round 1).

## 1. Studio standing master (`gregor-studio` `b1`)

Fresh request in Gemini (`gemini.google.com/images?dest=create`). Attach `site/public/spike/ross/standing/b1.jpg` (framing and style only). Save as `site/public/spike/gregor-studio/standing/b1.jpg`, 848 x 1264.

Check before keeping it:
- Clearly a man in his late 50s with short grey hair, not a copy of Ross: different face, hair, age and clothes.
- Slate-blue suit, jacket buttoned, pale blue shirt, near-black tie, small maroon heart pin on his left lapel (the right side of the picture).
- Both arms hang straight down, hands open, nothing in the pockets.
- Full length, both shoes on the ground, feet a little apart and level.
- Face straight at the viewer, head not tilted or turned, mouth closed and neutral.
- Head about the same height and size as Ross's, figure in the same place, jacket hem at about the same height.
- Flat magenta background, no floor or shadow, hard pixel edges.

```text
Create a full-length pixel-art image of a new TV sports presenter, standing. Use the attached image only for the framing and the style of drawing: the figure is the same height and in the same place in the frame, on the same flat magenta background, in the same chunky pixel-art style with a dark outline and the same pixel grid. Do not copy the man in the attached image: a different face, hair, age and clothes.

The presenter is a Scottish man of 58, a veteran football reporter, of medium build, with light warm skin with a slight ruddy glow on the cheeks, a warm, cheerful, weathered face with a few laughter lines, light blue eyes and grey eyebrows. His hair is short and grey, neatly cut, a little thin on top, with no strong parting. He is clean-shaven. He wears a slate-blue suit, the jacket buttoned, a pale blue shirt, a plain near-black tie, and a small maroon heart pin on his left lapel.

He stands facing straight at the viewer, full length from the top of his head to his shoes, in a calm, neutral stance while someone else is talking. Both arms hang straight down relaxed at his sides, hands open with the fingers together, not in his pockets and not clasped. His feet are on the ground a little apart and level, in black formal shoes, with matching slate-blue suit trousers. His head is straight, not tilted or turned, his eyes look at the viewer, and his mouth is closed with a neutral, faint expression. Flat magenta background, no floor, no shadow, no text. Output size 848 x 1264.
```

## 2. Pitchside standing master (`gregor` `b1`)

Fresh request. Attach the studio standing master. Save as `site/public/spike/gregor/standing/b1.jpg`.

Check before keeping it:
- The same man: face, hair, trousers, shoes and stance unchanged, at the same place and size.
- An open dark coat ending at the hip, at about the height of the suit jacket hem, with the suit jacket, shirt and tie visible in the opening.
- A maroon scarf once round the neck, its ends hanging inside the coat.
- A headset: thin black headband, small black ear pads, a short boom from the pad on his left ear (right side of the picture) ending at the cheek, clear of the mouth.
- Heart pin on the coat's left lapel.
- Arms still straight down, hands open.

```text
Edit this image. Keep the man exactly the same: the same face, hair, expression, eyes, mouth, head position and size, the same trousers, shoes, feet and stance, the same arms hanging straight down with the hands open, in the same place in the frame, on the same flat magenta background, in the same pixel-art style and pixel grid. Do not move or resize the figure.

Dress him for reporting from a football ground in winter. Add a short dark charcoal wool car coat over his suit, worn open and unbuttoned, with the sleeves down to his wrists. The coat is short: its hem ends at the top of his thighs, at the same height as the hem of his suit jacket, not lower, so his trousers below show exactly as before. The slate-blue suit jacket, pale blue shirt and near-black tie stay visible in the open front of the coat. Add a maroon knitted scarf wrapped once round his neck, its two ends hanging straight down inside the open coat. Move the small maroon heart pin onto the coat's left lapel. Add a broadcast headset: a thin black headband over the top of his head, a small black ear pad over each ear, and a short thin black microphone boom from the ear pad on his left ear (the right side of the picture) that curves forward and ends at his cheekbone, well away from his mouth. His mouth stays fully visible and unchanged. Flat magenta background, no floor, no shadow, no text. Output size 848 x 1264.
```

If the coat comes out long, ask in the same chat: "Keep everything else the same, but make the coat shorter so its hem ends at the top of his thighs, at the same height as his suit jacket hem." If the boom reaches the mouth: "Keep everything else the same, but make the microphone boom shorter so it ends at his cheekbone, well away from his mouth."

## 3. Pitchside seated master (`gregor-seated` `b1`)

Fresh request with two images attached, in this order: Gregor's pitchside standing master, then `site/public/spike/fraser/seated/b1.jpg` (framing and scale only). Save as `site/public/spike/gregor/seated/b1.jpg`, 1376 x 768.

```text
Create a pixel-art image of the presenter in the first image, seated, from the waist up. Use the first image only for who he is: the same face, short grey hair, skin, the open dark charcoal coat over the slate-blue suit, pale blue shirt and near-black tie, the maroon scarf with its ends inside the coat, the small maroon heart pin on the coat lapel, and the black headset with the short microphone boom on his left ear that ends at his cheekbone, well away from his mouth. Use the second image only for the framing, the scale and the style: the figure is the same size and in the same place in the frame, cut off at the same height, on the same flat magenta background, in the same chunky pixel-art style. Do not copy the man in the second image. He sits upright facing straight at the viewer, with his forearms forward and his hands clasped loosely in front of him at the bottom of the picture, as if resting on a desk, but there is no desk. His head is straight, not tilted or turned, his eyes look at the viewer and his mouth is closed and neutral. Flat magenta background, no desk, no chair, no shadow, no text. Output size 1376 x 768.
```

## 4. Studio seated master (`gregor-studio-seated` `b1`)

Fresh request with two images attached: the studio standing master, then `site/public/spike/fraser/seated/b1.jpg`. Save as `site/public/spike/gregor-studio/seated/b1.jpg`, 1376 x 768.

```text
Create a pixel-art image of the presenter in the first image, seated, from the waist up. Use the first image only for who he is: the same face, short grey hair, skin, slate-blue suit, pale blue shirt, near-black tie and the small maroon heart pin. Use the second image only for the framing, the scale and the style: the figure is the same size and in the same place in the frame, cut off at the same height, on the same flat magenta background, in the same chunky pixel-art style. Do not copy the man in the second image. He sits upright facing straight at the viewer, with his forearms forward and his hands clasped loosely in front of him at the bottom of the picture, as if resting on a desk, but there is no desk. His head is straight, not tilted or turned, his eyes look at the viewer and his mouth is closed and neutral. Flat magenta background, no desk, no chair, no shadow, no text. Output size 1376 x 768.
```

## Masters made 4 Nov

All four came out first time, except the pitchside standing master, which took one correction in the same chat. The first edit put the boom tip on the corner of his mouth, so the correction asked for a shorter boom ending halfway along the cheek. That fixed the boom, but the coat came back a little longer, with its hem at grid row 145. The leg frames only redraw from the knee down, so instead of asking again, `gregor/frames.json` has `feetTop` 147, and the leg prompts in `gregor/prompts.json` name the coat hem ("about 68% of the way down"). The boom now ends about a cell short of the mouth. Every mouth prompt (via `standing.json`/`seated.json` `mouth`) says to keep it unchanged.

The seated framing matches Ross's almost exactly, so `gregor-seated/frames.json` takes Ross's crop box `[440, 10, 500, 340]`, `headCut` 55 and `handsTop` 105, the way Kirsty's did. The leans `h5`/`h6` are left out. Both head crops were checked on the masters: they take in the headset, the boom and the top of the scarf.

## 5. Round 1 (`gregor` 22 frames, `gregor-seated` 16)

Standing: `h1`-`h4`, `v1`-`v7`, `v9`, `b2`-`b8`, `f1`-`f3`. Seated: `h1`-`h4`, `v1`-`v7`, `d1`-`d5`. Run it the way Kirsty's was (section 3 of `art/presenters/kirsty/master-prompts.md`): name each download `art/presenters/<p>/queue/named/<frame>.jpg` as it lands, and finish with `collect <p> --from art/presenters/<p>/queue/named` and `sheet <p>`.

Look hardest at:
- `h1`/`h2`: the boom and ear pads turn with the head, and the boom still ends clear of the mouth. Check `h2` at full size: on the right turn `h1` the left ear shows. Do not mirror `h1` for `h2`: the boom is on one ear only, so a mirrored `h1` would move it to the other ear.

**Round 1, 4 Nov (Haiku run):** `gregor` got all 22 frames, and `gregor-seated` stopped at the daily limit after 6 (resets 5:24 PM). Gemini turned **both** `h2`s (standing and seated) towards the right edge, the same as `h1`. Both are re-queued. The fix is to attach the master **flipped** (`queue/mirrored/b1-flipped.jpg`, boom on the other side), use `h1`'s prompt (the right turn Gemini gets right), and flip the result back. That gives a left turn with the boom on his left ear again, and the figure sits on the image centre, so no shift is needed. Standing `f1` also went the wrong way (the same pose as `f2`). It is now `f2` flipped (`queue/mirrored/f1.jpg`). The flip also moves the pin, boom and scarf above `feetTop`, which trips the outside-area check, but the bake takes only the legs, so approve it with `--force`. Standing face boxes are set from `face-boxes.mjs` (specks at the headset band, the ear pad and the boom tip ignored), and all the `v` mouths and the blink pass. `v9` needs judging by eye. The turns in `h1` are larger than the 8 degrees asked for, about 25 degrees.
- The `v` mouths: the boom must not grow, move or join the lips.
- `f1`-`f3`: the coat hem must not move.
- Every head frame: the scarf below `headCut` must not change.

## 6. Round 2 and bake

As for Kirsty, section 4: set `boxes.h1`/`boxes.h2`, re-queue, run `h1v*`/`h2v*` (14 per set), tune `register: "shift"` (and Ross's `face.tilt` for seated), then bake into `site/public/presenters/gregor{,-seated}`.

## Studio look (follow-up)

Studio masters: `site/public/spike/gregor-studio/{standing,seated}/b1.jpg`. To scaffold, copy `gregor/standing.json` and `gregor-seated/seated.json` into `gregor-studio/` and `gregor-studio-seated/`, take the coat, scarf and headset out of `look`/`top`/`clothes`/`mouth`, and set `"standing": "gregor-studio"`. `feetTop` goes back to 138, because the suit jacket hem is at row 132, as on Ross.

**Round 1 done 4 Nov, evening.** Both `h2`s were remade with the flip: the master flipped (`queue/mirrored/b1-flipped.jpg`), `h1`'s prompt, and the download flipped back (`queue/mirrored/h2-raw.jpg` is the unflipped download). Both turn left with the boom on his left ear. The direction check reads both turns as "too little to tell", so `h1`/`h2` are approved by eye with `--force`. Seated `v3`-`d5` came from a second Haiku run. It worked from a fixed list instead of `next`, because the rejected turns sit at the front of the queue. The seated face boxes were set by hand (`EBL` 104,27-114,35, `EBR` 118,27-130,34, `MB` 107,42-127,54, the jaw of `v5` reaching row 54). The seated crops drift more at the hair and ear than the standing ones. After that, every mouth and blink passes. Seated `d2` (fingers interlaced) is almost the master, which already has clasped hands. Seated `d3` (papers) rises above `handsTop`, as Isla's and Kirsty's did, so it is approved over the check. Left to approve over the checks: `h1`/`h2` in both sets, standing `v9` and `f1` (the mirror), seated `d3`.

**Round 2 and bake, 4 Nov.** All 28 round 2 frames came in on one Haiku run, without reaching the limit, and every one passed once `boxes.h1`/`boxes.h2` were set by hand from `face-boxes.mjs <set> h1|h2`. The drift at the headset band and the boom tip is left outside the boxes. Both sets are tuned like Kirsty's: register `shift`, and nods `h3`/`h4` in patch mode. The seated set also has the code tilts `tilt-6`..`tilt6`, with `face.tilt` chin at row 52 (his chin sits higher than Ross's 55, with the scarf right under it) and pivot `[117, 50]`. The standing bake crashed at first. The nod `h3` dips his lids so far that only one eye white shows, and `detectEyes` needs two for the code-made glance. `site/spike-lib/compose.js` now leaves such a head with its eyes open for that glance, instead of throwing. Checked in `/test/seated.html?p=gregor,ross`: the tilts lean cleanly with an open mouth (one stray skin cell lands on the scarf at `tilt-6`). Not on air yet: `site/public/hd/set.json` has no seat for him, and the pitchside backdrop is #92.
