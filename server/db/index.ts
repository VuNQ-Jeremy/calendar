export type { Db } from './internal';
export { TenantDb, tenantDbFor, PRIMARY_TENANT_ID, type TenantTable } from './tenant';

/**
 * D1 rejects any single statement carrying more than 100 bound parameters with a bare
 * `D1_ERROR: too many SQL variables` — far stricter than SQLite's own 999. It bites on
 * multi-row inserts (rows × columns) and on `inArray(...)` over a long id list, and only once
 * the data gets big, which is exactly when it is least welcome.
 *
 * Note that `tenant_id` is now one of those columns, so every multi-row insert fits one row
 * fewer than it used to.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * The `inArray` budget for a query that also carries a school predicate.
 *
 * `db.own(...)` / `db.pool(...)` bind `tenant_id` as one more parameter, so a chunk sized at the
 * full ceiling now emits 101 and D1 refuses the whole statement with `too many SQL variables`.
 * It only bites past 100 ids — a bulk import or a select-all delete — which is exactly the case
 * least likely to be tried by hand before shipping.
 */
export const SCOPED_MAX_BOUND_PARAMS = D1_MAX_BOUND_PARAMS - 1;

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
