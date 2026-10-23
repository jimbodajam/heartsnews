-- Ingesting every article once (story engine stage 1b, issue #30). `npm run ingest` (pipeline/src/ingest.ts) fetches
-- each press and official article into items.body, and remembers how it went so a page that refuses us isn't tried
-- every run: a few tries, then it gives up.

ALTER TABLE items ADD COLUMN fetch_status TEXT CHECK (fetch_status IN ('ok', 'failed', 'gave_up'));
ALTER TABLE items ADD COLUMN fetched_at TEXT; -- the last try
ALTER TABLE items ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN fetch_error TEXT;
CREATE INDEX items_fetch ON items (fetch_status, kind);

-- Tagged from the article's full text, not just its headline and summary. A bulletin's headline tags never replace these.
ALTER TABLE item_tags ADD COLUMN from_text INTEGER NOT NULL DEFAULT 0;
