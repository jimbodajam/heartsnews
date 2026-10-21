// Renders every pronunciations.json entry twice ("as written" vs "respelled") onto a page for checking by ear.
// Usage: npm run pronounce [-- Celtic Vrancken]   then open http://localhost:5173/voice-samples/pronunciations/index.html
// Clips are cached by text, so after editing a respelling only that entry is re-rendered.

import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KokoroTTS } from 'kokoro-js';
import { loadPronunciations } from './pronounce.ts';
import { shortHash } from './text.ts';
import { CLIP_EXT, loadKokoro, renderClip } from './voice.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(ROOT, 'site/public/voice-samples/pronunciations');
const VOICE = 'bf_emma';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function main() {
  const words = loadPronunciations();
  const only = process.argv.slice(2);
  const entries = Object.entries(words).filter(([k]) => !only.length || only.includes(k));
  await mkdir(OUT, { recursive: true });

  let tts: KokoroTTS | undefined;
  const clip = async (text: string) => {
    const name = `${shortHash(`${VOICE}|${text}`)}.${CLIP_EXT}`;
    if (!existsSync(resolve(OUT, name))) {
      tts ??= await loadKokoro();
      await renderClip(tts, `${text}.`, VOICE, 1, resolve(OUT, name));
    }
    return name;
  };

  const rows: string[] = [];
  const used = new Set<string>();
  for (const [word, respelled] of entries) {
    const before = await clip(word);
    const after = await clip(respelled);
    used.add(before).add(after);
    console.log(`  ${word.padEnd(16)} → ${respelled}`);
    rows.push(
      `<tr data-word="${esc(word)}" data-respelled="${esc(respelled)}"><td><b>${esc(word)}</b></td>` +
        `<td><audio controls preload="none" src="${before}"></audio></td>` +
        `<td><code>${esc(respelled)}</code></td><td><audio controls preload="none" src="${after}"></audio></td>` +
        `<td class="verdict"><button data-v="good" title="Fixed version is right">✓</button>` +
        `<button data-v="bad" title="Still wrong">✗</button>` +
        `<button data-v="default" title="The default was fine; drop the fix">Default fine</button>` +
        `<input type="text" placeholder="How should it sound?" hidden></td></tr>`,
    );
  }

  if (!only.length) {
    for (const f of await readdir(OUT)) if (f !== 'index.html' && !used.has(f)) await rm(resolve(OUT, f));
  }

  await writeFile(
    resolve(OUT, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pronunciation Check</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #120f16; color: #f2efe6; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 900px; margin: 0 auto; }
  p { color: #a39cab; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #332c3c; vertical-align: middle; }
  th { color: #e0b13a; font-weight: 600; }
  code { color: #e0b13a; }
  audio { height: 32px; max-width: 200px; }
  .verdict { white-space: nowrap; }
  .verdict button { background: #1e1a24; color: #a39cab; border: 1px solid #332c3c; border-radius: 6px; padding: 4px 9px; cursor: pointer; font: inherit; }
  .verdict button.on[data-v="good"] { background: #3bb273; color: #0e0c10; border-color: #3bb273; }
  .verdict button.on[data-v="bad"] { background: #c0392b; color: #f2efe6; border-color: #c0392b; }
  .verdict button.on[data-v="default"] { background: #e0b13a; color: #0e0c10; border-color: #e0b13a; }
  .verdict input { display: block; margin-top: 6px; width: 100%; min-width: 180px; background: #1e1a24; color: #f2efe6; border: 1px solid #c0392b; border-radius: 6px; padding: 5px 8px; font: inherit; }
  .verdict input[hidden] { display: none; }
  .bar { position: sticky; top: 0; background: #120f16; padding: 10px 0; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #332c3c; margin-bottom: 8px; }
  .bar button { background: #9b2d40; color: #f2efe6; border: 0; border-radius: 6px; padding: 7px 12px; cursor: pointer; font: inherit; }
  #count { color: #a39cab; }
</style></head><body><main>
<h1>Pronunciation check</h1>
<p>Each word as the voice reads it by default, then the respelling from <code>pronunciations.json</code>.
Mark each one: <b>✓</b> the fix is right, <b>✗</b> still wrong (say how it should sound), or <b>Default fine</b> to drop the fix.
Your answers are saved in this browser as you go.</p>
<div class="bar"><span id="count"></span><button id="copy">Copy feedback</button></div>
<table><tr><th>Word</th><th>Default</th><th>Respelling</th><th>Fixed</th><th>Verdict</th></tr>
${rows.join('\n')}
</table></main>
<script>
  // Verdicts are keyed by word + respelling, so changing a respelling asks for a fresh verdict.
  const KEY = 'pronunciationFeedback';
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
  const rows = [...document.querySelectorAll('tr[data-word]')];
  const id = (tr) => tr.dataset.word + '|' + tr.dataset.respelled;

  function paint(tr) {
    const f = store[id(tr)] || {};
    tr.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.verdict));
    const input = tr.querySelector('input');
    input.hidden = f.verdict !== 'bad';
    input.value = f.note || '';
  }

  function count() {
    const done = rows.filter((tr) => store[id(tr)]?.verdict).length;
    document.getElementById('count').textContent = done + ' of ' + rows.length + ' marked';
  }

  rows.forEach((tr) => {
    tr.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const f = store[id(tr)] || {};
      f.verdict = f.verdict === b.dataset.v ? undefined : b.dataset.v;
      store[id(tr)] = f;
      save(); paint(tr); count();
      if (f.verdict === 'bad') tr.querySelector('input').focus();
    }));
    tr.querySelector('input').addEventListener('input', (e) => {
      store[id(tr)] = { ...(store[id(tr)] || {}), note: e.target.value };
      save();
    });
    paint(tr);
  });
  count();

  // Plain-text summary, also readable straight off the page.
  window.pronunciationFeedback = () => rows
    .map((tr) => ({ word: tr.dataset.word, respelled: tr.dataset.respelled, ...(store[id(tr)] || {}) }))
    .filter((f) => f.verdict);

  document.getElementById('copy').addEventListener('click', async () => {
    const text = window.pronunciationFeedback()
      .map((f) => f.word + ' (' + f.respelled + '): ' + ({ good: 'OK', bad: 'WRONG', default: 'default was fine' })[f.verdict] + (f.note ? ' - ' + f.note : ''))
      .join('\\n');
    try { await navigator.clipboard.writeText(text); document.getElementById('copy').textContent = 'Copied!'; }
    catch { prompt('Copy this:', text); }
    setTimeout(() => (document.getElementById('copy').textContent = 'Copy feedback'), 1500);
  });
</script></body></html>
`,
  );
  console.log(`\n${entries.length} entries → http://localhost:5173/voice-samples/pronunciations/index.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
