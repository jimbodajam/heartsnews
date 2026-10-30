#!/usr/bin/env bash
# Render the bake-off with every engine, then open tools/gpu/bakeoff/index.html to listen and rate.
# Usage (WSL): bash tools/gpu/bakeoff.sh [kokoro|qwen|chatterbox ...]
set -euo pipefail
cd "$(dirname "$0")"
BASE="$HOME/.cache/heartsnews-gpu"
ENGINES=("$@"); [ ${#ENGINES[@]} -gt 0 ] || ENGINES=(kokoro qwen chatterbox)   # qwen before chatterbox: it designs the reference clips
for e in "${ENGINES[@]}"; do
  py="$BASE/env/bin/python"; case "$e" in kokoro*) ;; *) py="$BASE/env-${e%%-*}/bin/python" ;; esac
  echo "== $e"; "$py" bakeoff.py "$e"
done
