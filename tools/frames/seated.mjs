// Scaffolds a seated desk set for a presenter (#78): art/presenters/<name>-seated/{frames.json,prompts.json}, ready for the frame queue (tools/frames/frames.mjs) and the bake.
// Run from the repo root, in WSL: node tools/frames/seated.mjs <presenter>   (npm run frames:seated -- <presenter>)
// Input: art/presenters/<name>-seated/seated.json, the words that differ per presenter (see below). Re-running rewrites frames.json and prompts.json, so tune cut rows, boxes and the face block in
// frames.json only once the master is approved, and then stop running this for that presenter.
//
// seated.json: { standing, pronoun: "she"|"he", look, clothes, mouth, standingFace }
//   standing     the standing set this one shares its palette with (frames.json `paletteFrom`)
//   look         what must not change on the head, e.g. "hairstyle, hair colour and face style"
//   clothes      what the body wears, as the prompts name it
//   mouth        a sentence on the mouth's size, for the mouth frames
// The frame list is the one in the issue: master, head moves h1-h6, shared patches v1-v7, own mouth and blink sets for the two turns, five desk poses.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..'), name = process.argv[2];
if (!name) { console.error('Usage: node tools/frames/seated.mjs <presenter>'); process.exit(1); }
const dir = path.join(ROOT, 'art/presenters', name + '-seated'), inFile = path.join(dir, 'seated.json');
if (!fs.existsSync(inFile)) { console.error(`No ${path.relative(ROOT, inFile)}`); process.exit(1); }
const S = JSON.parse(fs.readFileSync(inFile, 'utf8')), P = S.pronoun === 'he' ? { s: 'he', o: 'him', p: 'his' } : { s: 'she', o: 'her', p: 'her' };

const KEEP = `Keep everything exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize anything`;
const BODY = `Keep the body, the ${S.clothes}, both forearms and hands resting on the desk, and the background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure, and do not move ${P.p} shoulders. Keep the ${S.look} exactly as in the original, with the same neutral closed-mouth expression and the same eye style.`;
const NECK = `The neck stays attached at the same place on the shoulders, and the head stays the same size and at the same height.`;
const ARMS = `Keep the head, face, hair, neck, ${S.clothes} and background exactly identical: same pixels, same position, same size, same colours, same outline, same flat background colour, the same pixel grid. Do not move or resize the figure or ${P.p} shoulders. Keep ${P.p} expression exactly as in the original. Change only ${P.p} arms and hands, and nothing else. There is no desk in this image: do not draw a desk, table or any surface, and keep the flat background colour exactly the same everywhere. The image ends at the waist, so there are no legs, feet or lap.`;
const MOUTH = (what, head) => `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the ${head ? 'head' : 'hair'}. ${head ? `Keep the head ${head} exactly as in the original, at the same angle, with the same eyebrows and eyes: same shape, same position, relaxed and neutral. ` : 'Keep the eyebrows and eyes exactly as in the original: same shape, same position, relaxed and neutral. '}Keep the mouth in the same position on the face${head ? ', along the same angle as the original mouth,' : ','} with the same centre and no wider than the mouth in the original: ${S.mouth} Change only this one thing: ${what}`;
const MOUTHS = [
  ['v1', 'the mouth is closed with a gentle slight smile.'],
  ['v2', 'the lips are slightly parted, relaxed, a thin dark gap and no visible teeth.'],
  ['v3', 'the mouth is a relaxed "ee" shape, only slightly wider than closed, with a thin strip of the top teeth visible.'],
  ['v4', 'the mouth is a small round "oh", the lips rounded and a little open.'],
  ['v5', 'the mouth is open for an "ah", the jaw dropped a little, a dark inside and the top teeth just visible.'],
  ['v6', 'the lips are pressed together in a flat line, neither smiling nor frowning.'],
];
const BLINK = `both eyes are fully closed, as in a blink, with the closed lids drawn as a curved dark line.`;

const prompts = {}, frames = [{ name: 'b1', area: 'master' }];
const add = (n, parent, area, source, prompt, extra = {}, expect = null) => { frames.push({ name: n, parent, area, ...extra }); prompts[n] = { source, prompt, ...(expect ? { expect } : {}), from: 'tools/frames/seated.mjs' }; };

