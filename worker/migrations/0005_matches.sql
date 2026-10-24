-- The fact ledger (issue #32): every Hearts result the channel has seen, and what the checks changed in each script.
-- Results come from each build's fixtures feed (BBC Sport, or TheSportsDB when the BBC fails); a script line that
-- contradicts them is fixed or dropped in code (pipeline/src/script/ledger.ts), and logged here to learn from.

-- One row per finished game, by "<kick-off date>|<home>|<away>" with our club by its short name (as storylines key
-- their fixture). A BBC row is never overwritten by TheSportsDB's.
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, -- kick-off
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  competition TEXT,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bbc', 'sportsdb')),
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX matches_date ON matches (date);

-- Each goal, in order. Only written when the feed gives the scorers; the latest feed's list replaces the last.
CREATE TABLE goals (
  match_id TEXT NOT NULL REFERENCES matches (id),
  n INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('home', 'away')),
  player TEXT NOT NULL,
  minute TEXT,
  PRIMARY KEY (match_id, n)
);

-- What a fact check fixed or dropped: the AI fact-checker's pass, then the ledger's (score, outcome or scorer).
CREATE TABLE fact_checks (
  id INTEGER PRIMARY KEY,
  bulletin_id TEXT NOT NULL REFERENCES bulletins (id),
  checker TEXT NOT NULL CHECK (checker IN ('ai', 'ledger')),
  kind TEXT,
  action TEXT NOT NULL CHECK (action IN ('fixed', 'dropped')),
  segment TEXT,
  was TEXT NOT NULL,
  now TEXT,
  reason TEXT,
  at TEXT NOT NULL
);
CREATE INDEX fact_checks_at ON fact_checks (at);
