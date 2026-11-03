// Scaffolds a standing set for a new presenter (#89): art/presenters/<name>/{frames.json,prompts.json}, ready for the frame queue (tools/frames/frames.mjs) and the bake.
// Run from the repo root, in WSL: node tools/frames/standing.mjs <presenter>   (npm run frames:standing -- <presenter>)
// Input: art/presenters/<name>/standing.json, the words that differ per presenter (see below). Re-running rewrites frames.json and prompts.json, so tune cut rows, boxes and the face block in
// frames.json only once the master is approved, and then stop running this for that presenter.
//
// standing.json: { pronoun: "she"|"he", look, top, legs, mouth, crop }
//   look   what must not change on the head, e.g. "black quiff, dark eyebrows and face style"
//   top    what the upper body wears, as the prompts name it, e.g. "shirt, tie, heart pin"
//   legs   what the lower body wears, e.g. "trousers, shoes"
//   mouth  a sentence on the mouth's size, for the mouth frames
//   crop   the head crop box in image pixels [left, top, width, height] (#71); Fraser's is [236, 30, 376, 300]
// The prompts are Fraser's standing ones (art/presenters/fraser/prompts.json), with the image edge named in every direction ("towards the RIGHT edge of the image", never "viewer's right").
// Left out on purpose: leans h5/h6 (made in code, mode "tilt", tools/bake/README.md), the left glance v8 (Gemini looks right whatever is asked; the glance is code), and h2v1-h2v7
// (Gemini turns heads the wrong way for the left turn: mirror h1 and h1v* for h2 if h2 comes out wrong). h1v1-h1v7 wait for h1 to be approved ("Waiting for a parent image").
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..'), name = process.argv[2];
if (!name) { console.error('Usage: node tools/frames/standing.mjs <presenter>'); process.exit(1); }
const dir = path.join(ROOT, 'art/presenters', name), inFile = path.join(dir, 'standing.json');
if (!fs.existsSync(inFile)) { console.error(`No ${path.relative(ROOT, inFile)}`); process.exit(1); }
const S = JSON.parse(fs.readFileSync(inFile, 'utf8')), P = S.pronoun === 'he' ? { s: 'he', o: 'him', p: 'his' } : { s: 'she', o: 'her', p: 'her' };
const Ps = P.s[0].toUpperCase() + P.s.slice(1);

const GRID = `same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid`;
const KEEP = `Keep everything exactly identical: ${GRID}. Do not move or resize anything`;
const HEAD = `Edit this image. Keep the body, both arms hanging down, the hands, jacket, ${S.top}, ${S.legs} and background exactly identical: ${GRID}. Do not move or resize the figure, and do not move ${P.p} feet or shoulders. Keep ${P.p} ${S.look} exactly as in the original, with the same neutral closed-mouth expression and the same eye style. Change only the head:`;
const ARMS = `Edit this image. Keep the head, face, hair, neck, ${S.top}, ${S.legs} and background exactly identical: ${GRID}. Do not move or resize the figure, and do not move ${P.p} feet. Keep ${P.p} expression exactly as in the original. Change only ${P.p} arms and hands:`;
const SLEEVES = `The suit sleeves and shirt cuffs stay the same style and colours as in the original.`;
const LEGS = `Edit this image. Keep the head, face, hair, neck, ${S.top}, jacket, both arms and hands, and the jacket hem exactly identical, and keep the background exactly identical: ${GRID}. Everything above the bottom of the jacket (about 65% of the way down the image) must be unchanged. Do not move or resize the figure. Change only ${P.p} ${S.legs} below that line`;
const MOUTH = (what, turned) => `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. ${turned ? 'Keep the head turned exactly as in the original, at the same angle, with the same eyebrows and eyes' : 'Keep the eyebrows and eyes exactly as in the original'}: same shape, same position, relaxed and neutral. Keep the mouth in the same position on the face, ${turned ? 'along the same angle as the original mouth, ' : ''}with the same centre and no wider than the mouth in the original: ${turned ? TURNED : S.mouth} Change only this one thing: ${what}`;
const MOUTHS = [
  ['v1', 'the mouth is closed with a gentle slight smile.'],
  ['v2', 'the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.'],
  ['v3', 'the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.'],
  ['v4', 'the mouth is a small round "oh", the lips rounded and a little open.'],
  ['v5', 'the mouth is open for an "ah", the jaw dropped a little, a dark inside and the top teeth just visible.'],
  ['v6', 'the lips are pressed together in a flat line, neither smiling nor frowning.'],
];
const TURNED = `${S.mouth.replace(/\.$/, '')}, and ${P.p} head is turned, so keep it small and keep its angle.`;
const BLINK = `both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.`;

