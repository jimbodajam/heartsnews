# Fraser head-crop test (#71)

Crops come from `node tools/crop-test/crop.mjs` (run in WSL from the repo root): head and collar of the master, 376 x 300 px of `b1.jpg` starting at (236, 30), enlarged 3x with nearest-neighbour to 1128 x 900, saved to `tools/crop-test/out/crop-b1.png`.

Run each prompt as a fresh request, attaching `crop-b1.png` only. Save results as `tools/crop-test/out/gen-v1.png`, `gen-v7.png` and `gen-h3.png`. Compare against the existing full-figure `v1`, `v7` and `h3` in `site/public/spike/fraser/standing/`.

## v1. Smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid, same image dimensions. Do not move or resize anything, and do not change the head, the clothes or the pose. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the mouth is closed with a gentle slight smile.
```

## v7. Blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid, same image dimensions. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```

## h3. Nod down

```text
Edit this image. Keep the collar, shoulders, jacket, shirt, tie and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid, same image dimensions. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it very slightly forward and down, as in a small nod, about 6 degrees, so the chin dips a little towards the chest and the top of the head tips forward. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```
