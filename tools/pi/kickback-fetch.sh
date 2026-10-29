#!/bin/sh
# The Kickback crawler's fetcher (issue #62), for a machine on a home connection: the forum's bot check turns away Cloudflare's
# Workers but lets this through. It decides nothing. It asks the Worker which page to fetch and when, fetches it, and reports
# what came back; the Worker holds the cursor, the caps and the cool-off (kickback/src/crawl.ts), so a refusal stops it there.
# Needs curl and jq. Settings come from the environment, or from the file KICKBACK_ENV (default: env beside this script):
#   KICKBACK_WORKER  the Worker's address, e.g. https://heartsnews-live.heartsnews.workers.dev
#   KICKBACK_TOKEN   the Worker secret of the same name (npx wrangler secret put KICKBACK_TOKEN)
# See tools/pi/README.md for running it on a Home Assistant Pi.

DIR=$(cd "$(dirname "$0")" && pwd)
[ -f "${KICKBACK_ENV:-$DIR/env}" ] && . "${KICKBACK_ENV:-$DIR/env}"
: "${KICKBACK_WORKER:?KICKBACK_WORKER is not set}" "${KICKBACK_TOKEN:?KICKBACK_TOKEN is not set}"
UA='Mozilla/5.0 (compatible; HeartsNews24/0.1; hobby fan project)'
LOG="${KICKBACK_LOG:-$DIR/fetch.log}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log() {
  echo "$(date -u +%FT%TZ) $*" >> "$LOG"
  # Keep the log from growing for ever.
  [ "$(wc -c < "$LOG")" -gt 200000 ] && tail -n 300 "$LOG" > "$WORK/log" && cat "$WORK/log" > "$LOG"
}

# One of these at a time.
mkdir "$DIR/.lock" 2>/dev/null || { [ -d "$DIR/.lock" ] && kill -0 "$(cat "$DIR/.lock/pid" 2>/dev/null)" 2>/dev/null && { echo "already running"; exit 1; }; }
echo $$ > "$DIR/.lock/pid"
trap 'rm -rf "$WORK" "$DIR/.lock"' EXIT

worker() { curl -sS -m 30 -H "authorization: Bearer $KICKBACK_TOKEN" "$@"; }

log "started, Worker $KICKBACK_WORKER"
while true; do
  next=$(worker "$KICKBACK_WORKER/kickback/next") || { log "couldn't reach the Worker"; sleep 60; continue; }
  url=$(echo "$next" | jq -r '.url // empty' 2>/dev/null)
  if [ -z "$url" ]; then
    why=$(echo "$next" | jq -r '.idle // empty' 2>/dev/null)
    [ -z "$why" ] && why="unexpected answer: $(echo "$next" | head -c 200)"
    secs=$(echo "$next" | jq -r '.retryInSec // 60' 2>/dev/null)
    [ "$why" != "$LAST_WHY" ] && log "idle: $why"
    LAST_WHY=$why
    sleep "${secs:-60}"
    continue
  fi
  LAST_WHY=
  sleep "$(echo "$next" | jq -r '(.waitMs // 0) / 1000')"

  # One request. Never retried here: whatever happens is reported, and the Worker decides.
  : > "$WORK/headers"
  status=$(curl -sS -m 30 -L --max-redirs 3 -A "$UA" -D "$WORK/headers" -o "$WORK/body" -w '%{http_code}' "$url" 2>"$WORK/err")
  rc=$?
  [ $rc -ne 0 ] && status=0
  jq -n --arg url "$url" --argjson status "${status:-0}" --arg error "$(head -c 300 "$WORK/err" 2>/dev/null)" --rawfile body "$WORK/body" \
    --rawfile headers "$WORK/headers" '
    ($headers | split("\r\n") | map(select(test(":")) | {key: (split(":")[0] | ascii_downcase), value: (split(":")[1:] | join(":") | sub("^ +"; ""))}) | from_entries) as $h
    | {url: $url, status: $status, body: $body, headers: {server: $h.server, "cf-ray": $h["cf-ray"], "cf-mitigated": $h["cf-mitigated"], "content-type": $h["content-type"]}}
      + (if $status == 0 then {error: $error} else {} end)
    | .headers |= with_entries(select(.value != null))' > "$WORK/reply.json"
  answer=$(worker -X POST -H 'content-type: application/json' --data-binary "@$WORK/reply.json" "$KICKBACK_WORKER/kickback/page") || answer='{"error":"couldn'"'"'t report to the Worker"}'
  log "HTTP $status $url -> $(echo "$answer" | jq -c '.' 2>/dev/null || echo "$answer")"
done
