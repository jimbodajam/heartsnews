#!/bin/bash
# Installs and starts the LaunchAgent (no sudo). Run on the Mac after setup.sh, `gh auth login` and `npm ci`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/Library/LaunchAgents/uk.heartsnews.agent.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed "s#__HOME__#$HOME#g" "$here/uk.heartsnews.agent.plist" > "$dest"
plutil -lint "$dest"
launchctl bootout "gui/$(id -u)/uk.heartsnews.agent" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$dest"
echo "Started. Log: tail -f ~/Library/Logs/heartsnews-agent.log"
