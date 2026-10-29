# Kickback fetcher on a home Pi (issue #62)

The Jambos Kickback sits behind Cloudflare's bot check, which turns away Cloudflare's own Workers (HTTP 403, "Just a moment...")
but lets a home connection through. So the Worker decides what to fetch (`kickback/src/crawl.ts`: cursor, caps, pacing, the
cool-off after any 403/429/503) and `kickback-fetch.sh` does the fetching. It makes no decisions: it asks `/kickback/next`
for a page and when, fetches it with `curl`, and reports what came back to `/kickback/page`. Needs `curl` and `jq` (both are in
the Home Assistant SSH add-on).

## Set up once

### 1. A token of its own

It can only fetch and report pages, unlike `STORE_TOKEN`, which can run any SQL:

```bash
cd worker && npx wrangler secret put KICKBACK_TOKEN
```

### 2. Apply the migrations and deploy the Worker

`npx wrangler d1 migrations apply heartsnews --remote` from `worker/`, then `npm run worker:deploy`. The deployed Worker must be this version: the first one fetched the forum itself from the cron and was refused.

### 3. Put the script on the Pi

In the *Advanced SSH & Web Terminal* add-on's terminal:

```bash
mkdir -p /config/kickback && cd /config/kickback
curl -fsSL -o kickback-fetch.sh https://raw.githubusercontent.com/jimbodajam/heartsnews/main/tools/pi/kickback-fetch.sh
chmod +x kickback-fetch.sh
cat > env <<'EOF'
KICKBACK_WORKER=https://heartsnews-live.heartsnews.workers.dev
KICKBACK_TOKEN=paste-the-token-here
EOF
chmod 600 env
```

### 4. Try it

Run `./kickback-fetch.sh`, then `tail -f fetch.log` in a second terminal. `idle: ...` lines are the Worker saying
why there is nothing to fetch; `HTTP 200 <url> -> {"accepted":true,"newPosts":50}` is a page taken. Ctrl+C stops it.

### 5. Keep it running

In the add-on's *Configuration* tab add:

```yaml
init_commands:
  - nohup /config/kickback/kickback-fetch.sh > /dev/null 2>&1 &
```

and restart the add-on. Turn on *Start on boot* and *Watchdog* so it comes back after a restart. Only one copy runs at a time.

## Watching it

`/admin?kickback=1` on the Worker shows whether it is crawling, cooling off or waiting for the fetcher, the requests today, and
what the last refusal looked like. The Pi's own log is `/config/kickback/fetch.log` (trimmed automatically).
