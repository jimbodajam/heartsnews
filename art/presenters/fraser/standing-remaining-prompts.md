# Fraser standing: every remaining frame as a prompt

Everything below replaces something that is currently code-made. Run each as a fresh request. Ask for PNG if possible. Keep the output 848 x 1264 with the figure in the same place and the same dull purple-pink background as `b1.jpg`. Save results in `site/public/spike/fraser/standing/` with the names given. Left and right always mean the viewer's left and right.

Order: 1 (h6 redo), 2 (feet), 3 (left glance), then 4 (mouth sets). Within 4, do h3 and h4 first.

When a set is in, tell Claude: each new set has to be wired into the code (it is not automatic), and the background colour and skin tone can come back slightly different from the master (the code already handles both).

## 1. h6 redo: tilt to the viewer's right (attach b1.jpg)

The first h6 came out far too big (about 25 degrees), changed his expression and slid the head off the neck. This version is stricter.

```text
Edit this image. Keep the body, both arms hanging down, the hands, jacket, shirt, tie, heart pin, trousers, shoes and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move his feet or shoulders. Keep his bald head, grey side hair, heavy grey eyebrows and face style exactly as in the original, with exactly the same neutral closed-mouth expression, and his eyes looking straight at the viewer exactly as in the original. Change only the head, and only a very little: rotate it sideways by about 5 degrees, a subtle lean, so the top of his head tips slightly towards the viewer's right. The head rotates on top of the neck and stays centred on it, it does not slide sideways, and it stays the same size and at the same height. The neck stays attached at the same place on the shoulders.
```

## 2. Feet and weight shifts (attach b1.jpg)

These are "change only the lower body" edits. The head, torso, jacket and arms must stay pixel-identical so the poses and face frames still work on top. The split is just below the jacket hem, at about grid row 140 of 216 (about 65% of the way down the image). Save as `f1.jpg`, `f2.jpg`, `f3.jpg`.

Check each result: everything above the split unchanged, and the shoes the same size and style as in the master. If the upper body changed, add "everything above the jacket hem must stay at exactly the same pixel position as in the original" to the end and run it again.

### f1. Weight on the viewer's right leg (left foot relaxed)

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, jacket, both arms and hands, and the jacket hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Everything above the bottom of the jacket (grid row 140 of 216, about 65% of the way down the image) must be unchanged. Do not move or resize the figure. Change only his trousers and shoes below that line: he shifts his weight onto the leg on the viewer's RIGHT, which stands straight and carries all his weight, while the leg on the viewer's LEFT relaxes: that knee is slightly bent, and that foot is placed visibly out to the viewer's left and a little forward, with the heel slightly lifted off the floor, so the two feet are clearly in different positions. The trouser hems stay the same style and colour. A natural relaxed weight shift, not a step.
```

### f2. Weight on the viewer's left leg (right foot relaxed)

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, jacket, both arms and hands, and the jacket hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Everything above the bottom of the jacket (grid row 140 of 216, about 65% of the way down the image) must be unchanged. Do not move or resize the figure. Change only his trousers and shoes below that line: he shifts his weight onto the leg on the viewer's LEFT, which stands straight and carries all his weight, while the leg on the viewer's RIGHT relaxes: that knee is slightly bent, and that foot is placed visibly out to the viewer's right and a little forward, with the heel slightly lifted off the floor, so the two feet are clearly in different positions. The trouser hems stay the same style and colour. A natural relaxed weight shift, not a step.
```

### f3. Feet slightly apart

```text
Edit this image. Keep the head, face, hair, neck, shirt, tie, heart pin, jacket, both arms and hands, and the jacket hem exactly identical, and keep the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Everything above the bottom of the jacket (grid row 140 of 216, about 65% of the way down the image) must be unchanged. Do not move or resize the figure. Change only his trousers and shoes below that line, and only slightly: both legs stand straight with his weight even, and his feet are placed a little further apart than in the original, about shoulder width, both feet flat on the floor, toes pointing slightly outwards.
```

## 3. Glance to the viewer's left (v8 redo)