// the master comes first and every other frame copies its framing: draw it by hand from the standing master (see tools/bake/README.md), not through the queue
const head = (n, dir, what) => add(n, 'b1', 'head', 'b1', `Edit this image. ${BODY} Change only the head: ${what}. ${NECK}`, {}, dir ? { dir, measure: 'changed' } : null);
head('h1', 'right', `turn it a few degrees (a small, subtle turn, about 8 degrees) so ${P.p} nose and gaze point towards the RIGHT edge of the image (the right-hand side of the picture, as you look at it). Do not turn it towards the left edge`);
head('h2', 'left', `turn it a few degrees (a small, subtle turn, about 8 degrees) so ${P.p} nose and gaze point towards the LEFT edge of the image (the left-hand side of the picture, as you look at it). Do not turn it towards the right edge`);
head('h3', null, `tilt it very slightly forward and down, as in a small nod, about 6 degrees, so the chin dips a little towards the chest and the top of the head tips forward`);
head('h4', null, `tilt it very slightly back and up, as at the top of a small nod, about 5 degrees, so the chin lifts a little`);
head('h5', null, `tilt it sideways a small amount, about 5 degrees, so ${P.p} head leans slightly towards the shoulder on the LEFT edge of the image, as if listening with interest`);
head('h6', null, `tilt it sideways a small amount, about 5 degrees, so ${P.p} head leans slightly towards the shoulder on the RIGHT edge of the image`);

for (const [n, what] of MOUTHS) add(n, 'b1', 'patch', 'b1', MOUTH(what), { crop: true });
add('v7', 'b1', 'patch', 'b1', `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. Keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: ${BLINK}`, { crop: true });
for (const h of ['h1', 'h2']) {
  const turned = `turned towards the ${h === 'h1' ? 'RIGHT' : 'LEFT'} edge of the image`;
  for (const [n, what] of MOUTHS) add(h + n, h, 'mouth', h, MOUTH(what, turned), { crop: true });
  add(h + 'v7', h, 'eyes', h, `Edit this image. ${KEEP}, and do not change the pose, the body, the clothes or the head. Keep the head ${turned} exactly as in the original, at the same angle, and keep the mouth, nose, hair and brows exactly as in the original. Change only this one thing: ${BLINK}`, { crop: true });
}

const pose = (n, area, what, expect) => add(n, 'b1', area, 'b1', `Edit this image. ${ARMS} ${what}`, {}, expect);
pose('d1', 'hands', `Both hands rest flat, palms down, at the same height as the clasped hands in the original, in front of ${P.o}, fingers relaxed, forearms level.`);
pose('d2', 'hands', `Both hands are clasped together in front of ${P.o}, fingers interlaced, forearms level.`);
pose('d3', 'hands', `Both hands hold a few sheets of paper at waist height in front of ${P.o}, as if checking notes. The paper is plain white with no writing.`);
pose('d4', 'arm', `${P.s[0].toUpperCase() + P.s.slice(1)} makes a small open-hand gesture with the hand on the RIGHT edge of the image: the palm turned up and the hand lifted a little, fingers loose, as if making a point. The other hand rests low, at the same height as in the original.`, { dir: 'right', measure: 'changed' });
pose('d5', 'arm', `One arm turns towards the LEFT edge of the image, the open hand held out low and flat towards the seat of the other presenter, as if handing over. The other hand rests low, at the same height as in the original.`, { dir: 'left', measure: 'changed' });

const cfg = {
  _note: 'Seated desk set (#78), scaffolded by tools/frames/seated.mjs. Grid, cut rows, boxes and the face block are provisional until the master is approved: tune them in this file by hand from then on.',
  src: `site/public/spike/${name}/seated/`,
  paletteFrom: S.standing || name,
  grid: { w: 240, h: 131 },
  bg: 'corner', matchColour: false,
  headCut: 49, handsTop: 100, feetTop: 131,
  heads: ['b1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  poses: ['b1', 'd1', 'd2', 'd3', 'd4', 'd5'],
  feet: [],
  eyes: ['blink'],
  mouths: ['smile', 'closed', 'small', 'wide', 'O', 'A'],
  crop: { box: [0, 0, 0, 0], scale: 3 },
  boxes: {},
  face: {
    register: 'detect',
    patch: { base: 'b1', mouthBase: 'b1', mouths: { smile: 'v1', small: 'v2', wide: 'v3', O: 'v4', A: 'v5', closed: 'v6' }, eyes: { blink: 'v7' } },
    mouthAlias: {},
    heads: { b1: { mode: 'patch' }, h1: { mode: 'set', warpEyes: true }, h2: { mode: 'set', warpEyes: true }, h3: { mode: 'patch' }, h4: { mode: 'patch' }, h5: { mode: 'patch', warpEyes: true }, h6: { mode: 'patch', warpEyes: true } },
  },
  frames,
};
fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(cfg, null, 1) + '\n');
fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify({ _note: 'Generation prompts for tools/frames, scaffolded by tools/frames/seated.mjs.', frames: prompts }, null, 1) + '\n');
console.log(`${name}-seated: ${frames.length} frames (${frames.length - 1} prompts) → ${path.relative(ROOT, dir)}`);
