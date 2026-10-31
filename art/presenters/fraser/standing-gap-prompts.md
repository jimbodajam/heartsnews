# Fraser standing: the frames code cannot make

Head nods and tilts, weight shifts, blinks, glances and every mouth are already made in code from the master (see `standing-notes.md`). Only two things need generating: the head turns and the arm poses.

Run each as a fresh request, attaching `site/public/spike/fraser/standing/b1.jpg` (the full-length standing Fraser, arms down). Never attach a previous variant. Ask for PNG if possible. Keep the output 848 x 1264 with the figure in the same place, and keep the same dull purple-pink background as `b1.jpg` (the code keys that colour out).

Save results next to the master as `site/public/spike/fraser/standing/<name>.jpg` using the same names as Isla: head turns `h1` (right) and `h2` (left), arm poses `b2` to `b8`. Left and right always mean the viewer's left and right.

Check each result before keeping it: the body, legs and shoes must sit in exactly the same place as in `b1.jpg`. For head turns only the head changes; for arm poses only the arms and hands change. If something else moved, add "everything except the part named must stay at exactly the same pixel position as in the original" to the end and run it again.

## Head turns

### h1. Head turned a little towards the screen (viewer's right)

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: turn it a few degrees (a small, subtle turn, about 8 degrees) so his nose and gaze point towards the RIGHT edge of the image (the right-hand side of the picture, as you look at it). Do not turn it towards the left edge. The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.
```

### h2. Head turned a little to the left

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: turn it a few degrees (a small, subtle turn, about 8 degrees) so his nose and gaze point towards the LEFT edge of the image (the left-hand side of the picture, as you look at it). Do not turn it towards the right edge. The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.
```

## Arm poses

Every prompt starts with the same keep-list. Order: b2 and b4 first (pointing and hands together are the most useful), then b3, b6, b8, then b5 and b7.

### b2. Pointing at the screen

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: his arm on the viewer's right is extended out to the side and slightly up, with his index finger pointing clearly towards the right of the image, as if pointing at an item on a screen, the other fingers curled and the thumb tucked. His other arm hangs relaxed at his side. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b3. Wide open palm, higher (emphasis)

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: his arm on the viewer's right is raised and a little out from his side, the elbow bent, the open palm facing up and towards the right of the image, fingers together and slightly spread, in a wide, welcoming, emphasising gesture. His other arm hangs relaxed at his side. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b4. Both hands together at chest, explaining

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: both elbows are bent and both hands are held together in front of him at lower chest height, fingertips lightly touching, as if making a point in a calm explanation. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b5. Holding a small tablet

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: both arms are bent at the elbows and he holds a small dark navy tablet in front of him at waist height, one hand underneath and the other steadying it at the side, as if reading from it. Only the thin edge and the back of the tablet are visible to the viewer, with no text and no screen glow. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b6. One hand on hip (listening)

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: his arm on the viewer's left is bent with the hand resting on his hip under the open jacket edge, elbow pointing out, and his other arm hangs relaxed at his side, a confident, attentive, listening pose. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b7. Arm out to the left, presenting a second screen

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: his arm on the viewer's left is raised out to the side with the open palm facing up and towards the left of the image, as if presenting something to the left, fingers together. His other arm hangs relaxed at his side. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```

### b8. Both arms slightly open, welcoming (sign-off)

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet. Keep his expression exactly as in the original. Change only his arms and hands: both arms are held out a little from his sides, elbows bent, both palms open and facing slightly upwards at waist height, in a warm, open, welcoming sign-off gesture. The suit sleeves and shirt cuffs stay the same style and colours as in the original.
```
