"""Voice a whole bulletin with the approved Qwen clones, logging everything, and build a player.

Usage (WSL, env-qwen): python bulletin_clone.py [path/to/bulletin.json]     (default: site/public/bulletins/latest.json)
Reads the bulletin, never changes it. Writes .cache/bulletin-test/: audio/ (one mp3 per line), log.jsonl, results.js, index.html.
Phases, each timed: load model, render (the part that counts: voices in batches of 4, lines that run on are retried), encode mp3, QA (Whisper
checks each clip for a lead-in; not part of the render time).
Log lines are prefixed LOG, WARN or ERROR on stdout, and every event also goes to log.jsonl.
"""

import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
REFS = Path(__file__).parent / "bakeoff" / "refs"
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "site/public/bulletins/latest.json"
OUT = ROOT / ".cache/bulletin-test"
BATCH = 4
# speaker -> (reference clip in refs/, mode). "icl" sends the clip's words too, "xvec" the voice only.
VOICES = {
    "isla": ("lisbeth", "icl"), "fraser": ("donald", "icl"), "kirsty": ("zoe", "icl"), "ross": ("max", "icl"),
    "vo-fable": ("ben", "icl"), "vo-daniel": ("bruce", "icl"), "vo-lily": ("bethany", "icl"), "vo-alice": ("margaret", "xvec"),
}
T0 = time.time()
OUT.mkdir(parents=True, exist_ok=True)
LOG = open(OUT / "log.jsonl", "w")


def log(kind: str, **kw) -> None:
    LOG.write(json.dumps({"t": round(time.time() - T0, 1), "kind": kind, **kw}) + "\n")
    LOG.flush()
    tag = "ERROR" if kind.startswith("error") else "WARN" if kind.startswith("warn") else "LOG"
    print(f"{tag} [{time.time() - T0:6.1f}s] {kind} " + " ".join(f"{k}={v}" for k, v in kw.items()), flush=True)


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def pronouncer():
    """The same respelling the pipeline applies (pipeline/src/pronounce.ts): whole words, longest key first, accents ignored."""
    words = json.loads((ROOT / "pronunciations.json").read_text())["words"]
    table = {strip_accents(k): v for k, v in words.items()}
    keys = sorted(table, key=len, reverse=True)
    pattern = re.compile(r"(?<![\w-])(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])")
    return lambda text: pattern.sub(lambda m: table.get(m.group(1), m.group(1)), strip_accents(text))


def too_long(seconds: float, spoken: str) -> bool:
    """Speech runs about 14-16 characters a second; this much more than that means the line carried on past its end."""
    return seconds > len(spoken) / 9 + 1.5


