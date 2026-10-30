"""How fast can Qwen3-TTS clone mode voice a real bulletin? Build the voice prompt once, then render lines in batches.

Usage (WSL, env-qwen): python qwen_speed.py [lines] [batch sizes...]   e.g. python qwen_speed.py 16 4 8 16
Takes the first N lines of site/public/bulletins/latest.json (shortest-first within a batch, so padding is small),
voices them all with refs/fraser.wav, and reports seconds per line and peak VRAM for each batch size.
"""

import json
import sys
import time
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ROOT = Path(__file__).parents[2]
REFS = Path(__file__).parent / "bakeoff" / "refs"
OUT = Path(__file__).parent / "bakeoff" / "out" / "speed"

n = int(sys.argv[1]) if len(sys.argv) > 1 else 16
sizes = [int(x) for x in sys.argv[2:]] or [4, 8, 16]

bulletin = json.loads((ROOT / "site/public/bulletins/latest.json").read_text())
texts = [line["text"] for seg in bulletin["segments"] for line in seg["lines"]][:n]
print(f"{len(texts)} lines, {sum(map(len, texts))} chars", flush=True)

model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
prompt = model.create_voice_clone_prompt(ref_audio=str(REFS / "fraser.wav"), ref_text=(REFS / "fraser.txt").read_text().strip())
ordered = sorted(texts, key=len)

for size in sizes:
    torch.cuda.reset_peak_memory_stats()
    started = time.time()
    audio = 0.0
    for i in range(0, len(ordered), size):
        batch = ordered[i : i + size]
        wavs, rate = model.generate_voice_clone(text=batch, language="English", voice_clone_prompt=prompt * len(batch),
                                          # A line that never emits its end marker would otherwise run the whole batch to the model's ceiling.
                                          max_new_tokens=2 * max(map(len, batch)) + 50)
        audio += sum(len(w) for w in wavs) / rate
        print(f"  batch {size}: {min(i + size, len(ordered))}/{len(ordered)} lines, {time.time() - started:.0f}s so far", flush=True)
        if i == 0 and size == sizes[0]:
            OUT.mkdir(parents=True, exist_ok=True)
            sf.write(OUT / "sample.wav", wavs[0], rate)
    took = time.time() - started
    print(f"batch {size:>2}: {took:5.1f}s for {len(ordered)} lines = {took / len(ordered):4.1f}s/line, {audio:.0f}s of speech ({took / audio:.1f}x real time), peak {torch.cuda.max_memory_allocated() / 2**20:.0f} MB", flush=True)
