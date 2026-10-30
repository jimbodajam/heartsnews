"""Approve voices one at a time: the same four lines through each reference clip, on a page with Approve / Reject buttons.

Usage (WSL, env-qwen): python voice_approval.py [voice ...]   (default: every voice below, in this order)
Reads refs/<name>.wav (+ .txt, sent with the clip in transcript mode), writes .cache/phonein-clone/voices-test/ (clips, results.js, index.html).
The page fills in as each voice finishes. Ben's approved clip is listed first, from ben-test/.
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
REFS = Path(__file__).parent / "bakeoff" / "refs"
OUT = ROOT / ".cache/phonein-clone/voices-test"
# (clip, mode, what it is for). "icl" sends the clip's words too, "xvec" the voice only. Callers first.
VOICES = [
    ("ryan", "icl", "Davie, caller 0"),
    ("bruce", "icl", "Big Tam, caller 4"),
    ("iain", "icl", "Kev, caller 2"),
    ("bethany", "icl", "Morag, caller 3"),
    ("lisbeth", "icl", "Isla (recut)"),
    ("donald", "icl", "Fraser (recut)"),
    ("max", "icl", "Ross"),
    ("zoe", "icl", "Kirsty"),
    ("margaret", "xvec", "Senga, caller 1 (voice only)"),
    ("robert", "xvec", "spare caller (voice only)"),
]


def prompts() -> list[tuple[str, str]]:
    bank = {l["id"]: l["text"] for l in json.loads((REFS.parent / "lines.json").read_text())}
    davie = json.loads((ROOT / ".cache/phonein/phonein.json").read_text())["lines"][1]["text"]
    return [("calm headline", bank["isla-headline"]), ("excited goal", bank["gregor-goal"]), ("grumble", bank["fraser-grumble"]), ("angry caller", davie)]


def write(results: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.js").write_text("window.VOICES = " + json.dumps(results) + ";\n")
    (OUT / "index.html").write_text(PAGE)


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent))
    import torch
    from bakeoff import speak, trim_lead
    from faster_whisper import WhisperModel
    from qwen_tts import Qwen3TTSModel

    only = sys.argv[1:]
    texts = prompts()
    ben_words = (REFS / "ben.txt").read_text().strip()
    results: list[dict] = [
        {
            "name": "ben", "role": "approved caller voice", "mode": "icl", "approved": True, "ref": "../refs/ben.wav", "words": ben_words,
            "clips": [{"label": label, "text": text, "file": f"../ben-test/ben-{i}.wav", "heard": "", "cut": 0} for i, (label, text) in enumerate(texts, 1)],
        }
    ]
    write(results)
    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    asr = WhisperModel("small", device="cpu", compute_type="int8")
    for name, mode, role in VOICES:
        if only and name not in only:
            continue
        ref, words_file = REFS / f"{name}.wav", REFS / f"{name}.txt"
        if not ref.exists() or (mode == "icl" and not words_file.exists()):
            continue
        words = words_file.read_text().strip() if words_file.exists() else ""
        prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=words if mode == "icl" else None, x_vector_only_mode=mode == "xvec")
        (OUT / "refs").mkdir(parents=True, exist_ok=True)
        (OUT / "refs" / f"{name}.wav").write_bytes(ref.read_bytes())
        entry = {"name": name, "role": role, "mode": mode, "ref": f"refs/{name}.wav", "words": words if mode == "icl" else "", "clips": []}
        started = time.time()
        for i, (label, text) in enumerate(texts, 1):
            wav, rate, attempts = speak(model, text, prompt)
            (OUT / name).mkdir(parents=True, exist_ok=True)
            sf.write(OUT / name / f"{i}.wav", wav, rate)
            mono = np.interp(np.linspace(0, len(wav), int(len(wav) * 16000 / rate), endpoint=False), np.arange(len(wav)), wav).astype("float32")
            heard = " ".join(s.text.strip() for s in asr.transcribe(mono[: 16000 * 3], language="en", vad_filter=False, condition_on_previous_text=False)[0])
            cut = (len(wav) - len(trim_lead(wav, rate, text, words))) / rate if mode == "icl" else 0.0
            entry["clips"].append({"label": label, "text": text, "file": f"{name}/{i}.wav", "seconds": round(len(wav) / rate, 1), "attempts": attempts, "heard": heard, "cut": round(cut, 2)})
        results.append(entry)
        write(results)
        print(f"DONE {name} ({time.time() - started:.0f}s): " + ", ".join(f"{c['seconds']}s" + (f" cut {c['cut']}" if c["cut"] > 0.15 else "") for c in entry["clips"]), flush=True)


PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Voice approval</title>
<style>body{font:15px system-ui;background:#1a0f14;color:#f2efe6;max-width:780px;margin:1rem auto;padding:0 1rem}h1{color:#e0b13a}
section{border:1px solid #4a3340;border-radius:8px;padding:.8rem 1rem;margin:1rem 0;background:#201319}section.ok{border-color:#3fa46a}section.no{border-color:#c0475a}
h2{margin:.1rem 0}small{opacity:.7;font-weight:400;font-size:13px}audio{width:100%}.k{margin-top:.6rem;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#e0b13a}
.t{padding:.4rem .6rem;background:#241820;border-left:3px solid #e0b13a;font-size:14px}.c{margin:.6rem 0}.h{font-size:12px;opacity:.65}.w{color:#ffb86b}
button{background:#33241a;color:#fff;border:1px solid #e0b13a;padding:8px 16px;border-radius:6px;font-size:15px;cursor:pointer;margin-right:8px}button.on.a{background:#2f7d52}button.on.r{background:#a63a4c}
pre{background:#241820;padding:.7rem;white-space:pre-wrap}</style>
<h1>Voice approval</h1><p>The same four lines through each reference clip. Approve or reject each voice. The page fills in as voices finish, so reload for new ones.</p>
<div id=app></div><p><button id=copy>Copy my verdicts</button></p><pre id=sum></pre>
<script>document.write('<script src="results.js?t='+Date.now()+'"><\\/script>')</script>
<script>
const V=window.VOICES||[];let st={};try{st=JSON.parse(localStorage.getItem('voice-approval')||'{}')}catch(e){}
const app=document.getElementById('app');
function save(){try{localStorage.setItem('voice-approval',JSON.stringify(st))}catch(e){}}
function verdict(v){return v.approved?'a':st[v.name]}
V.forEach(v=>{const s=document.createElement('section');s.id='s-'+v.name;
 s.innerHTML=`<h2>${v.name} <small>${v.mode==='icl'?'transcript + voice':'voice only'} - ${v.role}</small></h2>
 <div class=k>Clip sent in</div><audio controls preload=none src="${v.ref}"></audio>
 ${v.words?`<div class=k>Words sent with it</div><div class=t></div>`:`<div class=k>No words sent (voice only)</div>`}
 ${v.clips.map((c,i)=>`<div class=c><div class=k>${i+1}. ${c.label}${c.seconds?` <span class=h>${c.seconds}s${c.attempts>1?`, ${c.attempts} tries`:''}${c.cut>0.15?` <span class=w>(lead-in of ${c.cut}s detected)</span>`:''}</span>`:''}</div>
 <audio controls preload=none src="${c.file}"></audio><div class=h>${c.heard?'Whisper hears: '+c.heard.replace(/</g,'&lt;'):''}</div></div>`).join('')}
 <div>${v.approved?'<b>Approved</b> (you approved this one)':'<button class=a>Approve</button><button class=r>Reject</button>'}</div>`;
 if(v.words)s.querySelector('.t').textContent=v.words;
 if(!v.approved){s.querySelector('.a').onclick=()=>{st[v.name]='a';save();paint()};s.querySelector('.r').onclick=()=>{st[v.name]='r';save();paint()}}
 app.append(s)});
function paint(){V.forEach(v=>{const s=document.getElementById('s-'+v.name),x=verdict(v);s.className=x==='a'?'ok':x==='r'?'no':'';
 if(!v.approved){s.querySelector('.a').classList.toggle('on',x==='a');s.querySelector('.r').classList.toggle('on',x==='r')}});
 document.getElementById('sum').textContent=V.map(v=>v.name.padEnd(10)+({a:'APPROVED',r:'REJECTED'}[verdict(v)]||'-')).join('\\n')}
paint();document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(document.getElementById('sum').textContent);
</script>"""

if __name__ == "__main__":
    main()
