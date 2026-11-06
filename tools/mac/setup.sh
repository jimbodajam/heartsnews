#!/bin/bash
# Installs what the home agent needs on an Intel Mac with no Homebrew and no sudo (issue #101): Node 22, the GitHub CLI,
# ffmpeg and Rhubarb under ~/.local, each checked against a pinned SHA-256. Safe to run again.
# Usage (on the Mac): bash tools/mac/setup.sh        Git comes from `xcode-select --install`, which needs you at the Mac.
set -euo pipefail

NODE=22.23.4;  NODE_SHA=efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819
GH=2.103.3;    GH_SHA=a2f86418f4350ae6e9ec60d5000bdf7665728436946a97fc27fe50e6ae752682
FFMPEG=9.0.2;  FFMPEG_SHA=4acc0be580f9b2788029eb7bd4d645ff87968911b0a62aeeb3940d42d54558d5
RHUBARB=1.14.0; RHUBARB_SHA=f991deacac6c973a14a4431a16a58b842f436531e120cfaea142c87c0d3ab4c5

[ "$(uname -sm)" = "Darwin x86_64" ] || { echo "This script is for Intel macOS (Darwin x86_64)"; exit 1; }
L="$HOME/.local"; BIN="$L/bin"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BIN"

fetch() { # url sha256 -> file in $TMP
  local f="$TMP/$(basename "$1")"
  curl -fsSL "$1" -o "$f"
  echo "$2  $f" | shasum -a 256 -c - >/dev/null || { echo "Checksum mismatch for $1"; exit 1; }
  echo "$f"
}

if [ ! -x "$L/node/bin/node" ] || [ "$("$L/node/bin/node" -v)" != "v$NODE" ]; then
  echo "Node $NODE"; f=$(fetch "https://nodejs.org/dist/v$NODE/node-v$NODE-darwin-x64.tar.gz" $NODE_SHA)
  rm -rf "$L/node"; mkdir -p "$L/node"; tar -xzf "$f" -C "$L/node" --strip-components=1
fi

if ! "$BIN/gh" --version 2>/dev/null | grep -q "gh version $GH"; then
  echo "GitHub CLI $GH"; f=$(fetch "https://github.com/cli/cli/releases/download/v$GH/gh_${GH}_macOS_amd64.zip" $GH_SHA)
  unzip -qo "$f" -d "$TMP/gh"; cp "$TMP/gh/gh_${GH}_macOS_amd64/bin/gh" "$BIN/gh"
fi

if ! "$BIN/ffmpeg" -version 2>/dev/null | grep -q "ffmpeg version $FFMPEG"; then
  echo "ffmpeg $FFMPEG"; f=$(fetch "https://evermeet.cx/ffmpeg/ffmpeg-$FFMPEG.zip" $FFMPEG_SHA)
  unzip -qo "$f" -d "$TMP/ff"; cp "$TMP/ff/ffmpeg" "$BIN/ffmpeg"; chmod +x "$BIN/ffmpeg"
  xattr -dr com.apple.quarantine "$BIN/ffmpeg" 2>/dev/null || true
fi

# Rhubarb finds its res/ folder next to the real binary, so it keeps its own folder rather than a symlink.
if [ ! -x "$L/rhubarb/rhubarb" ]; then
  echo "Rhubarb $RHUBARB"; f=$(fetch "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v$RHUBARB/Rhubarb-Lip-Sync-$RHUBARB-macOS.zip" $RHUBARB_SHA)
  rm -rf "$L/rhubarb"; unzip -qo "$f" -d "$TMP/rb"; mv "$TMP"/rb/Rhubarb-Lip-Sync-* "$L/rhubarb"; chmod +x "$L/rhubarb/rhubarb"
  xattr -dr com.apple.quarantine "$L/rhubarb" 2>/dev/null || true
fi

export PATH="$L/node/bin:$BIN:$PATH"
echo "node $(node -v), $(gh --version | head -1), $(ffmpeg -version | head -1 | cut -d' ' -f1-3), $("$L/rhubarb/rhubarb" --version)"
git --version >/dev/null 2>&1 || echo "git is not ready yet: run  xcode-select --install  at the Mac, then run this again"
