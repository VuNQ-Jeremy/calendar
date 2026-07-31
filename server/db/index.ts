import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export const createDb = (env: Env) => drizzle(env.DB, { schema });
export type Db = ReturnType<typeof createDb>;

/**
 * D1 rejects any single statement carrying more than 100 bound parameters with a bare
 * `D1_ERROR: too many SQL variables` — far stricter than SQLite's own 999. It bites on
 * multi-row inserts (rows × columns) and on `inArray(...)` over a long id list, and only once
 * the data gets big, which is exactly when it is least welcome.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Split `items` into runs of at most `size`. Use it with `rowsPerStatement` to keep every
 * generated statement under the bound-parameter ceiling, then send the pieces as one `db.batch`
 * so the write stays atomic.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** How many rows of `columns` fields fit in one statement, at least 1. */
export const rowsPerStatement = (columns: number): number =>
  Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / columns));
