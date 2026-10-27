-- Quiet slots (issue #50): a programme where nothing had changed rewrites only the links between segments.
-- 'full' is a whole new bulletin, 'partial' a quiet slot; for the admin view (#39) to show how often it happens.
ALTER TABLE bulletins ADD COLUMN kind TEXT NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'partial'));
