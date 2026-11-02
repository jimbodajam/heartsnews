// Free frame generation queue for the standing presenters (#72). Prompts live in art/presenters/<name>/prompts.json, state in art/presenters/<name>/queue.json.
// Run from the repo root, in WSL: node tools/frames/frames.mjs <command> <presenter> ...   (npm run frames -- <command> <presenter> ...)
// Commands, in the order a frame goes through them:
//   queue   <p> [--redo a,b]     frames in frames.json with a prompt and no image yet (or the ones to redo) → queue.json
//   next    <p> [--json]         the next frame to generate: what to attach, the prompt, the name to save as
//   mark    <p> <frame> saved|failed|limit [note]   the generation run reports back
//   collect <p> [--from dir] [--force]   pick the saved downloads up, stage them, run the checks
//   sheet   <p>                  contact sheet of the frames that passed → tools/frames/out/<p>-contact.html
//   approve <p> <frame...|--all> copy approved frames to the standing folder
//   reject  <p> <frame> <reason> back on the queue for the next day
//   bake    <p>                  run the bake for the approved frames
//   status  <p>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { frameGrid, matchColour } from '../bake/grid.mjs';
import { checkFrame, changedCells, inArea } from './check.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..'), OUT = path.join(ROOT, 'tools/frames/out'), IMG = /\.(png|jpe?g|webp)$/i;
const dir = name => path.join(ROOT, 'art/presenters', name), rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const now = () => new Date().toISOString();

function load(name) {
  if (!name || !fs.existsSync(path.join(dir(name), 'frames.json'))) die(`No presenter "${name}" (art/presenters/<name>/frames.json)`);
  const cfg = readJSON(path.join(dir(name), 'frames.json')), pf = path.join(dir(name), 'prompts.json'), qf = path.join(dir(name), 'queue.json');
  const prompts = fs.existsSync(pf) ? readJSON(pf).frames : {}, queue = fs.existsSync(qf) ? readJSON(qf) : { presenter: name, limitHit: null, items: [] };
  const fileOf = f => path.join(ROOT, cfg.src, f.file || f.name + '.jpg'), frame = n => cfg.frames.find(f => f.name === n);
  return { name, cfg, prompts, queue, fileOf, frame, save: () => fs.writeFileSync(qf, JSON.stringify({ ...queue, updated: now() }, null, 1) + '\n') };
}
function die(msg) { console.error(msg); process.exit(1); }
const item = (P, n) => P.queue.items.find(i => i.frame === n) || die(`${n} is not in the queue`);
const staged = P => path.join(dir(P.name), 'queue/staged');
/** A path the Windows side can open: Claude in Chrome uploads from Windows, the repo is reached from WSL. */
const winPath = p => { if (!process.env.WSL_DISTRO_NAME) return p; try { return execFileSync('wslpath', ['-w', p]).toString().trim(); } catch { return p; } };

function queue(P, args) {
  const redo = new Set((flag(args, '--redo') || '').split(',').filter(Boolean)), old = new Map(P.queue.items.map(i => [i.frame, i])), items = [], missingPrompt = [];
  for (const f of P.cfg.frames) {
    if (f.area === 'master') continue;
    const want = redo.has(f.name) || !fs.existsSync(P.fileOf(f));
    const pr = P.prompts[f.name];
    if (!want) continue;
    if (!pr) { missingPrompt.push(f.name); continue; }
    const parent = P.frame(pr.source) || P.frame(f.parent);
    const prev = old.get(f.name);
    items.push({ frame: f.name, source: parent.name, attach: rel(P.fileOf(parent)), save: f.file || f.name + '.jpg',
      status: prev && !redo.has(f.name) && prev.status !== 'baked' ? prev.status : 'pending', attempts: prev?.attempts || 0, reasons: prev?.reasons || [], savedAt: prev?.savedAt, staged: prev?.staged });
  }
  P.queue.items = items; P.save();
  const by = s => items.filter(i => i.status === s).length;
  console.log(`${P.name}: ${items.length} in the queue (${by('pending')} pending, ${by('rejected')} rejected, ${by('saved')} saved, ${by('passed')} passed, ${by('approved')} approved)`);
  if (missingPrompt.length) console.log(`No prompt in prompts.json for: ${missingPrompt.join(' ')}`);
}

const todo = P => P.queue.items.filter(i => i.status === 'pending' || i.status === 'rejected');

