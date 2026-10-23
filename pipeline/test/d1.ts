// A stand-in for Cloudflare D1 on Node's built-in SQLite, in memory, with worker/migrations/ applied. Like D1, a
// batch is one transaction and foreign keys are enforced.

import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1Statement } from '../../worker/src/store.ts';

const MIGRATIONS = fileURLToPath(new URL('../../worker/migrations/', import.meta.url));

interface Prepared extends D1Statement {
  sql: string;
  values: unknown[];
}

export function memoryD1(): D1Database & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(MIGRATIONS + f, 'utf8'));

  const statement = (sql: string, values: unknown[] = []): Prepared => ({ sql, values, bind: (...v) => statement(sql, v) });
  return {
    db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = (statements as Prepared[]).map((s) => ({ results: db.prepare(s.sql).all(...(s.values as SQLInputValue[])) }));
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
