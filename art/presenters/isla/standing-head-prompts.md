# Isla standing head movement prompts

Run each as a fresh request, attaching `b1.jpg` (the full-length standing Isla with both arms down and hands loosely clasped: the relaxed idle pose, which is now the master; if you renamed it, attach that file). Never attach a previous variant.
Ask for PNG if possible. Keep the output the same size and framing as the master (848 x 1264, figure in the same place).

Every prompt below is complete: copy the whole block and paste it as is.

These are "change only the head" edits. The body, arms, skirt, legs and shoes must stay pixel-identical so every existing pose still works over it. Only the head (hair, face, neck above the collar) may change. Left and right below always mean the viewer's left and right (screen left and screen right).

Face method (hybrid): the code will first try to find the eyes and mouth on each new head with `site/spike-lib/pixel-derive.js` and lay the existing mouth and eye patches over them. So every head frame keeps the same neutral closed mouth and open, relaxed eyes. If the derive result looks wrong for an angle, that angle gets its own mouth/eye set later (reuse `standing-prompts.md`, attaching that head frame instead of the master).

Order: 1 and 3 first (a turn and a nod are enough to test the method), then 2, 4 and 5.

Check each result before keeping it: the shoulders, collar, body and feet should sit in exactly the same place as in the master (compare with `site/pixel-standing-poses.html`, which reports changed pixels per region; the changes should be confined to the head). The movement should be small: about 5 to 10 degrees. If the body shifted or the head moved too far, add "the movement is small and subtle, and the body must stay at exactly the same pixel position as in the original" to the end of the prompt and run it again.

## 1. Head turned a little towards the screen (viewer's right)

```text
Edit this image. Keep the body, both arms hanging down, the clasped hands, jacket, blouse, skirt, tights, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Do not move or resize the figure, and do not move her feet or shoulders. Keep the hairstyle, hair colour and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: turn it a few degrees (a small, subtle turn, about 8 degrees) so her nose and gaze point towards the RIGHT edge of the image (the right-hand side of the picture, as you look at it). Do not turn it towards the left edge. The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.
```

## 2. Head turned a little to the left

```text
Edit this image. Keep the body, both arms hanging down, the clasped hands, jacket, blouse, skirt, tights, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Do not move or resize the figure, and do not move her feet or shoulders. Keep the hairstyle, hair colour and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: turn it a few degrees (a small, subtle turn, about 8 degrees) so her nose and gaze point towards the LEFT edge of the image (the left-hand side of the picture, as you look at it). Do not turn it towards the right edge. The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.
```

## 3. Nod down

```text
Edit this image. Keep the body, both arms hanging down, the clasped hands, jacket, blouse, skirt, tights, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Do not move or resize the figure, and do not move her feet or shoulders. Keep the hairstyle, hair colour and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it very slightly forward and down, as in a small nod, about 6 degrees, so the chin dips a little towards the chest and the top of the head tips forward. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## 4. Nod up

```text
Edit this image. Keep the body, both arms hanging down, the clasped hands, jacket, blouse, skirt, tights, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Do not move or resize the figure, and do not move her feet or shoulders. Keep the hairstyle, hair colour and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it very slightly back and up, as at the top of a small nod, about 5 degrees, so the chin lifts a little. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

## 5. Small head tilt

```text
Edit this image. Keep the body, both arms hanging down, the clasped hands, jacket, blouse, skirt, tights, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Do not move or resize the figure, and do not move her feet or shoulders. Keep the hairstyle, hair colour and face style exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head: tilt it sideways a small amount, about 5 degrees, so her head leans slightly towards her shoulder on the viewer's left, as if listening with interest. The neck stays attached at the same place on the shoulders, and the head stays the same size.
```

