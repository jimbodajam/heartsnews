-- The channel's memory (story engine stage 0, issue #28). Times are ISO strings in UTC; lists are JSON arrays.
-- Apply with `npx wrangler d1 migrations apply heartsnews --remote` from worker/. Tests run these same files
-- against an in-memory SQLite (pipeline/test/store.test.ts).

-- One row per bulletin that wrote to the store.
CREATE TABLE bulletins (
  id TEXT PRIMARY KEY, -- its generatedAt
  generated_at TEXT NOT NULL,
  phase TEXT, -- matchday mode, e.g. normal, preview, live, reaction
  runner TEXT NOT NULL CHECK (runner IN ('home', 'github'))
);

-- Every collected item, by the collector's id. Body and transcript are pruned after about 30 days.
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  publisher TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  published_at TEXT,
  first_seen TEXT NOT NULL,
  body TEXT,
  transcript TEXT
);
CREATE INDEX items_published ON items (published_at);
CREATE INDEX items_first_seen ON items (first_seen);

-- People, clubs and competitions, by slug. Seeded each build from the squad list, SportsDB and the club config.
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('player', 'staff', 'club', 'competition')),
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

-- What the tagger made of an item. A better tagger (higher version) re-tags old items.
CREATE TABLE item_tags (
  item_id TEXT PRIMARY KEY REFERENCES items (id),
  category TEXT,
  mood TEXT,
  tagger_version INTEGER NOT NULL,
  tagged_at TEXT NOT NULL
);

CREATE TABLE item_entities (
  item_id TEXT NOT NULL REFERENCES items (id),
  entity_id TEXT NOT NULL REFERENCES entities (id),
  PRIMARY KEY (item_id, entity_id)
);
CREATE INDEX item_entities_entity ON item_entities (entity_id);

CREATE TABLE storylines (
  id INTEGER PRIMARY KEY,
  entity_id TEXT REFERENCES entities (id),
  category TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX storylines_entity ON storylines (entity_id);

CREATE TABLE claims (
  id INTEGER PRIMARY KEY,
  storyline_id INTEGER NOT NULL REFERENCES storylines (id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'confirmed', 'disputed', 'replaced')),
  first_seen TEXT NOT NULL,
  replaced_by INTEGER REFERENCES claims (id)
);
CREATE INDEX claims_storyline ON claims (storyline_id);

CREATE TABLE claim_sources (
  claim_id INTEGER NOT NULL REFERENCES claims (id),
  item_id TEXT NOT NULL REFERENCES items (id),
  PRIMARY KEY (claim_id, item_id)
);

-- A story (by its on-air title) or storyline going out in a bulletin. Imported airings have no bulletin.
CREATE TABLE airings (
  id INTEGER PRIMARY KEY,
  bulletin_id TEXT REFERENCES bulletins (id),
  story TEXT,
  storyline_id INTEGER REFERENCES storylines (id),
  in_depth INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX airings_at ON airings (at);
CREATE INDEX airings_story ON airings (story);

-- What a presenter said about something. Imported takes have no bulletin.
CREATE TABLE takes (
  id INTEGER PRIMARY KEY,
  presenter_id TEXT NOT NULL,
  entity_id TEXT REFERENCES entities (id),
  storyline_id INTEGER REFERENCES storylines (id),
  topic TEXT NOT NULL,
  view TEXT NOT NULL,
  strength REAL,
  at TEXT NOT NULL,
  bulletin_id TEXT REFERENCES bulletins (id)
);
CREATE INDEX takes_presenter ON takes (presenter_id, at);
CREATE INDEX takes_entity ON takes (entity_id);

-- One score prediction per presenter per match; a later call replaces the earlier one.
CREATE TABLE predictions (
  id INTEGER PRIMARY KEY,
  presenter_id TEXT NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  date TEXT NOT NULL, -- kick-off
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  made_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('exact', 'right', 'wrong')),
  actual TEXT,
  bulletin_id TEXT REFERENCES bulletins (id),
  UNIQUE (presenter_id, home, away, date)
);
