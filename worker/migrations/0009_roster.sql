-- The squad list (people rows of `entities`) is the source of truth for who is at the club. It is filled from the club's own
-- pages the first time, then checked against them only in a transfer window or on demand (pipeline/src/squad.ts). The admin
-- fixes spellings and adds signings from /admin?roster=1. `locked`: an admin has touched the row, so a sync will not switch
-- them back on. `added`: not on the club's pages (a signing not yet listed), so a sync will not retire them.
ALTER TABLE entities ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entities ADD COLUMN added INTEGER NOT NULL DEFAULT 0;