Nano came back with a right glance both times, so this uses plainer wording. If it fails again, there is a no-prompt fallback below. Attach `b1.jpg`.

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only the eyes: his head still faces forward, but he is looking towards the left side of the picture. In each eye the dark pupil and the pale iris are moved to the left half of the eye (the half nearest the left edge of the image), and the white of the eye shows only on the right side of each iris. Check this before you answer: the dark pupils must be on the LEFT of each eye, not the right.
```

Fallback, no prompt needed: flip `v9.jpg` (the glance right) horizontally in any image editor and save it as `v8.jpg`. Only the eyes are used, and his face is close to symmetrical, so the flipped eyes work as a left glance. (The heart pin would be on the wrong side in the flipped picture, but the code only uses the eye area.)

## 4. Mouth and blink sets for each nod and tilt head

Each head gets its own set, the way the turn right has. Attach the named head file (never the master); every prompt says to keep that head's angle exactly. Save as `<head>v1.jpg` to `<head>v7.jpg` (1 smile, 2 parted, 3 ee, 4 oh, 5 ah, 6 pressed, 7 blink), for example `h3v1.jpg`. Do h6 only after the redo in section 1 is in.

Check each: the head at exactly the angle of the file attached, and the mouth about as wide as the original closed mouth, in the same place. If not, add "keep the head and the mouth width exactly as in the original" to the end and run it again.

### h3 (nod down): attach h3.jpg

#### h3v1: smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is closed with a gentle slight smile.
```

#### h3v2: parted

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.
```

#### h3v3: ee

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.
```

#### h3v4: oh

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a small round "oh", lips rounded and pushed forward, dark inside, no teeth.
```

#### h3v5: ah

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is open about half as wide as in a shout, relaxed and mid-speech as if saying "ah" in a calm conversation, showing the top teeth and a little tongue.
```

#### h3v6: pressed

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are pressed together, closed and neutral, as if about to say "m" or "b".
```

#### h3v7: blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head nodded down exactly as in the original, at the same angle, with the same mouth, nose, hair and brows. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```

### h4 (nod up): attach h4.jpg

#### h4v1: smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is closed with a gentle slight smile.
```

#### h4v2: parted

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.
```

#### h4v3: ee

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.
```

#### h4v4: oh

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a small round "oh", lips rounded and pushed forward, dark inside, no teeth.
```

#### h4v5: ah

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is open about half as wide as in a shout, relaxed and mid-speech as if saying "ah" in a calm conversation, showing the top teeth and a little tongue.
```

#### h4v6: pressed

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are pressed together, closed and neutral, as if about to say "m" or "b".
```

#### h4v7: blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tipped up exactly as in the original, at the same angle, with the same mouth, nose, hair and brows. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```

### h5 (tilt left): attach h5.jpg

#### h5v1: smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is closed with a gentle slight smile.
```

#### h5v2: parted

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.
```

#### h5v3: ee

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.
```

#### h5v4: oh

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a small round "oh", lips rounded and pushed forward, dark inside, no teeth.
```

#### h5v5: ah

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is open about half as wide as in a shout, relaxed and mid-speech as if saying "ah" in a calm conversation, showing the top teeth and a little tongue.
```

#### h5v6: pressed

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are pressed together, closed and neutral, as if about to say "m" or "b".
```

#### h5v7: blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's left exactly as in the original, at the same angle, with the same mouth, nose, hair and brows. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```

### h6 (tilt right): attach h6.jpg (the redo)

#### h6v1: smile

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is closed with a gentle slight smile.
```

#### h6v2: parted

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.
```

#### h6v3: ee

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.
```

#### h6v4: oh

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is a small round "oh", lips rounded and pushed forward, dark inside, no teeth.
```

#### h6v5: ah

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the mouth is open about half as wide as in a shout, relaxed and mid-speech as if saying "ah" in a calm conversation, showing the top teeth and a little tongue.
```

#### h6v6: pressed

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, along the same angle as the original mouth, with the same centre and no wider than the mouth in the original: his mouth is thin, so keep it small and thin and keep its angle. Change only this one thing: the lips are pressed together, closed and neutral, as if about to say "m" or "b".
```

#### h6v7: blink

```text
Edit this image. Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything, and do not change the pose, the body, the clothes or the head. Keep the head tilted to the viewer's right exactly as in the original, at the same angle, with the same mouth, nose, hair and brows. Change only this one thing: both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.
```