function next(P, args) {
  const i = todo(P)[0];
  if (!i) return console.log(args.includes('--json') ? 'null' : `Nothing left to generate for ${P.name}.`);
  const out = { frame: i.frame, attach: winPath(path.join(ROOT, i.attach)), saveAs: i.save, prompt: P.prompts[i.frame].prompt, attempts: i.attempts, lastRejected: i.reasons.at(-1) || null, remaining: todo(P).length };
  if (args.includes('--json')) return console.log(JSON.stringify(out, null, 1));
  console.log(`Frame ${out.frame} (${out.remaining} left)\nAttach: ${out.attach}\nSave as: ${out.saveAs}${out.lastRejected ? `\nRejected last time: ${out.lastRejected}` : ''}\n\n${out.prompt}`);
}

function mark(P, [frame, state, ...note]) {
  const i = item(P, frame);
  if (state === 'saved') Object.assign(i, { status: 'saved', savedAt: now(), attempts: i.attempts + 1 });
  else if (state === 'limit') P.queue.limitHit = now();
  else if (state === 'failed') i.reasons.push(`run failed: ${note.join(' ') || 'no detail'}`);
  else die('mark <frame> saved|failed|limit [note]');
  if (state === 'limit') P.queue.limitNote = note.join(' ') || null;
  P.save(); console.log(`${frame}: ${state}`);
}

function downloads(args) {
  const from = flag(args, '--from') || process.env.FRAMES_DOWNLOADS;
  if (from) return from;
  if (process.env.WSL_DISTRO_NAME) try { return execFileSync('wslpath', ['-u', execFileSync('cmd.exe', ['/c', 'echo %USERPROFILE%']).toString().trim() + '\\Downloads']).toString().trim(); } catch { /* fall through */ }
  return path.join(os.homedir(), 'Downloads');
}

async function pix(P, file, size) {
  let s = sharp(file).ensureAlpha(); if (size) s = s.resize(size.w, size.h, { fit: 'fill' });
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { img: { data, w: info.width, h: info.height } };
}
const gridOf = (P, img) => frameGrid(img, P.cfg.grid, P.cfg.bg);

/** Saved downloads → staged frames. Named files (`h4v6.png`) match by name; Gemini's own names match the saved frames in the order they were saved. */
async function collect(P, args) {
  const src = downloads(args), saved = P.queue.items.filter(i => i.status === 'saved').sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  if (!fs.existsSync(src)) die(`No folder ${src}. Pass --from <dir>`);
  const seen = new Set(P.queue.seen || []), since = saved.length ? Date.parse(saved[0].savedAt) - 120000 : 0;
  const files = fs.readdirSync(src).filter(f => IMG.test(f)).map(f => ({ f, p: path.join(src, f), t: fs.statSync(path.join(src, f)).mtimeMs })).filter(x => x.t >= since && !seen.has(x.f + '@' + x.t)).sort((a, b) => a.t - b.t);
  const take = new Map(), loose = [];
  for (const x of files) {
    const stem = path.parse(x.f).name.replace(/ \(\d+\)$/, ''), it = P.queue.items.find(i => i.frame.toLowerCase() === stem.toLowerCase() && i.status !== 'baked' && i.status !== 'approved');
    if (it) take.set(it.frame, x); else if (/^gemini/i.test(x.f) || args.includes('--any')) loose.push(x);
  }
  const waiting = saved.filter(i => !take.has(i.frame));
  if (loose.length && waiting.length) {
    if (loose.length !== waiting.length && !args.includes('--force')) die(`${loose.length} unnamed downloads in ${src} but ${waiting.length} saved frames (${waiting.map(i => i.frame).join(' ')}). Name the files by frame, or pass --force to pair them in order.`);
    waiting.forEach((i, k) => loose[k] && take.set(i.frame, loose[k]));
  }
  if (!take.size) return console.log(`Nothing new in ${src} for ${saved.length} saved frames.`);
  fs.mkdirSync(staged(P), { recursive: true });
  P.queue.seen = [...seen];
  for (const [frame, x] of take) {
    const i = item(P, frame), ext = path.extname(x.f).toLowerCase(), to = path.join(staged(P), frame + ext);
    fs.copyFileSync(x.p, to); P.queue.seen.push(x.f + '@' + x.t);
    for (const old of fs.readdirSync(staged(P))) if (path.parse(old).name === frame && old !== frame + ext) fs.rmSync(path.join(staged(P), old));
    Object.assign(i, { staged: rel(to) }); i.attempts = Math.max(i.attempts, 1);
    const res = await checkItem(P, i, to);
    i.status = res.ok ? 'passed' : 'rejected'; if (!res.ok) i.reasons.push(`${today()}: ${res.reasons.join('; ')}`); i.stats = res.stats;
    console.log(`${frame}: ${res.ok ? 'passed' : 'REJECTED, ' + res.reasons.join('; ')}  ${JSON.stringify(res.stats)}`);
  }
  P.save();
}
const today = () => now().slice(0, 10);

