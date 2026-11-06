-- One row per player injury (issue #107), so the presenters can give real numbers ("seven in the treatment room, three
-- of them hamstrings"). The reading part comes from the request that writes an injury storyline's brief
-- (pipeline/src/storylines.ts); the dates are worked out from tally_games (pipeline/src/injuries.ts). A storyline can
-- hold several: a new part of the body, or a fresh setback after he has played again, is a new row (n = 1, 2…).
CREATE TABLE injuries (
  storyline_id INTEGER NOT NULL REFERENCES storylines (id),
  n INTEGER NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entities (id),
  area TEXT, -- hamstring, knee, ankle…; NULL when the reports don't say
  type TEXT NOT NULL DEFAULT 'unknown' CHECK (type IN ('muscle', 'ligament', 'bone', 'knock', 'illness', 'unknown')),
  side TEXT CHECK (side IN ('left', 'right')),
  claims TEXT NOT NULL DEFAULT '[]', -- JSON array of the claim ids about this injury
  first_reported_at TEXT NOT NULL,
  -- His last game before the first report, if within 7 days ('match'); otherwise the first report itself.
  injured_match_id TEXT,
  injured_at TEXT NOT NULL,
  date_basis TEXT NOT NULL CHECK (date_basis IN ('match', 'first_report')),
  return_estimate TEXT, -- as reported: "four to six weeks"
  return_from TEXT, -- that period as dates, counted from the claim's date; NULL when it's vague
  return_to TEXT,
  return_band TEXT CHECK (return_band IN ('short', 'medium', 'long', 'season')),
  -- What the latest claims say, and the status after what really happened (he played again: back).
  claimed_status TEXT NOT NULL CHECK (claimed_status IN ('out', 'doubt', 'back', 'unknown')),
  status TEXT NOT NULL CHECK (status IN ('out', 'doubt', 'back', 'unknown')),
  -- 1 when the club or the manager said it, or two separate outlets report it; otherwise it's only "reported".
  confirmed INTEGER NOT NULL DEFAULT 0,
  returned_match_id TEXT,
  returned_at TEXT,
  days_out INTEGER, -- so far, while he's still out
  games_missed INTEGER, -- counted Hearts games between injured_at and his return (or now)
  locked INTEGER NOT NULL DEFAULT 0, -- an admin has fixed the row: later reading leaves it alone
  updated_at TEXT NOT NULL,
  PRIMARY KEY (storyline_id, n)
);
CREATE INDEX injuries_entity ON injuries (entity_id);
CREATE INDEX injuries_open ON injuries (returned_match_id, status);
