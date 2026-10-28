-- Our own count of each player's Hearts appearances and goals (issue #35). London Hearts' totals are the seed, read once
-- (state key `tally_since` is the date of the last game they include); after that every finished game is counted from
-- BBC's final line-ups and scorers (pipeline/src/tally.ts). A player's total is the seed plus his rows in tally_games.
CREATE TABLE tally (
  entity_id TEXT PRIMARY KEY,
  lh_id TEXT, -- London Hearts' player id, for the audit
  seed_apps INTEGER NOT NULL,
  seed_goals INTEGER NOT NULL
);

-- One row per player per counted game ("<kick-off date>|<home>|<away>"), so counting a game twice does nothing.
CREATE TABLE tally_games (
  match_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  started INTEGER NOT NULL,
  goals INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, entity_id)
);
CREATE INDEX tally_games_entity ON tally_games (entity_id);

-- A game that has been counted, and anyone who played but couldn't be matched to the squad list (JSON array of names).
CREATE TABLE tally_runs (
  match_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  counted_at TEXT NOT NULL,
  unmatched TEXT NOT NULL DEFAULT '[]'
);
