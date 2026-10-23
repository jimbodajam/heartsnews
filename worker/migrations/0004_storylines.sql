-- Claims, storylines and briefs (story engine stage 2, issue #25). `npm run ingest` (pipeline/src/storylines.ts) reads
-- each new article once, sifts it into short claims, files them under storylines, and keeps a written brief on each
-- storyline that changed. Storylines are the channel's long-term memory: a closed one stays.

-- person: a player or member of staff and a topic ("Milne injury"). match: one per fixture, from the preview to the
-- fallout. club: neither (the manager's job, finances, the stadium).
ALTER TABLE storylines ADD COLUMN kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'match', 'club'));
-- match: the fixture, as "<kick-off date>|<home>|<away>", and its kick-off.
ALTER TABLE storylines ADD COLUMN fixture TEXT;
ALTER TABLE storylines ADD COLUMN kick_off TEXT;
ALTER TABLE storylines ADD COLUMN closed_at TEXT;
ALTER TABLE storylines ADD COLUMN close_reason TEXT CHECK (close_reason IN ('resolved', 'quiet', 'next_match'));
-- JSON: { known, disputed, latest }, rewritten when a claim gets a new source after brief_at (or there is no brief yet).
ALTER TABLE storylines ADD COLUMN brief TEXT;
ALTER TABLE storylines ADD COLUMN brief_at TEXT;
CREATE UNIQUE INDEX storylines_fixture ON storylines (fixture) WHERE fixture IS NOT NULL;
CREATE INDEX storylines_status ON storylines (status, updated_at);

-- A claim another one disputes (both are marked disputed).
ALTER TABLE claims ADD COLUMN disputes INTEGER REFERENCES claims (id);

-- A headline-only item (an aggregator, or an article we couldn't fetch) backing a claim: corroboration, not a source
-- the claim was read from.
ALTER TABLE claim_sources ADD COLUMN corroboration INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claim_sources ADD COLUMN at TEXT;

-- When an item was read for claims (or checked as corroboration), so it's only read once.
ALTER TABLE items ADD COLUMN sifted_at TEXT;
CREATE INDEX items_sifted ON items (sifted_at, first_seen);
