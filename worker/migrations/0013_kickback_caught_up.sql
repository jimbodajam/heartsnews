-- Whether the last page we fetched was the thread's last one (issue #62). The cursor alone can't say: next_page = pages could
-- mean the last page is still to be fetched for the first time, or that it was fetched and we're only watching it for more.
ALTER TABLE kickback_threads ADD COLUMN caught_up INTEGER NOT NULL DEFAULT 0;
