// The Kickback crawler's contract (issue #62). Everything the bulletin pipeline may read from a forum thread is here and
// nothing else: it knows no pipeline types, so this folder can move to its own repo later.

/** One post. `replyTo` is the id of the post it quoted (the quoted words are not kept). */
export interface Post {
  id: number;
  /** When it was posted, ISO UTC. */
  ts: string;
  author?: string;
  text: string;
  replyTo?: number;
}

/** A thread and its posts in the order they were posted. */
export interface Thread {
  id: number;
  title: string;
  url: string;
  /** Pages the forum had when we last looked. */
  pages: number;
  posts: Post[];
}

type Row = Record<string, unknown>;

/** The database the crawler needs: one transaction of statements, with the rows each returns (the Worker's D1, or a test's). */
export interface Db {
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<Row[][]>;
}
