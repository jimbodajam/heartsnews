"""Voice bake-off: render the lines in bakeoff/lines.json with one engine and record speed and VRAM.

Usage (inside WSL, with that engine's environment): python bakeoff.py kokoro|qwen|chatterbox
Writes bakeoff/out/<engine>/<id>.wav and merges timings into bakeoff/out/results.json and results.js,
which bakeoff/index.html reads. Reference clips in bakeoff/refs/ (<who>.wav, 5-15 s of someone who agreed)
are cloned by Chatterbox; otherwise it clones the Qwen-designed clip for that persona, if there is one.
"""

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent / "bakeoff"
OUT = HERE / "out"
LINES = json.loads((HERE / "lines.json").read_text())
# Which clip in refs/ voices which presenter in qwen-clone, and whether it also uses the clip's transcript.
CLONES = [("fraser", "bruce", "icl"), ("isla", "lisbeth", "icl"),("ross", "max", "icl"),("gregor", "donald", "icl"), ("caller", "ryan", "icl"), ("caller2", "iain", "icl"),("isla", "margaret", "xvec"), ("kirsty", "bethany", "icl")]
MODELS = Path.home() / ".cache/heartsnews-gpu/models"


def peak_vram_mb() -> float | None:
    try:
        import torch

        return round(torch.cuda.max_memory_allocated() / 2**20)
    except Exception:
        return None


def record(engine: str, variant: str, line: dict, seconds: float, path: Path, vram: float | None, note: str = "") -> None:
    results_file = OUT / "results.json"
    results = json.loads(results_file.read_text()) if results_file.exists() else {"lines": LINES, "clips": []}
    results["lines"] = LINES
    results["clips"] = [c for c in results["clips"] if not (c["engine"] == engine and c["variant"] == variant and c["line"] == line["id"])]
    results["clips"].append({"engine": engine, "variant": variant, "line": line["id"], "file": str(path.relative_to(HERE)).replace("\\", "/"), "seconds": round(seconds, 1), "vram_mb": vram, "note": note})
    results_file.write_text(json.dumps(results, indent=2))
    (OUT / "results.js").write_text("window.BAKEOFF = " + json.dumps(results) + ";\n")


def kokoro() -> None:
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro

    ort.preload_dlls()
    session = ort.InferenceSession(str(MODELS / "kokoro-v1.0.onnx"), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(MODELS / "voices-v1.0.bin"))
    for line in LINES:
        t = time.time()
        samples, rate = model.create(line["text"], voice=line["kokoro"], speed=line.get("speed", 1.0), lang="en-gb")
        path = OUT / "kokoro" / f"{line['id']}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(path, samples, rate)
        record("kokoro", line["kokoro"], line, time.time() - t, path, None, "current voice")
        print(f"kokoro {line['id']} {time.time() - t:.1f}s", flush=True)


def qwen() -> None:
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    # Turing (2080 Ti) has no FlashAttention 2, so use PyTorch's built-in attention in half precision.
    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    for line in LINES:
        t = time.time()
        wavs, rate = model.generate_voice_design(text=line["text"], language="English", instruct=line["design"])
        path = OUT / "qwen" / f"{line['id']}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(path, wavs[0], rate)
        record("qwen", "voice-design", line, time.time() - t, path, peak_vram_mb(), line["design"])
        print(f"qwen {line['id']} {time.time() - t:.1f}s", flush=True)


