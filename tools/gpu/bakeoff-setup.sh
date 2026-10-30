#!/usr/bin/env bash
# Environments for the voice bake-off (run inside WSL after tools/gpu/setup.sh): one per engine, since their
# torch pins clash. Usage: bash tools/gpu/bakeoff-setup.sh
set -euo pipefail
BASE="$HOME/.cache/heartsnews-gpu"
UV="$BASE/boot/bin/uv"
cd "$BASE"
for e in qwen chatterbox; do [ -d "env-$e" ] || "$UV" venv -q -p 3.12 "env-$e"; done
"$UV" pip install -q -p env-qwen/bin/python qwen-tts soundfile
# Pinned to the CUDA 12.4 build: the default CUDA 13 torch segfaults on an RTX 2080 Ti under WSL (as with ONNX Runtime).
"$UV" pip install -q -p env-qwen/bin/python --reinstall "torch==2.6.0" "torchaudio==2.6.0" --index-url https://download.pytorch.org/whl/cu124
"$UV" pip install -q -p env-chatterbox/bin/python chatterbox-tts torchaudio "setuptools<81"   # its watermarker imports pkg_resources
for e in qwen chatterbox; do "env-$e/bin/python" -c "import torch; print('$e', torch.__version__, torch.cuda.is_available())"; done
