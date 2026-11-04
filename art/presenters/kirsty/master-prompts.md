# Kirsty masters and run (#90)

Kirsty Reid has no earlier art, so the standing master is made from a description, the way Ross's was (`art/presenters/ross/master-prompts.md`). The framing reference is **Ross's** standing master, not Isla's: Ross's is straight on, arms down, on the 145 x 216 grid that `tools/frames/standing.mjs` is tuned for, and it went through the whole queue and bake. Isla's stands three-quarters on in a skirt (her `feetTop` is 119, not 138), which would put the leg frames off the tuned rows.

**Both masters were made on 3 Nov, first try each, and approved by James** (`site/public/spike/kirsty/standing/b1.jpg`, `site/public/spike/kirsty/seated/b1.jpg`), and both queues are built: `kirsty` (23 frames in round 1) and `kirsty-seated` (16). Start at section 3.

Kirsty gets a seated set too, though she only works the touchscreen today: James wants the presenters to be interchangeable, so any of them can sit at the desk once the rota work lands. `art/presenters/kirsty-seated/` was scaffolded with `seated.mjs`. The crop box, `headCut` and `handsTop` are copied from `ross-seated`, whose framing her seated master matches almost exactly, and both crops were checked on the masters. The leans `h5`/`h6` are dropped from the seated frames: they are code tilts, and Ross's came out too big.