const prompts = {}, frames = [{ name: 'b1', area: 'master' }];
const add = (n, parent, area, prompt, extra = {}, expect = null) => { frames.push({ name: n, parent, area, ...extra }); prompts[n] = { source: parent, prompt, ...(expect ? { expect } : {}), from: 'tools/frames/standing.mjs' }; };

// the master comes first and every other frame copies its framing: make it by hand (art/presenters/<name>/master-prompts.md), not through the queue
const head = (n, what, expect) => add(n, 'b1', 'head', `${HEAD} ${what} The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.`, {}, expect);
head('h1', `turn it a few degrees (a small, subtle turn, about 8 degrees) so ${P.p} nose and gaze point towards the RIGHT edge of the image (the right-hand side of the picture, as you look at it). Do not turn it towards the left edge.`, { dir: 'right', measure: 'changed' });
head('h2', `turn it a few degrees (a small, subtle turn, about 8 degrees) so ${P.p} nose and gaze point towards the LEFT edge of the image (the left-hand side of the picture, as you look at it). Do not turn it towards the right edge.`, { dir: 'left', measure: 'changed' });
head('h3', `tilt it very slightly forward and down, as in a small nod, about 6 degrees, so the chin dips a little towards the chest and the top of the head tips forward.`);
head('h4', `tilt it very slightly back and up, as at the top of a small nod, about 5 degrees, so the chin lifts a little.`);

for (const [n, what] of MOUTHS) add(n, 'b1', 'patch', MOUTH(what), { crop: true });
add('v7', 'b1', 'patch', `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: ${BLINK}`, { crop: true });
add('v9', 'b1', 'patch', `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: both eyes are open as before, but the irises and pupils sit against the RIGHT corner of each eye as seen in the picture (the edge nearest the right side of the image), so a sliver of white shows on the left side of each iris and none on the right. ${Ps} is glancing sideways towards the right edge of the picture with ${P.p} head still facing forward.`, { crop: true }, { dir: 'right', measure: 'dark' });

const pose = (n, what, expect) => add(n, 'b1', 'arm', `${ARMS} ${what} ${SLEEVES}`, {}, expect);
pose('b2', `${P.p} arm on the RIGHT edge of the image is extended out to the side and slightly up, with ${P.p} index finger pointing clearly towards the right edge of the image, as if pointing at an item on a screen, the other fingers curled and the thumb tucked. ${P.p[0].toUpperCase() + P.p.slice(1)} other arm hangs relaxed at ${P.p} side.`, { dir: 'right', measure: 'changed' });
pose('b3', `${P.p} arm on the RIGHT edge of the image is raised and a little out from ${P.p} side, the elbow bent, the open palm facing up and towards the right edge of the image, fingers together and slightly spread, in a wide, welcoming, emphasising gesture. ${P.p[0].toUpperCase() + P.p.slice(1)} other arm hangs relaxed at ${P.p} side.`, { dir: 'right', measure: 'changed' });
pose('b4', `both elbows are bent and both hands are held together in front of ${P.o} at lower chest height, fingertips lightly touching, as if making a point in a calm explanation.`);
pose('b5', `both arms are bent at the elbows and ${P.s} holds a small dark navy tablet in front of ${P.o} at waist height, one hand underneath and the other steadying it at the side, as if reading from it. Only the thin edge and the back of the tablet are visible to the viewer, with no text and no screen glow.`);
pose('b6', `${P.p} arm on the LEFT edge of the image is bent with the hand resting on ${P.p} hip under the open jacket edge, elbow pointing out towards the left edge of the image, and ${P.p} other arm hangs relaxed at ${P.p} side, a confident, attentive, listening pose.`, { dir: 'left', measure: 'changed' });
pose('b7', `${P.p} arm on the LEFT edge of the image is raised out to the side with the open palm facing up and towards the left edge of the image, as if presenting something to the left, fingers together. ${P.p[0].toUpperCase() + P.p.slice(1)} other arm hangs relaxed at ${P.p} side. Do not move the arm on the right edge of the image.`, { dir: 'left', measure: 'changed' });
pose('b8', `both arms are held out a little from ${P.p} sides, elbows bent, both palms open and facing slightly upwards at waist height, in a warm, open, welcoming sign-off gesture.`);

