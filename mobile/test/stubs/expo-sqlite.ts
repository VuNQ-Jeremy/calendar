/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

/**
 * `expo-sqlite`'s async surface, backed by Node's built-in SQLite.
 *
 * Real SQL, no native build step and no extra dependency — which is the whole point. The outbox
 * is the one place in this app where a wrong query loses a student's finished work, so its tests
 * run the same statements the phone runs rather than a fake that cannot disagree with them.
 *
 * Requires Node 24 (`node:sqlite` is unflagged there). CI pins the mobile steps to 24 for this.
 *
 * Only the methods `lib/` actually calls are implemented. Add to it when `lib/` grows a new one;
 * do not grow it speculatively.
 */
export async function openDatabaseAsync(_name: string) {
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(sql: string) {
      // `PRAGMA journal_mode = WAL` is meaningless for an in-memory database and node:sqlite
      // rejects it. Stripping it keeps `lib/db.ts`'s schema string usable verbatim otherwise.
      db.exec(sql.replace(/PRAGMA[^;]*;/gi, ''));
    },
    async runAsync(sql: string, ...params: unknown[]) {
      db.prepare(sql).run(...(params as never[]));
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
