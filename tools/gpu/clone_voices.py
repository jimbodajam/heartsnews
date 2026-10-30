"""Render lines in cloned voices on the GPU (Qwen3-TTS clone mode). Called by pipeline/src/voice.ts.

Reads a JSON list of {"text", "ref", "voiceOnly", "out"} from stdin and writes each clip as a WAV at "out".
Reference clips live in ~/.cache/heartsnews-gpu/voices (override with HEARTSNEWS_VOICES): <ref>.wav, plus <ref>.txt holding the exact words
spoken in it unless "voiceOnly" is set. Set up with tools/gpu/clone-setup.sh.

Lines are grouped by voice and rendered four at a time, shortest first. Sampling is random and now and then a line doesn't finish, so every
line has a length cap and a "ran on" check, and is retried on its own. A line that still fails is NOT written: the caller falls back to Kokoro for
it, which is better than broadcasting a runaway.
Progress and warnings go to stderr with a [clone] prefix, one line per batch and a summary at the end.
"""

import json
import os
import sys
import time
from pathlib import Path

REFS = Path(os.environ.get("HEARTSNEWS_VOICES", Path.home() / ".cache/heartsnews-gpu/voices"))
BATCH = 4
TRIES = 3  # single-line attempts after a batch comes back wrong


def log(msg: str) -> None:
    print(f"[clone] {msg}", file=sys.stderr, flush=True)


def too_long(seconds: float, text: str) -> bool:
    """Speech runs about 14-17 characters a second; this much more than that means the line carried on past its end."""
    return seconds > len(text) / 9 + 1.5


def cap(text_len: int) -> int:
    """Token ceiling for a line: speech needs about 0.75 tokens a character at 12 a second. The model's own ceiling is 2048."""
    return int(1.3 * text_len) + 30


def main() -> None:
    jobs = json.load(sys.stdin)
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    started = time.time()
    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa")
    log(f"{len(jobs)} lines, {sum(len(j['text']) for j in jobs)} characters; model loaded in {time.time() - started:.0f}s")

    groups: dict[tuple[str, bool], list[dict]] = {}
    for j in jobs:
        groups.setdefault((j["ref"], bool(j.get("voiceOnly"))), []).append(j)

    done = retried = failed = 0
    for (ref, voice_only), items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        wav_file, words_file = REFS / f"{ref}.wav", REFS / f"{ref}.txt"
        if not wav_file.exists() or (not voice_only and not words_file.exists()):
            log(f"WARN no reference clip for '{ref}' in {REFS}: {len(items)} lines left to Kokoro")
            failed += len(items)
            continue
        prompt = model.create_voice_clone_prompt(ref_audio=str(wav_file), ref_text=None if voice_only else words_file.read_text().strip(), x_vector_only_mode=voice_only)
        items.sort(key=lambda j: len(j["text"]))
        for b in range(0, len(items), BATCH):
            batch = items[b : b + BATCH]
            t = time.time()
            wavs, rate = None, 24000
            try:
                wavs, rate = model.generate_voice_clone(text=[j["text"] for j in batch], language="English", voice_clone_prompt=prompt * len(batch), max_new_tokens=cap(max(len(j["text"]) for j in batch)))
            except Exception as err:  # noqa: BLE001 - one line at a time instead
                log(f"WARN batch of {len(batch)} for '{ref}' failed ({err!r:.120}), going line by line")
                torch.cuda.empty_cache()
            for n, j in enumerate(batch):
                wav = wavs[n] if wavs is not None else None
                if wav is None or too_long(len(wav) / rate, j["text"]):
                    why = "no audio" if wav is None else f"ran on ({len(wav) / rate:.0f}s for {len(j['text'])} characters)"
                    wav = None
                    for attempt in range(1, TRIES + 1):
                        try:
                            out, rate = model.generate_voice_clone(text=j["text"], language="English", voice_clone_prompt=prompt, max_new_tokens=cap(len(j["text"])))
                        except Exception as err:  # noqa: BLE001
                            log(f"WARN '{ref}' retry {attempt} failed ({err!r:.100})")
                            torch.cuda.empty_cache()
                            continue
                        if not too_long(len(out[0]) / rate, j["text"]):
                            wav = out[0]
                            break
                    retried += 1
                    log(f"WARN '{ref}' line {why}; " + ("fixed on retry" if wav is not None else f"gave up after {TRIES} tries, left to Kokoro") + f": {j['text'][:50]!r}")
                if wav is None:
                    failed += 1
                    continue
                Path(j["out"]).parent.mkdir(parents=True, exist_ok=True)
                sf.write(j["out"], wav, rate)
                done += 1
            torch.cuda.empty_cache()  # keeps the allocator from hoarding memory across batches
            log(f"{ref}: {len(batch)} lines, {sum(len(j['text']) for j in batch)} characters in {time.time() - t:.0f}s ({done}/{len(jobs)} done)")
    log(f"finished: {done} clips, {retried} needed a retry, {failed} left to Kokoro, {time.time() - started:.0f}s in all")


if __name__ == "__main__":
    main()
