#!/usr/bin/env bash
# One-off setup for the cloned voices (run inside WSL, after tools/gpu/setup.sh): a Python environment in ~/.cache/heartsnews-gpu/env-qwen with
# Qwen3-TTS, and a folder for the reference clips, ~/.cache/heartsnews-gpu/voices. The clips are people's voices: they stay out of the repo, and
# are only added with the speaker's agreement. Each is <name>.wav (mono, 10-17 s, one speaker, cut on whole sentences) plus <name>.txt with
# exactly the words spoken. Presenters point at them by name in channel.json (tts.clone.ref).
# Usage: npm run gpu:clone-setup
set -euo pipefail

BASE="$HOME/.cache/heartsnews-gpu"
UV="$BASE/boot/bin/uv"
[ -x "$UV" ] || { echo "Run npm run gpu:setup first"; exit 1; }
mkdir -p "$BASE/voices"
cd "$BASE"
[ -d env-qwen ] || "$UV" venv -q -p 3.12 env-qwen
"$UV" pip install -q -p env-qwen/bin/python qwen-tts soundfile
# Pinned to the CUDA 12.4 build: the default CUDA 13 torch segfaults on an RTX 2080 Ti under WSL (as with ONNX Runtime).
"$UV" pip install -q -p env-qwen/bin/python --reinstall "torch==2.6.0" "torchaudio==2.6.0" --index-url https://download.pytorch.org/whl/cu124
env-qwen/bin/python -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available())"
echo "Clone voices ready. Reference clips go in $BASE/voices:"
ls "$BASE/voices" 2>/dev/null | sed 's/^/  /' || true
