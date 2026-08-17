import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import { activityLog, accounts, sessions } from '../server/db/schema';
import {
  listActivity,
  entityHistory,
  securityOverview,
  listAccountsForFilter,
} from '../server/services/audit-views';

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seed(d, overrides = {}) {
  await d.insert(activityLog).values({
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    source: 'web',
    actorKind: 'anon',
    action: 'view',
    ...overrides,
  });
}

describe('listActivity', () => {
  it('paginates in reverse-chronological order with a cursor, and reports nextCursor correctly', async () => {
    const d = db();
    const marker = `/views-test-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) await seed(d, { route: marker });

    const page1 = await listActivity(d, { limit: 2 });
    const scoped1 = page1.rows.filter((r) => r.route === marker);
    // Global stream, so other tests' rows may interleave — just check ordering and cursor shape.
    expect(page1.rows.length).toBe(2);
    expect(page1.rows[0].id).toBeGreaterThan(page1.rows[1].id);
    expect(page1.nextCursor).toBe(page1.rows[1].id);
    expect(scoped1.length).toBeLessThanOrEqual(2);

    const page2 = await listActivity(d, { limit: 2, beforeId: page1.nextCursor });
    expect(page2.rows.every((r) => r.id < page1.nextCursor)).toBe(true);
  });

  it('filters by route (as a stand-in for any equality filter) and parses JSON snapshots', async () => {
    const d = db();
    const marker = `/views-test-filter-${crypto.randomUUID()}`;
    await seed(d, {
      route: marker,
      action: 'update',
      entityType: 'student',
      entityId: 's1',
      beforeJson: JSON.stringify({ name: 'Old' }),
      afterJson: JSON.stringify({ name: 'New' }),
    });

    const { rows } = await listActivity(d, { entityType: 'student', entityId: 's1' });
    const row = rows.find((r) => r.route === marker);
    expect(row).toBeDefined();
    expect(row.before).toEqual({ name: 'Old' });
    expect(row.after).toEqual({ name: 'New' });
  });
});

describe('entityHistory', () => {
  it('returns only rows for the given entity, most recent first', async () => {
    const d = db();
    const entityId = crypto.randomUUID();
    await seed(d, {
      action: 'create',
      entityType: 'material',
      entityId,
      recordedAt: '2026-01-01T00:00:00.000Z',
      occurredAt: '2026-01-01T00:00:00.000Z',
    });
    await seed(d, {
      action: 'update',
      entityType: 'material',
      entityId,
      recordedAt: '2026-01-02T00:00:00.000Z',
      occurredAt: '2026-01-02T00:00:00.000Z',
    });
    await seed(d, {
      action: 'delete',
      entityType: 'material',
      entityId,
      recordedAt: '2026-01-03T00:00:00.000Z',
      occurredAt: '2026-01-03T00:00:00.000Z',
    });
    // Unrelated row, same entityType different id — must not leak in.
    await seed(d, { action: 'create', entityType: 'material', entityId: crypto.randomUUID() });

    const history = await entityHistory(d, 'material', entityId);
    expect(history.map((r) => r.action)).toEqual(['delete', 'update', 'create']);
  });
});

describe('securityOverview', () => {
  async function seedAccount(d) {
    const id = crypto.randomUUID();
    await d.insert(accounts).values({
      id,
      email: `sec-${id}@test.com`,
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  it('collapses an account to one row and flags two distinct ips as concurrent', async () => {
    const d = db();
    const accountId = await seedAccount(d);
    const future = new Date(Date.now() + 3600_000).toISOString();
    await d.raw.insert(sessions).values([
      {
        token: crypto.randomUUID(),
        accountId,
        expiresAt: future,
        ip: '1.1.1.1',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      {
        token: crypto.randomUUID(),
        accountId,
        expiresAt: future,
        ip: '2.2.2.2',
        createdAt: '2026-08-02T00:00:00.000Z',
      },
    ]);

    const { activeSessions } = await securityOverview(d, new Date());
    // Scope to THIS test's account: storage is isolated per file, not per test.
    const mine = activeSessions.filter((s) => s.accountEmail === `sec-${accountId}@test.com`);
    expect(mine).toHaveLength(1);
    expect(mine[0].sessions).toBe(2);
    expect(mine[0].concurrent).toBe(true);
    // Newest session's telemetry represents the account.
    expect(mine[0].ip).toBe('2.2.2.2');
  });

  it('does not call an account concurrent on repeat logins from one ip, and keeps known telemetry over legacy nulls', async () => {
    const d = db();
    const accountId = await seedAccount(d);
    const future = new Date(Date.now() + 3600_000).toISOString();
    await d.raw.insert(sessions).values([
      // A row predating the ip/user_agent columns — must not blank out what we do know.
      { token: crypto.randomUUID(), accountId, expiresAt: future },
      {
        token: crypto.randomUUID(),
        accountId,
        expiresAt: future,
        ip: '3.3.3.3',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      {
        token: crypto.randomUUID(),
        accountId,
        expiresAt: future,
        ip: '3.3.3.3',
        createdAt: '2026-08-02T00:00:00.000Z',
      },
    ]);

    const { activeSessions } = await securityOverview(d, new Date());
    // Scope to THIS test's account: storage is isolated per file, not per test.
    const mine = activeSessions.filter((s) => s.accountEmail === `sec-${accountId}@test.com`);
    expect(mine).toHaveLength(1);
    expect(mine[0].sessions).toBe(3);
    expect(mine[0].concurrent).toBe(false);
    expect(mine[0].ip).toBe('3.3.3.3');
  });

  it('flags a login from a genuinely new (account, ip) pair, and not a repeat one', async () => {
    const d = db();
    const accountId = await seedAccount(d);
    const now = new Date('2026-07-01T00:00:00.000Z');
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`;

    // A login well outside the 14-day window, at this same ip — the later one must NOT count as new.
    await seed(d, {
      action: 'login',
      accountId,
      ip,
      recordedAt: '2026-01-01T00:00:00.000Z',
      occurredAt: '2026-01-01T00:00:00.000Z',
      metaJson: JSON.stringify({ email: 'old@test.com' }),
    });
    await seed(d, {
      action: 'login',
      accountId,
      ip,
      recordedAt: '2026-06-25T00:00:00.000Z',
      occurredAt: '2026-06-25T00:00:00.000Z',
      metaJson: JSON.stringify({ email: 'old@test.com' }),
    });

    // A genuinely new ip for a DIFFERENT account, inside the window.
    const account2 = await seedAccount(d);
    const newIp = `10.0.1.${Math.floor(Math.random() * 255)}`;
    await seed(d, {
      action: 'login',
      accountId: account2,
      ip: newIp,
      recordedAt: '2026-06-28T00:00:00.000Z',
      occurredAt: '2026-06-28T00:00:00.000Z',
      metaJson: JSON.stringify({ email: 'new@test.com' }),
    });

    const { newIps } = await securityOverview(d, now);
    expect(newIps.some((r) => r.accountId === accountId && r.ip === ip)).toBe(false);
    expect(newIps.some((r) => r.accountId === account2 && r.ip === newIp)).toBe(true);
  });
});

describe('listAccountsForFilter', () => {
  it('returns a sorted, deduped label per account', async () => {
    const d = db();
    const id = crypto.randomUUID();
    await d.insert(accounts).values({
      id,
      email: `list-${id}@test.com`,
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    const rows = await listAccountsForFilter(d);
    const mine = rows.find((r) => r.id === id);
    expect(mine).toBeDefined();
    expect(mine.label).toContain(`list-${id}@test.com`);
  });
});
