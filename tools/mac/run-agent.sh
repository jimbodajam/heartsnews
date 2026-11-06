#!/bin/bash
# What launchd runs (issue #101): the agent, with its output appended to the log line by line, so newsyslog can rotate
# the log by renaming it (launchd's own StandardOutPath would keep writing into the renamed file). SIGTERM from
# `launchctl bootout` is passed to the agent, so it signs off and hands its jobs back (stop() in agent.ts).
cd "$HOME/heartsnews/pipeline"
LOG="$HOME/Library/Logs/heartsnews-agent.log"
"$HOME/.local/node/bin/node" "$HOME/heartsnews/node_modules/tsx/dist/cli.mjs" src/agent.ts "$@" \
  > >(while IFS= read -r line; do printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line" >> "$LOG"; done) 2>&1 &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT
wait "$pid"; code=$?
# The first wait returns when the signal arrives; wait again for the agent to finish signing off.
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done
exit "$code"
