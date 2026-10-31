# Fraser standing head movement prompts

Run each as a fresh request, attaching `site/public/spike/fraser/standing/b1.jpg` (the full-length standing Fraser, both arms down: the master). Never attach a previous variant.
Ask for PNG if possible. Keep the output 848 x 1264 with the figure in the same place, and keep the same dull purple-pink background as `b1.jpg` (the code keys that colour out).

Every prompt below is complete: copy the whole block and paste it as is. Save results as `site/public/spike/fraser/standing/<name>.jpg`.

The head turns right and left (`h1`, `h2`) are already generated (`standing-gap-prompts.md`). These are the rest of Isla's set, so the names match hers: nod down `h3`, nod up `h4`, tilt left `h5`, and a new tilt right `h6`. Until they are generated the code makes them (a warp of the master head), so replace only the ones that look wrong.

These are "change only the head" edits. The body, arms, jacket, trousers and shoes must stay pixel-identical so every arm pose still works under them. Only the head (face, ears, hair, neck above the collar) may change. Left and right always mean the viewer's left and right.

Check each result before keeping it: shoulders, collar, tie and body in exactly the same place as `b1.jpg`, the jacket the same colour (the code takes only head and neck pixels from a head frame near the shoulders, but a changed jacket colour is a sign the model redrew more than the head), and the movement small, about 5 to 6 degrees. If the body shifted or the head moved too far, add "the movement is small and subtle, and the body must stay at exactly the same pixel position as in the original" to the end and run it again.

## h3. Nod down

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it very slightly forward and down, as in a small nod, about 6 degrees, so the chin dips a little towards the chest and the top of the head tips forward. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## h4. Nod up

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it very slightly back and up, as at the top of a small nod, about 5 degrees, so the chin lifts a little. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## h5. Small head tilt to the left

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it sideways a small amount, about 5 degrees, so his head leans slightly towards his shoulder on the viewer's left, as if listening with interest. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## h6. Small head tilt to the right

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it sideways a small amount, about 5 degrees, so his head leans slightly towards his shoulder on the viewer's right, as if listening with interest. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## Order

h3 and h5 first (a nod and a tilt are enough to judge whether the code versions are worth replacing), then h4 and h6.
