#!/bin/bash
# What launchd runs (issue #101): the agent, with its output appended to the log line by line, so newsyslog can rotate
# the log by renaming it (launchd's own StandardOutPath would keep writing into the renamed file). SIGTERM from
# `launchctl bootout` is passed to the agent, so it signs off and hands its jobs back (stop() in agent.ts).
# Before each start it brings ~/heartsnews up to date with main, and runs `npm ci` when package-lock.json has changed.
# The agent is started with --follow-main, so it bows out (when idle) once main moves on, and launchd starts it again
# here, on the new code. If the update fails, the agent starts on the code it already has.
# Everything is inside main() so bash reads the whole script before running it: a pull may replace this file.

main() {
  cd "$HOME/heartsnews" || exit 1
  LOG="$HOME/Library/Logs/heartsnews-agent.log"
  log() { printf '%s [update] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

  before=$(git rev-parse --short HEAD)
  # Every build rewrites this tracked file (build.ts); the copy here is only a leftover, the real one is on gh-pages.
  git checkout -q -- site/public/bulletins/latest.json 2>/dev/null
  if out=$(git pull -q --ff-only origin main 2>&1); then
    after=$(git rev-parse --short HEAD)
    [ "$before" != "$after" ] && log "Updated $before -> $after"
  else
    log "Couldn't update from main, starting on $before: $out"
  fi

  # npm ci again whenever the lockfile differs from the one last installed (also retries an install that failed).
  lock=$(git hash-object package-lock.json)
  stamp="node_modules/.heartsnews-lock"
  if [ "$(cat "$stamp" 2>/dev/null)" != "$lock" ]; then
    log "package-lock.json changed: npm ci"
    if npm ci --no-audit --no-fund >> "$LOG" 2>&1; then echo "$lock" > "$stamp"; else log "npm ci failed"; fi
  fi

  cd pipeline || exit 1
  "$HOME/.local/node/bin/node" "$HOME/heartsnews/node_modules/tsx/dist/cli.mjs" src/agent.ts --follow-main "$@" \
    > >(while IFS= read -r line; do printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line" >> "$LOG"; done) 2>&1 &
  pid=$!
  trap 'kill -TERM "$pid" 2>/dev/null' TERM INT
  wait "$pid"; code=$?
  # The first wait returns when the signal arrives; wait again for the agent to finish signing off.
  while kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done
  exit "$code"
}

main "$@"; exit
