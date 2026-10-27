-- A show read once (issue #49): the ingest summarises each long video's full transcript into main points, claims
-- and takes (summarise.ts), and storylines, stories and bulletins use that instead of the opening N characters.
-- The prune that clears old bodies and transcripts leaves the summary alone, so it outlives the transcript.
ALTER TABLE items ADD COLUMN summary_json TEXT;
ALTER TABLE items ADD COLUMN summarised_at TEXT;
