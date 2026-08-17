import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createRawDb, type Db } from './internal';

/**
 * The original school — every row that existed before multi-tenancy belongs to it.
 *
 * This literal lives in exactly three places: here, `migrations/0045_tenants.sql`, and the
 * seed/test SQL. Nowhere else should hardcode a school id.
 */
export const PRIMARY_TENANT_ID = 'tnt_mochi_0001';

/** Any schema table carrying the discriminator column. */
export type TenantTable = SQLiteTable & { tenantId: SQLiteColumn };

/** A row as a caller supplies it: the school is the wrapper's job, never the caller's. */
type InsertRow<T extends TenantTable> = Omit<T['$inferInsert'], 'tenantId'>;

/**
 * A drizzle handle bound to one school.
 *
 * Services take this instead of a bare `Db`, and the two types are structurally disjoint, so
 * the compiler enumerates every call site the day a service is converted. The design goal is
 * that the scoped spelling is *shorter* than the unscoped one — `db.own(classes)` versus
 * hand-writing the predicate — because a guardrail that costs keystrokes gets worked around.
 *
 * Reads stay explicit rather than being rewritten behind your back: `db.raw.select()` with
 * `db.own(table)` in the `where`. That keeps joins, projections and `db.batch` working exactly
 * as they did, and keeps the scope visible in the query you are reading. Writes go through the
 * wrappers, which do not let you omit it.
 */
export class TenantDb {
  constructor(
    /**
     * The unscoped handle underneath. Legitimate uses: reads (paired with `own`/`pool` in the
     * `where`), joins, and tables that carry no `tenant_id` because they are reachable only
     * through a scoped parent. Every `raw.select` in a service must still carry `own`/`pool` —
     * `test/tenant-scope.test.ts` fails the build otherwise.
     */
    readonly raw: Db,
    readonly tenantId: string,
  ) {}

  /** `tenant_id = :me [AND ...extra]` — the default predicate for every read, update and delete. */
  own(table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
    return and(eq(table.tenantId, this.tenantId), ...extra)!;
  }

  /**
   * `(tenant_id IS NULL OR tenant_id = :me) [AND ...extra]` — the two-tier content pools
   * (`flashcardTopics`, `questions`), where NULL means the platform library every school can
   * read. Read-only semantics: a write to a library row is refused in the service, because
   * "can see it" and "may edit it" are different questions.
   */
  pool(table: TenantTable, ...extra: (SQL | undefined)[]): SQL {
    return and(or(isNull(table.tenantId), eq(table.tenantId, this.tenantId)), ...extra)!;
  }

  /**
   * The only sanctioned insert into a tenant table. `tenantId` is stripped from the caller's
   * row type and supplied here, so a junction row can never disagree with its parent and a new
   * row can never land in the wrong school.
   */
  insert<T extends TenantTable>(table: T) {
    return {
      values: (rows: InsertRow<T> | InsertRow<T>[]) =>
        this.raw.insert(table).values(
          (Array.isArray(rows) ? rows : [rows]).map((r) => ({
            ...r,
            tenantId: this.tenantId,
          })) as T['$inferInsert'][],
        ),
    };
  }

  /**
   * Scoped update. `extra` is where the row key goes — `db.update(classes, { name }, eq(classes.id, id))`
   * — so the school predicate cannot be dropped by forgetting a `.where`.
   */
  update<T extends TenantTable>(
    table: T,
    set: Partial<T['$inferInsert']>,
    ...extra: (SQL | undefined)[]
  ) {
    return this.raw
      .update(table)
      .set(set)
      .where(this.own(table, ...extra));
  }

  /** Scoped delete, same shape as `update`. */
  delete<T extends TenantTable>(table: T, ...extra: (SQL | undefined)[]) {
    return this.raw.delete(table).where(this.own(table, ...extra));
  }

  /**
   * Unchanged from the bare handle — the wrappers above return ordinary batch items, so an
   * atomic multi-statement write reads exactly as it did before scoping.
   *
   * Bound as an arrow property rather than a method so `this` survives destructuring, and cast
   * through `unknown` because drizzle's generic batch signature (a readonly tuple in, a mapped
   * tuple out) cannot be expressed by a forwarding wrapper.
   */
  batch: Db['batch'] = ((items: Parameters<Db['batch']>[0]) =>
    this.raw.batch(items)) as unknown as Db['batch'];
}

/** Build a scoped handle for the acting user. The normal way a loader or action gets a db. */
export const tenantDbFor = (env: Env, user: { tenantId: string }) =>
  new TenantDb(createRawDb(env), user.tenantId);
