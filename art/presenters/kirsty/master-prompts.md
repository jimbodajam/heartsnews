# Kirsty masters and run (#90)

Kirsty Reid has no earlier art, so the standing master is made from a description, the way Ross's was (`art/presenters/ross/master-prompts.md`). The framing reference is **Ross's** standing master, not Isla's: Ross's is straight on, arms down, on the 145 x 216 grid that `tools/frames/standing.mjs` is tuned for, and it went through the whole queue and bake. Isla's stands three-quarters on in a skirt (her `feetTop` is 119, not 138), which would put the leg frames off the tuned rows.

Standing only: Kirsty works the touchscreen and is not at the desk yet (Kirsty in the debate waits for the rota work). If a seated set is wanted later, make it from her standing master the same way as Ross's seated one.

Look from `channel.json`: deep brown skin (#8d5a3b), long near-black hair (#2a1a14), maroon suit (#6d1a2a), cream shirt (#f2efe6), no tie. She is 34, the match analyst and a former Hearts Women midfielder: straight-talking, evidence-led, an athlete's build. Like the others she wears the small heart pin on her left lapel, drawn gold here because a maroon heart disappears on a maroon suit.

## What Ross taught us, and what is different for Kirsty

- **Settle the master before anything else.** Ross's masters came first time, but every frame copies the master's framing, so make several and pick the best on the checks below.
- **A trouser suit, not a skirt.** The leg frames `f1`-`f3` and `feetTop` 138 assume trousers and a jacket hem about 65% of the way down.
- **Hair behind the shoulders.** Long hair over the lapels sits below `headCut` (row 48), so a head turn that moves it trips the outside-area check, and every arm frame would have to keep it unchanged. Hair falling behind the shoulders keeps the shoulders and lapels clear. Check it on the master.
- **Centre parting, on purpose.** The turn towards the touchscreen is `h2` (towards the LEFT edge of the image), the one Gemini got wrong for Fraser. If it fails, `h2` and `h2v*` become mirrors of `h1`, and a centre parting is the hair that mirrors cleanly. A side parting would flip.
- **The screen is on the left.** In SD the touchscreen is on the left of the picture and Kirsty stands on the right. `standing.json` has `"screen": "left"`, so `b2` (point) and `b3` (open palm) go towards the left edge, `b6`/`b7` go right, and there is one extra frame, `b9`, a hand flat on the touchscreen. If #92 puts the HD touchscreen on the right, set `"screen": "right"` and re-run the scaffold before any frame is approved.
- **Name each download by its frame.** On Ross's first run two clicks gave no file and Gemini's unnamed downloads slipped by one frame twice. Round 2, saved as `<frame>.jpg` as each landed, had no mispairs. Never `collect --force`.
- **Leave out the leans and the left glance.** `h5`/`h6` are code tilts and `v8` is a code glance, as for Ross.

## 1. Standing master (`b1`)

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

## 2. Between the master and the queue (in WSL, with Claude)

1. Commit the master.
2. Measure the head crop box on the master (head, all the hair beside the face, and the collar) and set `crop` in `art/presenters/kirsty/standing.json`. It is Ross's box for now, `[236, 12, 376, 318]`, and long hair is wider than a quiff.
3. Check `headCut` (48) sits at the chin and collar line, and `feetTop` (138) at the jacket hem, on the master: open it on the grid and move them in `frames.json` if not.
4. `npm run frames:standing -- kirsty` again if `standing.json` changed, then `npm run frames -- queue kirsty`.

## 3. Round 1 (23 frames)

`h1`-`h4`, `v1`-`v7`, `v9`, `b2`-`b9`, `f1`-`f3`. Everything depends only on the master. Ross's 40 frames went through in one evening without reaching the daily limit, so this should fit in one day.

Brief for a background Haiku run in Claude in Chrome: follow "Background run" in `tools/frames/README.md` for `kirsty`. Use `npm run frames -- next kirsty --json` for each frame, find the file input by ref (never click by coordinates), and download exactly one image per frame. **As each image lands, copy it to `art/presenters/kirsty/queue/named/<frame>.jpg`**, look at it to make sure it is that frame (a mouth crop, an arm pose and a leg pose are easy to tell apart), then `mark kirsty <frame> saved`. On the content filter ("interests of third-party content providers"), do not resend: use the shorter mouth wording in the README and go on. Stop at the daily limit with `mark ... limit`. Finish with `collect kirsty --from art/presenters/kirsty/queue/named` and `sheet kirsty`. Do not approve, bake or commit.

Look hardest at:
- `h2`: the turn towards the screen. If it turns the wrong way, mirror `h1`.
- `b2`, `b3`, `b9`: they must reach towards the LEFT edge. `b9`'s hand must stay inside the picture.
- `b6`, `b7`: towards the RIGHT edge.
- Every head frame: the hair behind the shoulders must not change.
- The `v` crops: these read back as unchanged until the face boxes are set (`node tools/frames/face-boxes.mjs kirsty`, eyes from `v7`/`v9`, mouth from the rest), then `recheck`. Judge `v9` by eye and `approve --force`.

## 4. Round 2 (14 frames)

Once `h1` and `h2` are approved, set `boxes.h1`/`boxes.h2` (`face-boxes.mjs kirsty h1`, `... h2`), re-run `queue kirsty`, and run `h1v1`-`h1v7`, `h2v1`-`h2v7` the same way. Then bake (`npm run frames -- bake kirsty`) into `site/public/presenters/kirsty`.
