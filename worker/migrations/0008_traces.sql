-- What each programme was built from (issue #39), for the admin view (worker/src/admin.ts): why did that bulletin say that?
-- Written by build.ts after the bulletin is saved, in a batch of its own (pipeline/src/store.ts, saveTrace). The stories
-- that went in are the bulletin's airings, and what the checks cut is its fact_checks.

CREATE TABLE bulletin_traces (
  bulletin_id TEXT PRIMARY KEY REFERENCES bulletins (id),
  at TEXT NOT NULL,
  writer TEXT, -- the bulletin's generatedBy, e.g. "Gemini (gemini-flash-latest), checked by ..."
  meta TEXT NOT NULL DEFAULT '{}', -- JSON: { mode: 'full' | 'partial', why, failed: [{ id, error }] }
  calls TEXT NOT NULL DEFAULT '[]', -- JSON: every model request, in order: [{ label, model, ok, ms, error? }]. A fallback is a second call under one label.
  prompts TEXT, -- JSON: { piece id: prompt }. Kept for the latest bulletins only (see KEEP_PROMPTS), then cleared.
  script TEXT NOT NULL -- JSON: [{ id, title, lines: [{ speaker, text, link? }] }], the final script
);
CREATE INDEX bulletin_traces_at ON bulletin_traces (at);
