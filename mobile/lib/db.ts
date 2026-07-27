import * as SQLite from 'expo-sqlite';

/**
 * The local SQLite database. Two tables, two completely separate jobs:
 *
 *   `offline_topics` — the READ path. A downloaded topic, stored as the exact API response.
 *   `outbox`         — the WRITE path. Finished games waiting to reach the server.
 *
 * They are deliberately not related to each other. Conflating a content cache with a pending
 * write queue is how sync layers turn into bug farms: the read path may be thrown away at any
 * time with no consequence, while losing an outbox row loses a student's work.
 *
 * This is NOT a sync engine, and must not grow into one. A topic is capped at 200 words
 * (`FlashcardImportInput`) — a handful of KB — so the whole payload is stored as one JSON blob
 * and replaced wholesale on refresh. No per-row diffing, no conflict resolution, no clocks.
 */

const DB_NAME = 'mochi.db';

/** expo-sqlite's modern API is async. The old callback API is deprecated — do not use it. */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS offline_topics (
  topic_id   TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  payload    TEXT NOT NULL,   -- JSON: the exact /api/flashcards/topic/:slug response
  synced_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offline_topics_slug ON offline_topics(slug);

CREATE TABLE IF NOT EXISTS outbox (
  client_id  TEXT PRIMARY KEY,   -- UUID generated on this device; the server's idempotency key
  payload    TEXT NOT NULL,      -- JSON FlashcardResultInput, including clientId
  created_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT               -- exponential backoff; NULL means "try now"
);
`;

/**
 * Opens the database once per app run and applies the schema. Every table is
 * `CREATE TABLE IF NOT EXISTS`, so this doubles as the migration for a fresh install; when a
 * column needs adding later, add an ALTER guarded by a version check rather than editing the
 * CREATE above — an existing install never re-runs it.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
      return db;
    })().catch((err) => {
      // Never cache a rejected promise: a transient open failure would otherwise poison the
      // database for the whole app session.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
