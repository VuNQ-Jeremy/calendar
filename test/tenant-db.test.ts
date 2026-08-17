import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../server/db/schema';
import { TenantDb } from '../server/db/tenant';
import { classes, flashcardTopics, settings } from '../server/db/schema';

/**
 * The wrapper is the whole enforcement story for multi-tenancy, so its generated SQL is worth
 * asserting directly rather than only through the services that use it. Building a query and
 * calling `.toSQL()` never touches the D1 binding, so a stub client is enough.
 */
const raw = drizzle({} as D1Database, { schema });
const db = new TenantDb(raw, 'tnt_test_0001');

describe('TenantDb', () => {
  it('own() fences a read to the acting school', () => {
    const q = raw.select().from(classes).where(db.own(classes)).toSQL();
    expect(q.sql).toMatch(/"tenant_id" = \?/);
    expect(q.params).toContain('tnt_test_0001');
  });

  it('own() keeps the caller’s own predicates alongside the fence', () => {
    const q = raw
      .select()
      .from(classes)
      .where(db.own(classes, eq(classes.id, 'c1')))
      .toSQL();
    expect(q.sql).toMatch(/"tenant_id" = \?/);
    expect(q.params).toEqual(expect.arrayContaining(['tnt_test_0001', 'c1']));
  });

  it('pool() reads the platform library as well as the school’s own rows', () => {
    const q = raw.select().from(flashcardTopics).where(db.pool(flashcardTopics)).toSQL();
    // NULL tenant_id is the shared library; the school's own rows are the other half.
    expect(q.sql.toLowerCase()).toContain('is null');
    expect(q.sql.toLowerCase()).toContain(' or ');
    expect(q.params).toContain('tnt_test_0001');
  });

  it('insert() stamps the school on a single row', () => {
    const q = db.insert(classes).values({ id: 'c9', name: 'E2E', color: 'green' }).toSQL();
    expect(q.params).toContain('tnt_test_0001');
  });

  it('insert() stamps the school on every row of a bulk insert', () => {
    const q = db
      .insert(classes)
      .values([
        { id: 'c1', name: 'A', color: 'green' },
        { id: 'c2', name: 'B', color: 'blue' },
      ])
      .toSQL();
    // Once per row — a junction row that disagreed with its parent is the bug this prevents.
    expect(q.params.filter((p) => p === 'tnt_test_0001')).toHaveLength(2);
  });

  it('update() cannot be written without the fence', () => {
    const q = db.update(classes, { name: 'Renamed' }, eq(classes.id, 'c1')).toSQL();
    expect(q.sql).toMatch(/"tenant_id" = \?/);
    expect(q.params).toEqual(expect.arrayContaining(['Renamed', 'tnt_test_0001', 'c1']));
  });

  it('delete() cannot be written without the fence', () => {
    const q = db.delete(classes, eq(classes.id, 'c1')).toSQL();
    expect(q.sql).toMatch(/"tenant_id" = \?/);
    expect(q.params).toEqual(expect.arrayContaining(['tnt_test_0001', 'c1']));
  });

  it('scopes the settings singleton, whose key alone used to be the primary key', () => {
    const q = raw
      .select()
      .from(settings)
      .where(db.own(settings, eq(settings.key, 'theme')))
      .toSQL();
    expect(q.params).toEqual(expect.arrayContaining(['tnt_test_0001', 'theme']));
  });

  it('exposes the raw handle and the school id for the excused cases', () => {
    expect(db.tenantId).toBe('tnt_test_0001');
    expect(db.raw).toBe(raw);
  });
});