def qwen_clone() -> None:
    """Qwen3-TTS voice cloning from the clips in refs/. "icl" also reads refs/<ref>.txt (the exact words spoken); "xvec" uses the voice alone."""
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    prompts = {}  # each reference is analysed once, then reused for every line in that voice
    only = sys.argv[2:]  # optionally just these presenters, e.g. `bakeoff.py qwen-clone ross`
    for line in LINES:
        for who, ref_name, mode in CLONES:
            if only and who not in only:
                continue
            ref, words = HERE / "refs" / f"{ref_name}.wav", HERE / "refs" / f"{ref_name}.txt"
            if who != line["who"] or not ref.exists() or (mode == "icl" and not words.exists()):
                continue
            if (ref_name, mode) not in prompts:
                prompts[ref_name, mode] = model.create_voice_clone_prompt(
                    ref_audio=str(ref), ref_text=words.read_text().strip() if mode == "icl" else None, x_vector_only_mode=mode == "xvec")
            variant = "clone-ref" if mode == "icl" else "clone-voiceonly"
            t = time.time()
            # The length cap stops a line that never ends from running the whole render to the model's ceiling.
            wavs, rate = model.generate_voice_clone(text=line["text"], language="English", voice_clone_prompt=prompts[ref_name, mode], max_new_tokens=2 * len(line["text"]) + 50)
            path = OUT / f"qwen-{variant}" / f"{line['id']}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(path, wavs[0], rate)
            record("qwen", variant, line, time.time() - t, path, peak_vram_mb(), f"reference: {ref.name}")
            print(f"qwen/{variant} {line['id']} ({ref_name}) {time.time() - t:.1f}s, {len(wavs[0]) / rate:.1f}s of audio", flush=True)


_asr = None


def trim_lead(wav, rate: int, text: str, ref_text: str = "", margin: float = 0.05):
    """Cut what the model says before the line itself.

    In clone mode the output often begins with the tail of the reference clip ("tssh", or its last words repeated). Whisper
    times each word. Two ways to find the end of that lead-in, tried in turn: the line's own first two words, or the reference's
    last words turning up at the start of the output (they survive a misheard first word). If neither is found, the clip is left alone.
    """
    global _asr
    import difflib
    import re

    import numpy as np
    from faster_whisper import WhisperModel

    _asr = _asr or WhisperModel("small", device="cpu", compute_type="int8")
    norm = lambda s: re.sub(r"[^a-z0-9']", "", s.lower())  # noqa: E731
    want = [norm(w) for w in text.split()[:2]]
    mono = np.interp(np.linspace(0, len(wav), int(len(wav) * 16000 / rate), endpoint=False), np.arange(len(wav)), wav).astype("float32")
    segs, _ = _asr.transcribe(mono[: 16000 * 6], language="en", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    words = [(norm(w.word), w.start, w.end) for s in segs for w in s.words]
    close = lambda a, b: difflib.SequenceMatcher(None, a, b).ratio() >= 0.7  # noqa: E731

    def cut_at(start: float):
        if start < 0.04:
            return wav  # nothing to cut
        out = wav[int(start * rate) :].copy()
        fade = int(0.015 * rate)
        out[:fade] *= np.linspace(0, 1, fade)
        return out

    for i in range(len(words) - len(want) + 1):
        if all(close(words[i + k][0], want[k]) for k in range(len(want))):
            return cut_at(words[i][1] - margin)
    # The reference's last words, repeated at the start (the longest run wins; one stray word before them is allowed).
    tail = [norm(w) for w in ref_text.split()][-6:]
    for k in range(len(tail), 0, -1):
        for skip in (0, 1):
            head = words[skip : skip + k]
            if len(head) == k and sum(close(h[0], t) for h, t in zip(head, tail[-k:])) >= max(1, round(0.7 * k)):
                end = head[-1][2]
                nxt = words[skip + k][1] if len(words) > skip + k else end
                return cut_at((end + nxt) / 2)
    return wav


def speak(model, text: str, prompt, tries: int = 4):
    """Clone-voice a line, retrying when it doesn't finish: sampling is random and now and then a line runs on to the token cap.

    Speech needs about 0.75 tokens per character at 12 tokens a second, so a cap of 1.3 per character leaves room without a runaway costing minutes.
    """
    cap = int(1.3 * len(text)) + 30
    for attempt in range(1, tries + 1):
        wavs, rate = model.generate_voice_clone(text=text, language="English", voice_clone_prompt=prompt, max_new_tokens=cap)
        if len(wavs[0]) / rate < 0.95 * cap / 12:  # stopped by itself, not by the cap
            return wavs[0], rate, attempt
        print(f"  attempt {attempt} hit the cap ({len(wavs[0]) / rate:.0f}s of audio), retrying", flush=True)
    return wavs[0], rate, tries


# The final comparison: every voice reads the same lines, so voices can be judged on identical text.
SHARED = ["isla-headline", "gregor-goal", "fraser-grumble"]
KOKORO_VOICES = ["bf_emma", "bf_isabella", "bm_george", "bm_lewis", "bm_daniel", "bm_fable"]
# (reference clip, mode): "icl" also reads refs/<clip>.txt, "xvec" uses the voice alone.
VOICES = [("bruce", "icl"), ("donald", "icl"), ("max", "icl"), ("ryan", "icl"), ("iain", "icl"), ("iain-voiceonly", "xvec"), ("lisbeth", "icl"), ("bethany", "icl"), ("zoe", "icl"), ("margaret", "xvec"), ("robert", "xvec")]


def kokoro_voices() -> None:
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro

    ort.preload_dlls()
    session = ort.InferenceSession(str(MODELS / "kokoro-v1.0.onnx"), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(MODELS / "voices-v1.0.bin"))
    for voice in KOKORO_VOICES:
        for line in (l for l in LINES if l["id"] in SHARED):
            t = time.time()
            samples, rate = model.create(line["text"], voice=voice, speed=1.0, lang="en-gb")
            path = OUT / "kokoro-voices" / voice / f"{line['id']}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(path, samples, rate)
            record("kokoro", voice, line, time.time() - t, path, None)
            print(f"kokoro {voice} {line['id']} {time.time() - t:.1f}s", flush=True)


def qwen_voices() -> None:
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    only = sys.argv[2:]  # optionally just these voices, e.g. `bakeoff.py qwen-voices iain zoe`
    for name, mode in VOICES:
        if only and name not in only:
            continue
        ref = HERE / "refs" / f"{name.removesuffix('-voiceonly')}.wav"
        words = HERE / "refs" / f"{name.removesuffix('-voiceonly')}.txt"
        if not ref.exists() or (mode == "icl" and not words.exists()):
            continue
        prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=words.read_text().strip() if mode == "icl" else None, x_vector_only_mode=mode == "xvec")
        for line in (l for l in LINES if l["id"] in SHARED):
            t = time.time()
            wav, rate, attempts = speak(model, line["text"], prompt)
            path = OUT / "qwen-voices" / name / f"{line['id']}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(path, wav, rate)
            record("qwen", name, line, time.time() - t, path, peak_vram_mb(), f"{mode}, {len(wav) / rate:.1f}s of audio" + (f", {attempts} attempts" if attempts > 1 else ""))
            print(f"qwen {name} {line['id']} {time.time() - t:.1f}s, {len(wav) / rate:.1f}s of audio, {attempts} attempt(s)", flush=True)