async function checkItem(P, i, file) {
  const f = P.frame(i.frame), parent = P.frame(f.parent), pf = P.fileOf(parent);
  if (!fs.existsSync(pf)) return { ok: false, reasons: [`parent ${f.parent} has no image`], stats: {} };
  const pm = await sharp(pf).metadata(), cm = await sharp(file).metadata();
  if (Math.abs(cm.width / cm.height - pm.width / pm.height) > 0.01) return { ok: false, reasons: [`wrong shape: ${cm.width}x${cm.height}, wanted ${pm.width}x${pm.height}`], stats: {} };
  const pImg = (await pix(P, pf)).img, cImg = (await pix(P, file, { w: pm.width, h: pm.height })).img, parentGrid = gridOf(P, pImg);
  let cand = gridOf(P, cImg);
  if (P.cfg.matchColour && f.area !== 'arm' && f.area !== 'legs') cand = matchColour(cand, parentGrid);
  const expect = P.prompts[i.frame]?.expect || null;
  const res = checkFrame(cand, parentGrid, f, P.cfg, expect, undefined, { cand: cImg, parent: pImg });
  return res;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function gridPng(Q, mark) {
  const S = 3, buf = Buffer.alloc(Q.w * S * Q.h * S * 4);
  for (let y = 0; y < Q.h; y++) for (let x = 0; x < Q.w; x++) {
    const c = mark?.(x, y) || (Q.has(x, y) ? Q.get(x, y) : [40, 46, 80]);
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const k = ((y * S + a) * Q.w * S + x * S + b) * 4; buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255; }
  }
  return 'data:image/png;base64,' + (await sharp(buf, { raw: { width: Q.w * S, height: Q.h * S, channels: 4 } }).png().toBuffer()).toString('base64');
}

