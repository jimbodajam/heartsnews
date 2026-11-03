# Ross masters (#89)

Ross Dunbar has no earlier art (no head-and-shoulders master like Isla and Fraser had), so the standing master is made from a description, using Fraser's standing master for framing and style only. The seated master is then made from Ross's own standing master, the same way as #78.

Look from `channel.json`: warm medium-tan skin (#c98e6a), black hair in a quiff, charcoal suit with a blue tint (#3a3d4a), pale blue shirt (#c9d6ea), mustard-gold tie (#e0b13a). He is 26, the Transfer Centre reporter: keen, quick, a bit of a show-off. Like Isla and Fraser he wears the small maroon heart pin on his left lapel.

Generate several of each and pick the best. Every other frame copies the master's framing, so settle it before anything goes on the queue.

## 1. Standing master (`b1`)

Fresh request. Attach `site/public/spike/fraser/standing/b1.jpg` (framing and style only). Target 848 x 1264, so it lands on the same 145 x 216 grid.

Check before keeping it:
- Clearly a different man from Fraser: young, dark quiff, no grey, no lines.
- Both arms hang straight down, hands open, nothing in the pockets (arm poses are painted over this).
- Full length, both shoes on the ground, feet a little apart and level.
- Face straight at the viewer, head not tilted or turned, mouth closed and neutral.
- Head about the same height and size as Fraser's, figure in the same place.
- Flat magenta background, no floor or shadow, hard pixel edges.

```text
Create a full-length pixel-art image of a new TV sports presenter, standing. Use the attached image only for the framing and the style of drawing: the figure is the same height and in the same place in the frame, on the same flat magenta background, in the same chunky pixel-art style with a dark outline and the same pixel grid. Do not copy the man in the attached image: a different face, hair, age and clothes.

The presenter is a slim Scottish man of 26 with warm medium-tan skin, a clean-shaven, friendly, keen face, dark brown eyes, and short black hair styled up into a neat quiff at the front with short sides. He wears a slim-fit charcoal suit with a slight blue tint, a pale blue shirt, a mustard-gold tie, and a small maroon heart pin on his left lapel.

He stands facing straight at the viewer, full length from the top of his head to his shoes, in a calm, neutral stance while someone else is talking. Both arms hang straight down relaxed at his sides, hands open with the fingers together, not in his pockets and not clasped. His feet are on the ground a little apart and level, in dark brown formal shoes, with matching charcoal suit trousers. His head is straight, not tilted or turned, his eyes look at the viewer, and his mouth is closed with a neutral, faint expression. The jacket is buttoned so the tie shows clearly. Flat magenta background, no floor, no shadow, no text. Output size 848 x 1264.
```

## 2. Seated master (`ross-seated` `b1`)

Fresh request, after the standing master is chosen. Attach two images, in this order:

1. Ross's standing master (`site/public/spike/ross/standing/b1.jpg` once saved)
2. `site/public/spike/fraser/seated/b1.jpg` (framing and scale only)

Target 1376 x 768, the same as Fraser's and Isla's seated masters (240 x 131 grid). The seated head is drawn about 20-25% larger than the standing head, as Fraser's is; check it against Fraser's seated head, not the standing one.

```text
Create a pixel-art image of the presenter in the first image, seated, from the waist up. Use the first image only for who he is: the same face, black quiff, skin, charcoal suit, pale blue shirt, mustard-gold tie and the maroon heart pin. Use the second image only for the framing, the scale and the style: the figure is the same size and in the same place in the frame, cut off at the same height, on the same flat magenta background, in the same chunky pixel-art style. Do not copy the man in the second image.

He sits upright facing straight at the viewer, with his forearms forward and his hands clasped loosely in front of him at the bottom of the picture, as if resting on a desk, but there is no desk. His head is straight, not tilted or turned, his eyes look at the viewer and his mouth is closed and neutral. Flat magenta background, no desk, no chair, no shadow, no text. Output size 1376 x 768.
```