Look from `channel.json`: deep brown skin (#8d5a3b), long near-black hair (#2a1a14), maroon suit (#6d1a2a), cream shirt (#f2efe6), no tie. She is 34, the match analyst and a former Hearts Women midfielder: straight-talking, evidence-led, an athlete's build. Like the others she wears the small heart pin on her left lapel, drawn gold here because a maroon heart disappears on a maroon suit.

## What Ross taught us, and what is different for Kirsty

- **Settle the master before anything else.** Ross's masters came first time, but every frame copies the master's framing, so make several and pick the best on the checks below.
- **A trouser suit, not a skirt.** The leg frames `f1`-`f3` and `feetTop` 138 assume trousers and a jacket hem about 65% of the way down.
- **Hair behind the shoulders.** Long hair over the lapels sits below `headCut` (row 48), so a head turn that moves it trips the outside-area check, and every arm frame would have to keep it unchanged. Hair falling behind the shoulders keeps the shoulders and lapels clear. Check it on the master.
- **Centre parting, on purpose.** The turn towards the touchscreen is `h2` (towards the LEFT edge of the image), the one Gemini got wrong for Fraser. If it fails, `h2` and `h2v*` become mirrors of `h1`, and a centre parting is the hair that mirrors cleanly. A side parting would flip.
- **The screen is on the left.** In SD the touchscreen is on the left of the picture and Kirsty stands on the right. `standing.json` has `"screen": "left"`, so `b2` (point) and `b3` (open palm) go towards the left edge, `b6`/`b7` go right, and there is one extra frame, `b9`, a hand flat on the touchscreen. If #92 puts the HD touchscreen on the right, set `"screen": "right"` and re-run the scaffold before any frame is approved.
- **Name each download by its frame.** On Ross's first run two clicks gave no file and Gemini's unnamed downloads slipped by one frame twice. Round 2, saved as `<frame>.jpg` as each landed, had no mispairs. Never `collect --force`.
- **Leave out the leans and the left glance.** `h5`/`h6` are code tilts and `v8` is a code glance, as for Ross.

## 1. Standing master (`b1`), done

Fresh request in Gemini (`gemini.google.com/images?dest=create`). Attach `site/public/spike/ross/standing/b1.jpg` (framing and style only). Save the one you pick as `site/public/spike/kirsty/standing/b1.jpg`, 848 x 1264.

Check before keeping it:
- Clearly a woman of about 34 with deep brown skin, not a copy of Ross: different face, hair and clothes.
- Long dark hair with a centre parting, falling behind her shoulders: none of it over the lapels or the front of the jacket.
- Maroon trouser suit, jacket buttoned, cream blouse open at the neck, no tie, a small gold heart pin on her left lapel (the right side of the picture as you look at it, where Ross's is).
- Both arms hang straight down, hands open, nothing in the pockets.
- Full length, both shoes on the ground, feet a little apart and level, the trouser hems clear of the floor.
- Face straight at the viewer, head not tilted or turned, mouth closed and neutral.
- Head about the same height and size as Ross's, figure in the same place, jacket hem at about the same height.
- Flat magenta background, no floor or shadow, hard pixel edges.

```text
Create a full-length pixel-art image of a new TV sports presenter, standing. Use the attached image only for the framing and the style of drawing: the figure is the same height and in the same place in the frame, on the same flat magenta background, in the same chunky pixel-art style with a dark outline and the same pixel grid. Do not copy the man in the attached image: this is a woman, with a different face, hair and clothes.

The presenter is a Scottish woman of 34, a former footballer, with an athletic build, deep brown skin, a friendly, direct, confident face, dark brown eyes and dark eyebrows. Her long near-black hair has a centre parting and falls straight down behind her shoulders, so none of it lies over the front of her jacket. She wears a tailored maroon trouser suit, the jacket buttoned, a cream blouse open at the neck with no tie, and a small gold heart pin on her left lapel.

She stands facing straight at the viewer, full length from the top of her head to her shoes, in a calm, neutral stance while someone else is talking. Both arms hang straight down relaxed at her sides, hands open with the fingers together, not in her pockets and not clasped. Her feet are on the ground a little apart and level, in black low-heeled shoes, under straight maroon suit trousers. Her head is straight, not tilted or turned, her eyes look at the viewer, and her mouth is closed with a neutral, faint expression. Flat magenta background, no floor, no shadow, no text. Output size 848 x 1264.
```

If Gemini drapes the hair over the shoulders anyway, ask in the same chat: "Keep everything else the same, but move all of her hair behind her shoulders so both lapels and the tops of both shoulders are fully visible."

## 2. Seated master (`kirsty-seated` `b1`), done

Fresh request with two images attached, in this order: Kirsty's standing master, then `site/public/spike/fraser/seated/b1.jpg` (framing and scale only). Target 1376 x 768.

```text
Create a pixel-art image of the presenter in the first image, seated, from the waist up. Use the first image only for who she is: the same face, long near-black hair with the centre parting falling behind her shoulders, skin, maroon suit jacket, cream blouse open at the neck and the small gold heart pin. Use the second image only for the framing, the scale and the style: the figure is the same size and in the same place in the frame, cut off at the same height, on the same flat magenta background, in the same chunky pixel-art style. Do not copy the man in the second image. She sits upright facing straight at the viewer, with her forearms forward and her hands clasped loosely in front of her at the bottom of the picture, as if resting on a desk, but there is no desk. Her hair stays behind her shoulders, so none of it lies over the front of her jacket. Her head is straight, not tilted or turned, her eyes look at the viewer and her mouth is closed and neutral. Flat magenta background, no desk, no chair, no shadow, no text. Output size 1376 x 768.
```

Checked on 3 Nov: the suit is about 95 away from the background colour (the key threshold is 45), and Ross's crop boxes take in all of her hair in both sets. Her hair ends a few rows below the standing `headCut` (48) at the shoulders. Watch for that on the head turns: if they trip the outside-area check there, move `headCut` down a row or two.

## 3. Round 1 (`kirsty` 23 frames, `kirsty-seated` 16)

Standing: `h1`-`h4`, `v1`-`v7`, `v9`, `b2`-`b9`, `f1`-`f3`. Seated: `h1`-`h4`, `v1`-`v7`, `d1`-`d5`. Everything depends only on the master. Ross's 40 frames went through in one evening without reaching the daily limit, so both should fit in one day. Run standing first: it has the frames the touchscreen needs.

Brief for a background Haiku run in Claude in Chrome, per set (`kirsty`, then `kirsty-seated`): follow "Background run" in `tools/frames/README.md`. Use `npm run frames -- next <p> --json` for each frame, find the file input by ref (never click by coordinates), and download exactly one image per frame. **As each image lands, copy it to `art/presenters/<p>/queue/named/<frame>.jpg`**, look at it to make sure it is that frame (a mouth crop, an arm pose and a leg pose are easy to tell apart), then `mark <p> <frame> saved`. On the content filter ("interests of third-party content providers"), do not resend: use the shorter mouth wording in the README and go on. Stop at the daily limit with `mark ... limit`. Finish with `collect <p> --from art/presenters/<p>/queue/named` and `sheet <p>`. Do not approve, bake or commit.

Look hardest at:
- `h2`: the turn towards the screen. If it turns the wrong way, mirror `h1`.
- `b2`, `b3`, `b9`: they must reach towards the LEFT edge. `b9`'s hand must stay inside the picture.
- `b6`, `b7`: towards the RIGHT edge.
- Every head frame: the hair behind the shoulders must not change.
- The `v` crops: these read back as unchanged until the face boxes are set (`node tools/frames/face-boxes.mjs kirsty`, eyes from `v7`/`v9`, mouth from the rest), then `recheck`. Judge `v9` by eye and `approve --force`.

**Standing `h2` went the wrong way (4 Nov), and it got past the contact sheet.** At sheet size a small turn either way looks plausible. It was caught only when the `h2v*` mouths changed on the same side as `h1`'s. Check a turn at full size: the ear that shows is on the side the head turns away from (`h1`, turning to the right edge, shows the left ear). The fix was the planned one: `h2.jpg` is `h1.jpg` flipped (the figure sits on the image centre, so no shift is needed), `h2v1`-`h2v7` are the `h1v*` crops flipped, and `boxes.h2` is `boxes.h1` mirrored on the 145-wide grid. The mirrored blink `h2v7` trips the outside-area check at the collar, because the jacket is not symmetrical, but the bake takes only the eye box from it. Seated `h2` was a real left turn.

## 4. Round 2 (14 frames)

Once `h1` and `h2` are approved in a set, set `boxes.h1`/`boxes.h2` (`face-boxes.mjs <p> h1`, `... h2`), re-run `queue <p>`, and run `h1v1`-`h1v7`, `h2v1`-`h2v7` the same way (14 per set). Then tune `kirsty-seated/frames.json` the way Ross's was (tilt heads, register shift), and bake both into `site/public/presenters/kirsty{,-seated}`.
