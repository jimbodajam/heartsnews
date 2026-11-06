-- An injury the reports say happened in training (issue #107) is dated from the first report, never his last game.
ALTER TABLE injuries ADD COLUMN in_training INTEGER NOT NULL DEFAULT 0;