def chatterbox() -> None:
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    model = ChatterboxTTS.from_pretrained(device="cuda")
    for line in LINES:
        refs = [("default", None)]
        mine, designed = HERE / "refs" / f"{line['who']}.wav", OUT / "qwen" / f"{line['id']}.wav"
        if mine.exists():
            refs.append(("clone-ref", mine))
        elif designed.exists():
            refs.append(("clone-qwen", designed))
        if mine.exists():
            refs.append(("clone-ref-lowcfg", mine))  # less guidance pulls less toward its default American delivery
        for variant, ref in refs:
            t = time.time()
            low = variant.endswith("lowcfg")
            wav = model.generate(line["text"], audio_prompt_path=str(ref) if ref else None, exaggeration=0.5 if low else 0.6, cfg_weight=0.1 if low else 0.4)  # exactly 0 crashes the CFG batching
            path = OUT / f"chatterbox-{variant}" / f"{line['id']}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            ta.save(str(path), wav.cpu(), model.sr)
            record("chatterbox", variant, line, time.time() - t, path, peak_vram_mb(), f"reference: {ref.name}" if ref else "")
            print(f"chatterbox/{variant} {line['id']} {time.time() - t:.1f}s", flush=True)


if __name__ == "__main__":
    {"kokoro": kokoro, "kokoro-voices": kokoro_voices, "qwen": qwen, "qwen-clone": qwen_clone, "qwen-voices": qwen_voices, "chatterbox": chatterbox}[sys.argv[1]]()
