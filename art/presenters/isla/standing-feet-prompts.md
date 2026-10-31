# Isla standing feet and weight-shift prompts

Run each as a fresh request, attaching `b1.jpg` (the full-length standing Isla with both arms down and hands loosely clasped: the relaxed idle pose, which is now the master; if you renamed it, attach that file). Never attach a previous variant.
Ask for PNG if possible. Keep the output the same size and framing as the master (848 x 1264, figure in the same place).

Every prompt below is complete: copy the whole block and paste it as is.

These are "change only the lower body" edits. The head, torso and arms must stay pixel-identical so the existing poses and face frames still work on top. The split point is in the skirt around grid row 119, where the skirt is plain navy, so each variant must match the master above that line. Left and right below always mean the viewer's left and right (screen left and screen right).

Order: 1 and 2 first (weight on each foot, enough for an idle shift), then 3.

Check each result before keeping it: everything above the split should be unchanged (compare with `site/pixel-standing-poses.html`, which reports changed pixels per region), and the shoes should be the same size and style as in the master. If the upper body changed, add "everything above the middle of the skirt must stay at exactly the same pixel position as in the original" to the end of the prompt and run it again.

## 1. Weight on the viewer's right leg (left foot relaxed)

```text
Edit this image. Keep the head, face, hair, neck, blouse, jacket, both arms and hands, and the skirt down to the hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Everything above the middle of the skirt (grid row 119 of 216, about 55% of the way down the image) must be unchanged. Do not move or resize the figure. Change only her legs, tights and shoes below that line: she shifts her weight onto the leg on the viewer's RIGHT, which stands straight and carries all her weight, while the leg on the viewer's LEFT relaxes: that knee is clearly bent, and that foot is placed visibly out to the viewer's left and a little forward, resting on the ball of the foot with the heel lifted off the floor, so the two feet are clearly in different positions. The skirt hem may sway slightly. A natural relaxed weight shift, not a step.
```

## 2. Weight on the viewer's left leg (right foot relaxed)

```text
Edit this image. Keep the head, face, hair, neck, blouse, jacket, both arms and hands, and the skirt down to the hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Everything above the middle of the skirt (grid row 119 of 216, about 55% of the way down the image) must be unchanged. Do not move or resize the figure. Change only her legs, tights and shoes below that line: she shifts her weight onto the leg on the viewer's LEFT, which stands straight and carries all her weight, while the leg on the viewer's RIGHT relaxes: that knee is clearly bent, and that foot is placed visibly out to the viewer's right and a little forward, resting on the ball of the foot with the heel lifted off the floor, so the two feet are clearly in different positions. The skirt hem may sway slightly. A natural relaxed weight shift, not a step.
```

## 3. Feet slightly apart

```text
Edit this image. Keep the head, face, hair, neck, blouse, jacket, both arms and hands, and the skirt down to the hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat magenta background, the same pixel grid. Everything above the middle of the skirt (grid row 119 of 216, about 55% of the way down the image) must be unchanged. Do not move or resize the figure. Change only her legs, tights and shoes below that line, and only slightly: both legs stand straight with her weight even, and her feet are placed a little further apart than in the original, about shoulder width, both feet flat on the floor, toes pointing slightly outwards.
```