const legs = (n, what) => add(n, 'b1', 'legs', `${LEGS}${what}`);
legs('f1', `: ${P.s} shifts ${P.p} weight onto the leg on the RIGHT edge of the image, which stands straight and carries all ${P.p} weight, while the leg on the LEFT edge of the image relaxes: that knee is slightly bent, and that foot is placed visibly out towards the left edge of the image and a little forward, with the heel slightly lifted off the floor, so the two feet are clearly in different positions. The trouser hems stay the same style and colour. A natural relaxed weight shift, not a step.`);
legs('f2', `: ${P.s} shifts ${P.p} weight onto the leg on the LEFT edge of the image, which stands straight and carries all ${P.p} weight, while the leg on the RIGHT edge of the image relaxes: that knee is slightly bent, and that foot is placed visibly out towards the right edge of the image and a little forward, with the heel slightly lifted off the floor, so the two feet are clearly in different positions. The trouser hems stay the same style and colour. A natural relaxed weight shift, not a step.`);
legs('f3', `, and only slightly: both legs stand straight with ${P.p} weight even, and ${P.p} feet are placed a little further apart than in the original, about shoulder width, both feet flat on the floor, toes pointing slightly outwards.`);

// round 2: the turned head's own mouths and blink, cut from h1 once it is approved
for (const [n, what] of MOUTHS) add('h1' + n, 'h1', 'mouth', MOUTH(what, true), { crop: true });
add('h1v7', 'h1', 'eyes', `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. Keep the head turned exactly as in the original, at the same angle, with the same mouth, nose, hair and brows. Change only this one thing: ${BLINK} The far eye, which is partly hidden by the turn, is closed too.`, { crop: true });

const cfg = {
  _note: 'Standing set (#89), scaffolded by tools/frames/standing.mjs from Fraser\'s tuned values. Grid, cut rows, crop, boxes and the face block are provisional until the master is approved: tune them in this file by hand from then on.',
  src: `site/public/spike/${name}/standing/`,
  grid: { w: 145, h: 216 },
  bg: 'corner', matchColour: true,
  headCut: 48, feetTop: 138,
  heads: ['b1', 'h1', 'h2', 'h3', 'h4'],
  poses: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'],
  feet: ['b1', 'f1', 'f2', 'f3'],
  eyes: ['blink', 'gazeL', 'gazeR'],
  mouths: ['smile', 'closed', 'small', 'wide', 'O', 'A'],
  crop: { box: S.crop || [236, 30, 376, 300], scale: 3 },
  boxes: {},
  face: {
    register: 'detect',
    patch: { base: 'b1', mouthBase: 'b1', mouths: { smile: 'v1', small: 'v2', wide: 'v3', O: 'v4', A: 'v5', closed: 'v6' }, eyes: { blink: 'v7', gazeR: 'v9' } },
    heads: { b1: { mode: 'patch' }, h1: { mode: 'set' }, h2: { mode: 'set' }, h3: { mode: 'set' }, h4: { mode: 'set' } },
  },
  frames,
};
fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(cfg, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify({ _note: 'Generation prompts for tools/frames, scaffolded by tools/frames/standing.mjs.', frames: prompts }, null, 1) + '\n');
console.log(`${name}: ${frames.length} frames (${frames.length - 1} prompts) → ${path.relative(ROOT, dir)}`);