async function sheet(P) {
  const ok = P.queue.items.filter(i => i.status === 'passed'), bad = P.queue.items.filter(i => i.status === 'rejected' && i.staged);
  const cards = [];
  for (const i of ok) {
    const f = P.frame(i.frame), file = path.join(ROOT, i.staged), pm = await sharp(P.fileOf(P.frame(f.parent))).metadata();
    const pg = gridOf(P, (await pix(P, P.fileOf(P.frame(f.parent)))).img);
    let cg = gridOf(P, (await pix(P, file, { w: pm.width, h: pm.height })).img);
    if (P.cfg.matchColour && f.area !== 'arm' && f.area !== 'legs') cg = matchColour(cg, pg);
    const ch = new Set(changedCells(cg, pg).map(([x, y]) => x + ',' + y)), inside = inArea(P.cfg, f);
    const diff = await gridPng(cg, (x, y) => ch.has(x + ',' + y) ? (inside(x, y) ? [255, 210, 0] : [255, 0, 60]) : (cg.has(x, y) ? cg.get(x, y).map(v => v * 0.45) : null));
    cards.push(`<label class="card"><input type="checkbox" value="${esc(i.frame)}" checked><h3>${esc(i.frame)} <small>${esc(f.area)} of ${esc(f.parent)}${i.stats?.direction != null ? ', moved ' + i.stats.direction : ''}</small></h3><div class="row"><figure><img src="${await gridPng(pg)}"><figcaption>${esc(f.parent)}</figcaption></figure><figure><img src="${await gridPng(cg)}"><figcaption>new</figcaption></figure><figure><img src="${diff}"><figcaption>changed (yellow in area, red outside)</figcaption></figure></div></label>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(P.name)} frames to approve</title><style>
body{font:14px system-ui;background:#161922;color:#eee;margin:16px}h1{font-size:18px}h3{margin:0 0 6px}small{color:#9aa}.grid{display:flex;flex-wrap:wrap;gap:12px}.card{background:#222736;padding:10px;border-radius:6px;cursor:pointer}.card:has(input:not(:checked)){opacity:.35}.row{display:flex;gap:6px}figure{margin:0;font-size:11px;color:#9aa}img{image-rendering:pixelated;display:block}pre{background:#0c0e14;padding:10px;user-select:all;white-space:pre-wrap}button{font:inherit;padding:6px 12px}</style>
<h1>${esc(P.name)}: ${ok.length} frames passed the checks</h1><p>Untick any you do not want. Nothing is baked until you run the command below.</p>
<div class="grid">${cards.join('\n') || '<p>No frames passed yet. Run <code>collect</code>.</p>'}</div>
<h2>Run</h2><pre id="cmd"></pre><button onclick="navigator.clipboard.writeText(cmd.textContent)">Copy</button>
${bad.length ? `<h2>Rejected, back on the queue</h2><ul>${bad.map(i => `<li><b>${esc(i.frame)}</b>: ${esc(i.reasons.at(-1) || '')}</li>`).join('')}</ul>` : ''}
<script>const boxes=[...document.querySelectorAll('input[type=checkbox]')];function upd(){const on=boxes.filter(b=>b.checked).map(b=>b.value),off=boxes.filter(b=>!b.checked).map(b=>b.value);document.getElementById('cmd').textContent='npm run frames -- approve ${esc(P.name)} '+(on.length?on.join(' '):'--none')+(off.length?'\\nnpm run frames -- reject ${esc(P.name)} <frame> "<why>"   # for: '+off.join(' '):'')+'\\nnpm run frames -- bake ${esc(P.name)}'}boxes.forEach(b=>b.onchange=upd);upd()</script>`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${P.name}-contact.html`); fs.writeFileSync(file, html);
  console.log(`${ok.length} passed, ${bad.length} rejected → ${winPath(file)}`);
}

async function approve(P, args) {
  const names = args.includes('--all') ? P.queue.items.filter(i => i.status === 'passed').map(i => i.frame) : args.filter(a => !a.startsWith('--'));
  for (const n of names) {
    const i = item(P, n), f = P.frame(n);
    if (i.status !== 'passed') { console.log(`${n}: ${i.status}, not passed, skipped`); continue; }
    const to = P.fileOf(f), from = path.join(ROOT, i.staged);
    if (/\.jpe?g$/i.test(from)) fs.copyFileSync(from, to); else await sharp(from).jpeg({ quality: 95 }).toFile(to);
    i.status = 'approved'; console.log(`${n}: approved → ${rel(to)}`);
  }
  P.save();
}

function reject(P, [frame, ...why]) {
  const i = item(P, frame); i.status = 'rejected'; i.reasons.push(`${today()}: ${why.join(' ') || 'rejected by eye'}`); P.save(); console.log(`${frame}: back on the queue`);
}

function bake(P) {
  const ok = P.queue.items.filter(i => i.status === 'approved');
  if (!ok.length) return console.log('Nothing approved to bake.');
  execFileSync('node', [path.join(ROOT, 'tools/bake/bake.mjs'), P.name], { cwd: ROOT, stdio: 'inherit' });
  for (const i of ok) i.status = 'baked'; P.save();
  console.log(`Baked ${ok.map(i => i.frame).join(' ')}. Commit the images, the sheets in site/public/presenters/ and queue.json.`);
}

function status(P) {
  const c = {}; for (const i of P.queue.items) c[i.status] = (c[i.status] || 0) + 1;
  console.log(P.name, c, P.queue.limitHit ? `daily limit hit ${P.queue.limitHit}` : '');
  for (const i of P.queue.items) console.log(`  ${i.frame.padEnd(6)} ${i.status.padEnd(9)} tries ${i.attempts}${i.reasons.length ? '  ' + i.reasons.at(-1) : ''}`);
}

function flag(args, n) { const k = args.indexOf(n); return k < 0 ? null : args.splice(k, 2)[1]; }

const [cmd, name, ...args] = process.argv.slice(2), table = { queue, next, mark, collect, sheet, approve, reject, bake, status };
if (!table[cmd]) die(`Usage: frames <${Object.keys(table).join('|')}> <presenter> ...  (see the top of tools/frames/frames.mjs)`);
await table[cmd](load(name), args);
