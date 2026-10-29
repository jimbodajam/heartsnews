-- The Jambos Kickback crawler (issue #62, kickback/src/crawl.ts): whole threads, kept so features can build on them.
-- Its crawl state (the block cool-off, the day's request count, the last run) lives in the `state` table under kickback_* keys.

CREATE TABLE kickback_threads (
  id INTEGER PRIMARY KEY, -- the forum's topic number
  title TEXT NOT NULL,
  url TEXT NOT NULL, -- the thread's first page; later pages are url + "page/N/"
  watching INTEGER NOT NULL DEFAULT 1,
  pages INTEGER NOT NULL DEFAULT 1, -- pages the forum had when we last looked
  next_page INTEGER NOT NULL DEFAULT 1, -- the cursor: the page to fetch next (the last page again once we are caught up)
  newest_post_at TEXT,
  last_crawled_at TEXT,
  last_new INTEGER NOT NULL DEFAULT 0, -- posts the last fetch added
  last_error TEXT
);

CREATE TABLE kickback_posts (
  id INTEGER PRIMARY KEY, -- the forum's comment number
  thread_id INTEGER NOT NULL REFERENCES kickback_threads(id),
  ts TEXT NOT NULL,
  author TEXT,
  text TEXT NOT NULL, -- the poster's own words, quotes taken out
  reply_to INTEGER -- the post this one quoted, which may be in another thread
);
CREATE INDEX kickback_posts_thread_ts ON kickback_posts (thread_id, ts);

-- Hearts v Rangers (28 Oct) to start with: the first thread to prove the crawler on.
INSERT INTO kickback_threads (id, title, url) VALUES
  (212798, 'Official Heart of Midlothian v Rangers Match Thread', 'https://www.hmfckickback.co.uk/index.php?/topic/212798-official-heart-of-midlothian-v-rangers-match-thread/');
