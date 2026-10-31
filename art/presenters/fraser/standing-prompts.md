# Fraser standing master prompt

Same job as Isla's `standing-master.jpg`: one full-length, hands-down Fraser that every other standing frame (arm poses, head moves, weight shifts, mouths, eyes) is built on. Everything else is derived in code where possible, so this is the one image that matters most. Generate several and pick the best.

Run it as a fresh request. Attach two images, in this order:

1. `art/presenters/fraser/master.jpg` (who he is: face, hair, suit, tie, heart pin)
2. `site/public/spike/isla/standing-master.jpg` (framing only: the figure's size, position and the flat magenta background; tell the model not to copy her)

Ask for PNG if possible. Target output 848 x 1264, figure centred, feet near the bottom, the same size and framing as Isla's master, so it lands on the same 145 x 216 grid.

Check before keeping it:
- Same man as the head-and-shoulders master (bald crown, grey side hair, heavy grey brows, lined face, heart pin on the left lapel, maroon tie with gold stripes).
- Both arms hang straight down at his sides, hands open and relaxed, no hand in a pocket. This matters: arm poses are painted over this.
- Full body visible, both shoes on the ground, feet slightly apart and level (so weight-shift frames work).
- Face looks straight at the viewer, mouth closed and neutral, head not tilted or turned.
- Flat magenta background, no shadow or floor, hard pixel edges, no anti-aliasing blur.

## 1. Standing master, arms down

```text
Create a full-length pixel-art image of the presenter in the first image, standing. Use the first image only for who he is: the same face, bald crown with grey hair at the sides, heavy grey eyebrows, lined face, dark grey suit jacket, white shirt, maroon tie with gold diagonal stripes and the small maroon heart pin on his left lapel. Use the second image only for the framing and the style of drawing: the figure is the same height and in the same place in the frame, on the same flat magenta background, in the same chunky pixel-art style with a dark outline and the same pixel grid. Do not copy the woman in the second image: no copied face, hair, clothes or pose.

He stands facing straight at the viewer, full length from the top of his head to his shoes, in a calm, neutral stance while someone else is talking. Both arms hang straight down relaxed at his sides, hands open with the fingers together, not in his pockets and not clasped. His feet are on the ground a little apart and level, in dark polished formal shoes, with matching dark grey suit trousers. His head is straight, not tilted or turned, his eyes look at the viewer, and his mouth is closed with a neutral, faint expression. The suit jacket is buttoned or hangs closed so the tie shows clearly. Flat magenta background, no floor, no shadow, no text. Output size 848 x 1264.
```
