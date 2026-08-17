import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import { accounts, activityLog, sessions, staff } from '../server/db/schema';
import {
  auditALS,
  flush,
  newRequestStore,
  newSystemStore,
  purgeExpiredSessions,
  purgeOldLogs,
  record,
  recordCreate,
  recordDelete,
  auditedUpdate,
  hasCrudEntry,
  setActor,
  snapshotJson,
} from '../server/services/audit';

/**
 * Core audit module, against real D1 (miniflare). What can't be checked from `test/`: the actual
 * chunked insert (D1's 100-bound-param ceiling), the retention purge's SQL, and that everything
 * behaves under a real AsyncLocalStorage instance rather than a mock.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

function fakeUser(overrides = {}) {
  return {
    kind: 'staff',
    account: { id: 'acc-1', email: 'a@b.com' },
    user: { id: 'staff-1', name: 'Staff One', role: 'Teacher', color: 'orange', phone: null },
    ...overrides,
  };
}

async function countRows(d) {
  const rows = await d.raw.select({ id: activityLog.id }).from(activityLog);
  return rows.length;
}

describe('record() and the ambient store', () => {
  it('is a silent no-op with no ALS scope', () => {
    expect(() => record({ action: 'mutation' })).not.toThrow();
  });

  it('buffers entries only inside auditALS.run', () => {
    const store = newRequestStore(new Request('https://x/test'));
    auditALS.run(store, () => {
      record({ action: 'view', route: '/dashboard' });
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({ action: 'view', route: '/dashboard' });
  });

  it('setActor sets kind/id/name/accountId/sessionRef, and is a no-op on a system store', () => {
    const store = newRequestStore(new Request('https://x/test'));
    auditALS.run(store, () => setActor(fakeUser(), 'sess1234abcd5678'));
    expect(store.actor).toEqual({
      kind: 'staff',
      id: 'staff-1',
      name: 'Staff One',
      accountId: 'acc-1',
      sessionRef: 'sess1234abcd5678',
    });

    const sysStore = newSystemStore('cron', '0 1 * * *');
    auditALS.run(sysStore, () => setActor(fakeUser(), 'x'));
    expect(sysStore.actor.kind).toBe('system'); // untouched
  });

  it('hasCrudEntry: true only once a create/update/delete entry lands', () => {
    const store = newRequestStore(new Request('https://x/test'));
    auditALS.run(store, () => {
      expect(hasCrudEntry()).toBe(false);
      record({ action: 'view' });
      expect(hasCrudEntry()).toBe(false); // views don't count
      record({ action: 'update', entityType: 'student', entityId: 's1' });
      expect(hasCrudEntry()).toBe(true);
    });
  });
});

describe('snapshotJson', () => {
  it('passes small objects through unredacted', () => {
    const json = snapshotJson({ name: 'Ada', age: 10 });
    expect(JSON.parse(json)).toEqual({ name: 'Ada', age: 10 });
  });

  it('returns null for null/undefined', () => {
    expect(snapshotJson(null)).toBeNull();
    expect(snapshotJson(undefined)).toBeNull();
  });

  it('redacts any key matching /password|token|secret|hash/i, recursively', () => {
    const json = snapshotJson({
      passwordHash: 'abc',
      apiSecret: 'xyz',
      nested: { authToken: 'zzz', ok: 'fine' },
    });
    const parsed = JSON.parse(json);
    expect(parsed.passwordHash).toBe('[redacted]');
    expect(parsed.apiSecret).toBe('[redacted]');
    expect(parsed.nested.authToken).toBe('[redacted]');
    expect(parsed.nested.ok).toBe('fine');
  });

  it('drops the longest string values first when over the 8 KB cap', () => {
    const big = 'x'.repeat(9000);
    const small = 'kept';
    const json = snapshotJson({ big, small });
    expect(json.length).toBeLessThanOrEqual(8 * 1024);
    const parsed = JSON.parse(json);
    expect(parsed.big).toBe('[truncated]');
    expect(parsed.small).toBe('kept');
  });

  it('falls back to a __truncated stub for a circular object, and never throws', () => {
    const circular = { a: 1 };
    circular.self = circular;
    let json;
    expect(() => {
      json = snapshotJson(circular);
    }).not.toThrow();
    expect(JSON.parse(json)).toMatchObject({ __truncated: true });
  });

  it('always returns valid JSON, even for the over-cap fallback', () => {
    const obj = {};
    for (let i = 0; i < 50; i++) obj[`k${i}`] = 'y'.repeat(1000);
    const json = snapshotJson(obj);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('flush()', () => {
  it('inserts every entry, chunked under the 100-bound-param cap (250 entries, 21 columns)', async () => {
    const d = db();
    const before = await countRows(d);
    const store = newRequestStore(new Request('https://x/logs-test-flush'));
    store.actor = {
      kind: 'staff',
      id: 'staff-flush',
      name: 'Flush Tester',
      accountId: 'acc-flush',
      sessionRef: null,
    };
    for (let i = 0; i < 250; i++) {
      store.entries.push({ action: 'view', route: `/page-${i}` });
    }
    await flush(d.raw, store);
    const after = await countRows(d);
    expect(after - before).toBe(250);
  });

  it('is a no-op for an empty store', async () => {
    const d = db();
    const before = await countRows(d);
    await flush(d.raw, newRequestStore(new Request('https://x/empty')));
    expect(await countRows(d)).toBe(before);
  });

  it('never throws even if the db write fails', async () => {
    const store = newRequestStore(new Request('https://x/broken'));
    store.entries.push({ action: 'mutation' });
    const brokenDb = {
      insert: () => ({ values: () => ({}) }),
      batch: async () => {
        throw new Error('boom');
      },
    };
    await expect(flush(brokenDb, store)).resolves.toBeUndefined();
  });

  it('falls back to actor_kind=anon when no actor was ever set', async () => {
    const d = db();
    const store = newRequestStore(new Request('https://x/anon-flush'));
    store.entries.push({ action: 'login_failed', meta: { email: 'nobody@x.com' } });
    await flush(d.raw, store);
    const rows = await d.raw
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, 'login_failed'))
      .orderBy(activityLog.id);
    const row = rows[rows.length - 1];
    expect(row.actorKind).toBe('anon');
    expect(JSON.parse(row.metaJson)).toEqual({ email: 'nobody@x.com' });
  });
});

describe('purgeOldLogs', () => {
  // The suite has no per-test cleanup (isolated storage per FILE, not per test — see the module
  // doc comment), and other describes in this file insert real-now-timestamped rows that are
  // never "old" relative to a 2026-06 `now`. Every row here carries a unique `route` marker so
  // assertions can scope to exactly what this test seeded, ignoring everything else in the table.
  async function seedRow(d, recordedAt, route) {
    await d.insert(activityLog).values({
      occurredAt: recordedAt,
      recordedAt,
      source: 'web',
      actorKind: 'anon',
      action: 'view',
      route,
    });
  }

  it('deletes only rows older than RETENTION_DAYS, and respects the batch/iteration caps', async () => {
    const d = db();
    const now = new Date('2026-06-01T00:00:00.000Z');
    const old = new Date(now.getTime() - 91 * 86_400_000).toISOString();
    const recent = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    const marker = `/purge-test-${crypto.randomUUID()}`;

    for (let i = 0; i < 3; i++) await seedRow(d, old, marker);
    for (let i = 0; i < 2; i++) await seedRow(d, recent, marker);

    await purgeOldLogs(d.raw, now);

    const remaining = await d.raw.select().from(activityLog).where(eq(activityLog.route, marker));
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.recordedAt === recent)).toBe(true);
  });

  it('returns 0 and deletes nothing when everything is within retention', async () => {
    const d = db();
    const now = new Date('2026-06-02T00:00:00.000Z');
    const marker = `/purge-test-${crypto.randomUUID()}`;
    await seedRow(d, new Date(now.getTime() - 1 * 86_400_000).toISOString(), marker);
    const deleted = await purgeOldLogs(d.raw, now);
    expect(deleted).toBe(0);
    const remaining = await d.raw.select().from(activityLog).where(eq(activityLog.route, marker));
    expect(remaining).toHaveLength(1);
  });
});

describe('purgeExpiredSessions', () => {
  it('deletes sessions past their expiry and leaves live ones alone', async () => {
    const d = db();
    const now = new Date('2026-06-01T00:00:00.000Z');
    const accountId = crypto.randomUUID();
    await d.insert(accounts).values({
      id: accountId,
      email: `purge-${accountId}@test.com`,
      passwordHash: 'x',
      createdAt: now.toISOString(),
    });
    const liveToken = crypto.randomUUID();
    await d.raw.insert(sessions).values([
      { token: crypto.randomUUID(), accountId, expiresAt: '2026-05-01T00:00:00.000Z' },
      { token: crypto.randomUUID(), accountId, expiresAt: '2026-05-31T23:59:59.000Z' },
      { token: liveToken, accountId, expiresAt: '2026-07-01T00:00:00.000Z' },
    ]);

    await purgeExpiredSessions(d.raw, now);

    const remaining = await d.raw.select().from(sessions).where(eq(sessions.accountId, accountId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].token).toBe(liveToken);
  });
});

describe('precise-capture helpers', () => {
  async function seedStaffRow(d) {
    const id = crypto.randomUUID();
    await d.insert(staff).values({ id, name: 'Precise Test', role: 'Teacher', color: 'blue' });
    return id;
  }

  it('recordCreate pushes an after-only create entry', () => {
    const store = newRequestStore(new Request('https://x/create'));
    auditALS.run(store, () => recordCreate('staff', 's1', { id: 's1', name: 'New' }));
    expect(store.entries).toEqual([
      { action: 'create', entityType: 'staff', entityId: 's1', after: { id: 's1', name: 'New' } },
    ]);
  });

  it('recordDelete reads the row before deleting and records a before-only delete entry', async () => {
    const d = db();
    const id = await seedStaffRow(d);
    const store = newRequestStore(new Request('https://x/delete'));
    await auditALS.run(store, async () => {
      await recordDelete(d, 'staff', staff, id, { classIds: ['c1'] });
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].action).toBe('delete');
    expect(store.entries[0].before).toMatchObject({ id, name: 'Precise Test', classIds: ['c1'] });
  });

  it('recordDelete is a silent no-op when the row is already gone', async () => {
    const d = db();
    const store = newRequestStore(new Request('https://x/delete-missing'));
    await auditALS.run(store, async () => {
      await recordDelete(d, 'staff', staff, 'does-not-exist');
    });
    expect(store.entries).toHaveLength(0);
  });

  it('auditedUpdate records before/after around the mutation', async () => {
    const d = db();
    const id = await seedStaffRow(d);
    const store = newRequestStore(new Request('https://x/update'));
    await auditALS.run(store, async () => {
      await auditedUpdate(d, 'staff', staff, id, async () => {
        await d.raw.update(staff).set({ name: 'Renamed' }).where(eq(staff.id, id));
      });
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].action).toBe('update');
    expect(store.entries[0].before.name).toBe('Precise Test');
    expect(store.entries[0].after.name).toBe('Renamed');
  });

  it('auditedUpdate skips recording when the mutation was a real no-op', async () => {
    const d = db();
    const id = await seedStaffRow(d);
    const store = newRequestStore(new Request('https://x/update-noop'));
    await auditALS.run(store, async () => {
      await auditedUpdate(d, 'staff', staff, id, async () => {
        // No actual write — before and after are identical.
      });
    });
    expect(store.entries).toHaveLength(0);
  });
});

describe('wrapper dedupe primitive', () => {
  // withLiveAction/withAuth (Stage 2) push a coarse `mutation` row ONLY when hasCrudEntry() is
  // false at the end of the action — this pins the primitive they rely on.
  it('a precise CRUD entry suppresses the need for a coarse fallback', () => {
    const store = newRequestStore(new Request('https://x/dedupe'));
    auditALS.run(store, () => {
      recordCreate('student', 's1', { id: 's1' });
      if (!hasCrudEntry()) record({ action: 'mutation' });
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].action).toBe('create');
  });

  it('no precise entry falls back to a coarse mutation row', () => {
    const store = newRequestStore(new Request('https://x/dedupe-fallback'));
    auditALS.run(store, () => {
      if (!hasCrudEntry()) record({ action: 'mutation' });
    });
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].action).toBe('mutation');
  });
});
