#!/usr/bin/env bash
# One-off setup for rendering voices on an NVIDIA GPU (run inside WSL): a private Python environment in
# ~/.cache/heartsnews-gpu with Kokoro and the CUDA build of ONNX Runtime, plus the Kokoro model files.
# Usage: npm run gpu:setup
set -euo pipefail

BASE="$HOME/.cache/heartsnews-gpu"
mkdir -p "$BASE/models"
cd "$BASE"

# uv manages Python 3.12 for us without touching the system Python.
if [ ! -x boot/bin/uv ]; then
  python3 -m venv boot
  boot/bin/pip install -q --upgrade pip uv
fi
UV="$BASE/boot/bin/uv"
"$UV" python install 3.12 >/dev/null
[ -d env ] || "$UV" venv -q -p 3.12 env

# kokoro-onnx pulls in the CPU onnxruntime; swap it for the GPU build (which brings its own CUDA libraries).
# Pinned to the CUDA 12 build: the CUDA 13 builds crash on an RTX 2080 Ti (Turing) under WSL.
"$UV" pip install -q -p env/bin/python kokoro-onnx soundfile
"$UV" pip uninstall -q -p env/bin/python onnxruntime onnxruntime-gpu nvidia-cublas nvidia-cuda-nvrtc nvidia-cuda-runtime \
  nvidia-cudnn-cu13 nvidia-cufft nvidia-curand nvidia-nvjitlink 2>/dev/null || true
"$UV" pip install -q -p env/bin/python "onnxruntime-gpu[cuda,cudnn]==1.22.0"

cd models
fetch() { [ -s "$2" ] || curl -sSL --fail -o "$2" "$1"; }
fetch https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx kokoro-v1.0.onnx
fetch https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin voices-v1.0.bin

"$BASE/env/bin/python" -c "import onnxruntime as o; print('ONNX Runtime', o.__version__, 'providers:', o.get_available_providers())"
echo "GPU voice environment ready in $BASE"
