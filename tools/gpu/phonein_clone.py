"""Voice a whole phone-in three ways and build a player to compare them.

  a  everything on Kokoro (what the pipeline does today)
  b  Isla, Fraser and Ross on Kokoro, the callers on Qwen clones
  c  everything on Qwen clones

Usage: python phonein_clone.py kokoro   (env with kokoro-onnx)
       python phonein_clone.py qwen     (env-qwen; callers first, so b is playable early)
       python phonein_clone.py assemble (any Python with ffmpeg on the path)
Reads .cache/phonein/phonein.json, writes .cache/phonein-clone/ (raw/, a/, b/, c/, index.html). Re-running skips clips already rendered.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PHONEIN = json.loads((ROOT / ".cache/phonein/phonein.json").read_text())
OUT = ROOT / ".cache/phonein-clone"
REFS = Path(__file__).parent / "bakeoff" / "refs"
MODELS = Path.home() / ".cache/heartsnews-gpu/models"

PHONE_FILTER = "highpass=f=350,lowpass=f=3200,acompressor=threshold=-18dB:ratio=4,volume=1.4"  # same as pipeline/src/voice.ts
HOST_KOKORO = {"isla": "bf_emma", "fraser": "bm_george", "ross": "bm_lewis"}  # channel.json
CALLER_KOKORO = {"m": ["am_adam", "bm_fable", "am_michael"], "f": ["bf_lily", "af_nicole", "af_sarah"]}  # CALLER_VOICES in phonein.ts
HOST_QWEN = {"isla": ("lisbeth", "icl"), "fraser": ("donald", "icl"), "ross": ("max", "icl")}
CALLER_QWEN = {0: ("ryan", "icl"), 1: ("margaret", "xvec"), 2: ("iain", "icl"), 3: ("bethany", "icl"), 4: ("bruce", "icl")}  # Davie, Senga, Kev, Morag, Big Tam


def callers_of(line: dict) -> int | None:
    return int(line["speaker"].split(":")[1]) if line["speaker"].startswith("caller:") else None


def raw(engine: str, i: int, line: dict) -> Path:
    return OUT / "raw" / engine / f"{i:02d}-{line['speaker'].replace(':', '')}.wav"


def kokoro() -> None:
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro

    ort.preload_dlls()
    session = ort.InferenceSession(str(MODELS / "kokoro-v1.0.onnx"), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(MODELS / "voices-v1.0.bin"))
    for i, line in enumerate(PHONEIN["lines"]):
        c = callers_of(line)
        if c is None:
            voice = HOST_KOKORO[line["speaker"]]
        else:
            sex = PHONEIN["callers"][c]["sex"]
            voice = CALLER_KOKORO[sex][[x["sex"] for x in PHONEIN["callers"][:c]].count(sex) % 3]
        path = raw("kokoro", i, line)
        path.parent.mkdir(parents=True, exist_ok=True)
        samples, rate = model.create(line["text"], voice=voice, speed=1.0, lang="en-gb")
        sf.write(path, samples, rate)
        print(f"kokoro {path.name} {voice}", flush=True)


def qwen() -> None:
    import soundfile as sf
    import torch
    from bakeoff import speak
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    prompts = {}

    def prompt(name: str, mode: str):
        if name not in prompts:
            words = REFS / f"{name}.txt"
            prompts[name] = model.create_voice_clone_prompt(ref_audio=str(REFS / f"{name}.wav"), ref_text=words.read_text().strip() if mode == "icl" else None, x_vector_only_mode=mode == "xvec")
        return prompts[name]

    lines = list(enumerate(PHONEIN["lines"]))
    # Callers first (they are in both b and c), then the hosts and pundits (c only).
    for i, line in sorted(lines, key=lambda x: callers_of(x[1]) is None):
        c = callers_of(line)
        name, mode = CALLER_QWEN[c] if c is not None else HOST_QWEN[line["speaker"]]
        path = raw("qwen", i, line)
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        t = time.time()
        wav, rate, attempts = speak(model, line["text"], prompt(name, mode))
        sf.write(path, wav, rate)
        print(f"qwen {path.name} {name} {time.time() - t:.0f}s, {len(wav) / rate:.1f}s of audio, {attempts} attempt(s)", flush=True)


def to_mp3(src: Path, dst: Path, phone: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), *(["-af", PHONE_FILTER] if phone else []), "-b:a", "96k", str(dst)]
    subprocess.run(cmd, check=True)


def assemble() -> None:
    rows = []
    for i, line in enumerate(PHONEIN["lines"]):
        c = callers_of(line)
        who = f"{PHONEIN['callers'][c]['name']} from {PHONEIN['callers'][c]['from']}" if c is not None else line["speaker"].title()
        row = {"who": who, "caller": c is not None, "text": line["text"]}
        for variant, engine in (("a", "kokoro"), ("b", "qwen" if c is not None else "kokoro"), ("c", "qwen")):
            src = raw(engine, i, line)
            if src.exists():
                dst = OUT / variant / f"{i:02d}.mp3"
                to_mp3(src, dst, phone=c is not None)
                row[variant] = f"{variant}/{dst.name}"
        rows.append(row)
    (OUT / "index.html").write_text(PAGE.replace("__ROWS__", json.dumps(rows)))
    print(f"{len(rows)} lines; player at {OUT / 'index.html'}")


PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Phone-in voices</title>
<style>body{font:16px system-ui;background:#1a0f14;color:#f2efe6;max-width:760px;margin:0 auto;padding:16px}h1{color:#e0b13a;font-size:20px}
button{background:#6d1a2a;color:#fff;border:1px solid #e0b13a;padding:10px 16px;border-radius:6px;font-size:15px;cursor:pointer;margin:0 6px 8px 0}
button.on{background:#e0b13a;color:#1a0f14}.l{padding:10px 12px;margin:8px 0;border-left:4px solid #555;border-radius:4px;background:#241820}.l.caller{border-color:#e0b13a;background:#33241a}
.l.now{outline:2px solid #fff}.w{font-weight:600;font-size:13px;opacity:.8}.l.caller .w:before{content:"📞 "}.x{margin-top:2px}</style>
<h1>HEARTS NEWS 24 - phone-in, three ways</h1>
<div><button data-v=a>A: all Kokoro (today)</button><button data-v=b>B: Kokoro hosts + Qwen callers</button><button data-v=c>C: all Qwen clones</button></div>
<button id=stop>Stop</button><div id=t></div>
<script>const R=__ROWS__;let v='a',i=-1,a;const t=document.getElementById('t');
R.forEach((r,n)=>{const d=document.createElement('div');d.className='l'+(r.caller?' caller':'');d.id='l'+n;d.innerHTML='<div class=w></div><div class=x></div>';d.children[0].textContent=r.who;d.children[1].textContent=r.text;d.onclick=()=>play(n);t.append(d)});
function play(n){a&&a.pause();document.querySelectorAll('.now').forEach(e=>e.classList.remove('now'));i=n;if(n>=R.length||!R[n][v]){i=-1;return}
document.getElementById('l'+n).classList.add('now');document.getElementById('l'+n).scrollIntoView({block:'center'});a=new Audio(R[n][v]);a.onended=()=>play(n+1);a.play().catch(e=>console.log(e))}
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{v=b.dataset.v;document.querySelectorAll('[data-v]').forEach(x=>x.classList.toggle('on',x===b));play(0)});
document.getElementById('stop').onclick=()=>{a&&a.pause();document.querySelectorAll('.now').forEach(e=>e.classList.remove('now'))}</script>"""

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    {"kokoro": kokoro, "qwen": qwen, "assemble": assemble}[sys.argv[1]]()
