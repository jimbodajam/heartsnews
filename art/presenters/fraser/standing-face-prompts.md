# Fraser standing face prompts (mouths and eyes on the master head)

Run each as a fresh request, attaching `site/public/spike/fraser/standing/b1.jpg` (the full-length standing Fraser, arms down). Never attach a previous variant. Ask for PNG if possible. Keep the output 848 x 1264 with the figure in the same place, and keep the same dull purple-pink background as `b1.jpg`.

Save results as `site/public/spike/fraser/standing/v1.jpg` to `v9.jpg` in the order below (same names as Isla's: v1 smile, v2 small, v3 wide, v4 O, v5 A, v6 press, v7 blink, v8 glance left, v9 glance right). Left and right mean the viewer's left and right.

Every prompt is a "change only the face" edit, so the head, body and every pixel outside the mouth or eyes must stay identical. The mouth prompts say to keep his thin mouth the same width and in the same place, because the code lays each mouth over every head by image fit.

Check each result before keeping it: the mouth about as wide as the closed mouth in `b1.jpg` and in exactly the same place. If it comes out too big or off-centre, add "keep the mouth the same width as the original closed mouth" to the end and run it again.

Order: 5 and 1 first (open and closed, the minimum to see lip-sync), then 2, 3 and 4, then 6. The eye prompts (7 to 9) are optional because blink and glances can also be made in code, but his irises are small so the code glance is only a pixel.

## 1. Closed, slight smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the mouth is closed with a gentle slight smile.
```

## 2. Lips slightly parted

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.
```

## 3. "ee"

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.
```

## 4. "oh"

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the mouth is a small round "oh", lips rounded and pushed forward, dark inside, no teeth.
```

## 5. "ah" (open, mid-speech)

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the mouth is open about half as wide as in a shout, relaxed and mid-speech as if saying "ah" in a calm conversation, showing the top teeth and a little tongue.
```

## 6. Lips pressed together ("m" / "b")

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, with the same centre and no wider than the mouth in the original: his mouth is thin and his head is straight, so keep it small and thin. Change only this one thing: the lips are pressed together, closed and neutral, as if about to say "m" or "b".
```

## 7. Blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```

## 8. Glance to the viewer's left

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: both eyes are open as before, but the pale irises and pupils sit against the LEFT corner of each eye as seen in the picture (the edge nearest the left side of the image), so a sliver of white shows on the right side of each iris and none on the left. He is glancing sideways towards the left edge of the picture with his head still facing forward.
```

## 9. Glance to the viewer's right

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: both eyes are open as before, but the pale irises and pupils sit against the RIGHT corner of each eye as seen in the picture (the edge nearest the right side of the image), so a sliver of white shows on the left side of each iris and none on the right. He is glancing sideways towards the right edge of the picture with his head still facing forward.
```
