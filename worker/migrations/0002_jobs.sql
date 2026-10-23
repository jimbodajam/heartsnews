-- The channel's job queue (issue #29). The Worker's clock (worker/src/clock.ts) queues a job for each programme and
-- breaking package that's due; the home PC or GitHub Actions claims it (pipeline/src/store.ts) and builds it.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY, -- e.g. programme:2026-10-23T14:30:00.000Z, breaking:<kick-off>:goal:home:Lawrence Shankland:1
  kind TEXT NOT NULL CHECK (kind IN ('programme', 'breaking')),
  payload TEXT NOT NULL DEFAULT '{}', -- JSON: a programme's reason, or the event and match a package is built from
  test INTEGER NOT NULL DEFAULT 0, -- a replayed match (`npm run replay -- --queue`): built on GitHub, never published
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'done', 'failed', 'dropped')),
  queued_at TEXT NOT NULL,
  dispatched_at TEXT, -- when GitHub was last asked to build it
  dispatches INTEGER NOT NULL DEFAULT 0,
  runner TEXT CHECK (runner IN ('home', 'github')),
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX jobs_status ON jobs (status, queued_at);

-- Small bits of state, as JSON: the clock's event tracker and programme cadence, when the home PC last checked in.
CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Who may publish to gh-pages right now, so the two runners never publish over each other. Expires on its own.
CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  until TEXT NOT NULL
);
