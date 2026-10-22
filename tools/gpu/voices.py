"""Render a batch of Kokoro voice clips on the GPU.

Reads a JSON list of {"text", "voice", "speed", "out"} from stdin and writes each clip as a WAV file at "out".
Called by pipeline/src/voice.ts when GPU voices are available (see tools/gpu/setup.sh).
"""

import json
import sys
import time
from pathlib import Path

import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = Path.home() / ".cache/heartsnews-gpu/models"


def main() -> None:
    jobs = json.load(sys.stdin)
    # The CUDA and cuDNN libraries come from pip packages, which the system loader doesn't search; load them first.
    ort.preload_dlls()
    options = ort.SessionOptions()
    options.log_severity_level = 3  # errors only; the graph-optimisation warnings are harmless
    session = ort.InferenceSession(
        str(MODELS / "kokoro-v1.0.onnx"),
        sess_options=options,
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    provider = session.get_providers()[0]
    kokoro = Kokoro.from_session(session, str(MODELS / "voices-v1.0.bin"))
    print(f"Kokoro on {provider}", file=sys.stderr, flush=True)

    for job in jobs:
        started = time.time()
        samples, rate = kokoro.create(job["text"], voice=job["voice"], speed=job.get("speed", 1.0), lang="en-gb")
        sf.write(job["out"], samples, rate)
        print(f"  {time.time() - started:4.1f}s  {job['voice']:<12} {job['text'][:50]}…", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