def main() -> None:
    sys.path.insert(0, str(Path(__file__).parent))
    import torch
    from bakeoff import speak, trim_lead
    from faster_whisper import WhisperModel
    from qwen_tts import Qwen3TTSModel

    bulletin = json.loads(SRC.read_text())
    say = pronouncer()
    names = {p["id"]: p.get("name", p["id"]) for p in bulletin["presenters"]}
    jobs = []
    for seg in bulletin["segments"]:
        for line in seg["lines"]:
            jobs.append({"i": len(jobs), "segment": seg["id"], "speaker": line["speaker"], "who": names.get(line["speaker"], line["speaker"]), "text": line["text"], "spoken": say(line["text"])})
    (OUT / "wav").mkdir(exist_ok=True)
    missing = {j["speaker"] for j in jobs} - set(VOICES)
    log("start", source=SRC.name, lines=len(jobs), chars=sum(len(j["text"]) for j in jobs), speakers=len({j["speaker"] for j in jobs}), no_voice=sorted(missing) or "none")

    t = time.time()
    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    phases = {"load_model": time.time() - t}
    log("model_loaded", seconds=round(phases["load_model"], 1))

    render_started = time.time()
    done = 0
    for speaker in sorted(VOICES, key=lambda s: -sum(j["speaker"] == s for j in jobs)):
        mine = sorted((j for j in jobs if j["speaker"] == speaker), key=lambda j: len(j["spoken"]))
        if not mine:
            continue
        ref, mode = VOICES[speaker]
        words = (REFS / f"{ref}.txt").read_text().strip() if mode == "icl" else None
        t = time.time()
        prompt = model.create_voice_clone_prompt(ref_audio=str(REFS / f"{ref}.wav"), ref_text=words, x_vector_only_mode=mode == "xvec")
        log("voice", speaker=speaker, ref=ref, mode=mode, lines=len(mine), chars=sum(len(j["spoken"]) for j in mine), prompt_seconds=round(time.time() - t, 1))
        for b in range(0, len(mine), BATCH):
            batch = mine[b : b + BATCH]
            t = time.time()
            cap = int(1.3 * max(len(j["spoken"]) for j in batch)) + 30
            wavs, rate = None, 24000
            try:
                wavs, rate = model.generate_voice_clone(text=[j["spoken"] for j in batch], language="English", voice_clone_prompt=prompt * len(batch), max_new_tokens=cap)
            except Exception as err:  # noqa: BLE001 - log and fall back to one line at a time
                log("error_batch", speaker=speaker, lines=[j["i"] for j in batch], err=repr(err)[:160])
                torch.cuda.empty_cache()
            for n, j in enumerate(batch):
                w = wavs[n] if wavs is not None else None
                attempts, flags = 1, []
                if w is None or too_long(len(w) / rate, j["spoken"]):
                    log("warn_retry", line=j["i"], speaker=speaker, chars=len(j["spoken"]), seconds=round(len(w) / rate, 1) if w is not None else "none", why="no audio" if w is None else "ran on")
                    try:
                        w, rate, attempts = speak(model, j["spoken"], prompt)
                        attempts += 1
                    except Exception as err:  # noqa: BLE001
                        log("error_line", line=j["i"], err=repr(err)[:160])
                        j.update(failed=True, flags=["no audio"])
                        continue
                    flags.append(f"retried x{attempts - 1}")
                if too_long(len(w) / rate, j["spoken"]):
                    log("warn_still_long", line=j["i"], speaker=speaker, seconds=round(len(w) / rate, 1), chars=len(j["spoken"]))
                    flags.append("still too long")
                sf.write(OUT / "wav" / f"{j['i']:02d}.wav", w, rate)
                j.update(seconds=round(len(w) / rate, 1), attempts=attempts, flags=flags, ref=ref)
                done += 1
            took = time.time() - t
            log("batch", speaker=speaker, lines=[j["i"] for j in batch], chars=sum(len(j["spoken"]) for j in batch), seconds=round(took, 1), vram_mb=round(torch.cuda.max_memory_allocated() / 2**20), done=f"{done}/{len(jobs)}")
    phases["render"] = time.time() - render_started
    log("rendered", seconds=round(phases["render"], 1), lines=done, audio_seconds=round(sum(j.get("seconds", 0) for j in jobs), 1))

    t = time.time()
    (OUT / "audio").mkdir(exist_ok=True)
    for j in jobs:
        if not j.get("failed"):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(OUT / "wav" / f"{j['i']:02d}.wav"), "-b:a", "96k", str(OUT / "audio" / f"{j['i']:02d}.mp3")], check=True)
            j["file"] = f"audio/{j['i']:02d}.mp3"
    phases["encode"] = time.time() - t
    log("encoded", seconds=round(phases["encode"], 1))

    t = time.time()
    asr = WhisperModel("small", device="cpu", compute_type="int8")
    for j in jobs:
        if j.get("failed"):
            continue
        w, rate = sf.read(OUT / "wav" / f"{j['i']:02d}.wav")
        mono = np.interp(np.linspace(0, len(w), int(len(w) * 16000 / rate), endpoint=False), np.arange(len(w)), w).astype("float32")
        segs, _ = asr.transcribe(mono[: 16000 * 4], language="en", vad_filter=False, condition_on_previous_text=False)
        j["heard"] = " ".join(s.text.strip() for s in segs)
        ref_words = (REFS / f"{j['ref']}.txt").read_text() if VOICES[j["speaker"]][1] == "icl" else ""
        j["cut"] = round((len(w) - len(trim_lead(w, rate, j["spoken"], ref_words))) / rate, 2)
        if j["cut"] > 0.3:
            j["flags"].append(f"lead-in {j['cut']}s")
            log("warn_lead_in", line=j["i"], speaker=j["speaker"], cut=j["cut"], heard=j["heard"][:60])
    phases["qa"] = time.time() - t
    log("qa_done", seconds=round(phases["qa"], 1), flagged=sum(1 for j in jobs if j.get("flags")))

    audio = sum(j.get("seconds", 0) for j in jobs)
    by = {}
    for j in jobs:
        s = by.setdefault(j["speaker"], {"lines": 0, "chars": 0, "audio": 0.0, "flagged": 0})
        s["lines"] += 1
        s["chars"] += len(j["spoken"])
        s["audio"] = round(s["audio"] + j.get("seconds", 0), 1)
        s["flagged"] += bool(j.get("flags"))
    summary = {"lines": len(jobs), "chars": sum(len(j["text"]) for j in jobs), "audio_seconds": round(audio, 1), "phases": {k: round(v, 1) for k, v in phases.items()},
               "total_seconds": round(time.time() - T0, 1), "build_seconds": round(phases["load_model"] + phases["render"] + phases["encode"], 1),
               "realtime_factor": round(phases["render"] / audio, 2), "retried": sum(1 for j in jobs if j.get("attempts", 1) > 1), "failed": sum(1 for j in jobs if j.get("failed")),
               "flagged": sum(1 for j in jobs if j.get("flags")), "by_speaker": by, "no_voice": sorted(missing)}
    (OUT / "results.js").write_text("window.BT = " + json.dumps({"summary": summary, "jobs": jobs}) + ";\n")
    (OUT / "index.html").write_text(PAGE)
    log("summary", **{k: v for k, v in summary.items() if k != "by_speaker"})
    print("DONE", flush=True)


PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Bulletin test</title>
<style>body{font:15px system-ui;background:#1a0f14;color:#f2efe6;max-width:800px;margin:1rem auto;padding:0 1rem}h1{color:#e0b13a}h2{color:#e0b13a;font-size:15px;margin:1.4rem 0 .3rem;text-transform:uppercase;letter-spacing:.05em}
button{background:#6d1a2a;color:#fff;border:1px solid #e0b13a;padding:9px 16px;border-radius:6px;font-size:15px;cursor:pointer;margin-right:6px}
.l{padding:8px 12px;margin:6px 0;border-left:4px solid #555;border-radius:4px;background:#241820}.l.flag{border-color:#ff9f43}.l.now{outline:2px solid #fff}.w{font-weight:600;font-size:12px;opacity:.8}
.f{color:#ff9f43;font-size:12px}.s{font-size:12px;opacity:.6}table{border-collapse:collapse;margin:.5rem 0}td,th{padding:3px 10px;text-align:right;border-bottom:1px solid #3a2a33}th:first-child,td:first-child{text-align:left}
audio{width:100%;height:30px;margin-top:4px}</style>
<h1>Whole bulletin, voiced with the approved clones</h1><div id=sum></div>
<button id=play>Play all</button><button id=stop>Stop</button><div id=app></div>
<script>document.write('<script src="results.js?t='+Date.now()+'"><\\/script>')</script>
<script>const D=window.BT,S=D.summary,m=x=>`${Math.floor(x/60)}m ${Math.round(x%60)}s`;
let h=`<p>${S.lines} lines, ${S.chars} characters, ${m(S.audio_seconds)} of speech.<br><b>Build (load + render + encode): ${m(S.build_seconds)}</b> (render alone ${m(S.phases.render)}, ${S.realtime_factor}x real time). Retried lines: ${S.retried}. Failed: ${S.failed}. Flagged: ${S.flagged}.<br>Whisper check afterwards: ${m(S.phases.qa)}, not part of the build.</p><table><tr><th>speaker</th><th>lines</th><th>chars</th><th>speech</th><th>flagged</th></tr>`;
for(const [k,v] of Object.entries(S.by_speaker))h+=`<tr><td>${k}</td><td>${v.lines}</td><td>${v.chars}</td><td>${v.audio}s</td><td>${v.flagged}</td></tr>`;
document.getElementById('sum').innerHTML=h+'</table>';
const app=document.getElementById('app');let seg='';
D.jobs.forEach((j,i)=>{if(j.segment!==seg){seg=j.segment;const e=document.createElement('h2');e.textContent=seg;app.append(e)}
const d=document.createElement('div');d.className='l'+(j.flags&&j.flags.length?' flag':'');d.id='l'+i;
d.innerHTML='<div class=w></div><div class=x></div><div class=s></div>'+(j.file?`<audio controls preload=none src="${j.file}"></audio>`:'<div class=f>NO AUDIO</div>');
d.children[0].textContent=j.who+' ('+j.speaker+' = '+(j.ref||'-')+')';d.children[1].textContent=j.text;
d.children[2].innerHTML=(j.seconds?j.seconds+'s':'')+(j.flags&&j.flags.length?` <span class=f>${j.flags.join(', ')}</span>`:'')+(j.heard?` &middot; Whisper: ${j.heard.replace(/</g,'&lt;')}`:'');app.append(d)});
let i=-1,a;function go(n){a&&a.pause();document.querySelectorAll('.now').forEach(e=>e.classList.remove('now'));i=n;while(n<D.jobs.length&&!D.jobs[n].file)n++;if(n>=D.jobs.length)return;
const e=document.getElementById('l'+n);e.classList.add('now');e.scrollIntoView({block:'center'});a=new Audio(D.jobs[n].file);a.onended=()=>go(n+1);a.play()}
document.getElementById('play').onclick=()=>go(0);document.getElementById('stop').onclick=()=>{a&&a.pause()}</script>"""

if __name__ == "__main__":
    main()
