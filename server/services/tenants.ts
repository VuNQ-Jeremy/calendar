import { and, count, eq, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../db';
import { accounts, classes, sessions, staff, students, tenants } from '../db/schema';
import { hashPassword } from './crypto';
import { attributeAccount, record } from './audit';
import { seedTenantDefaults } from './tenant-defaults';

/**
 * Schools, and the platform-admin operations on them.
 *
 * Everything here takes a raw `Db` rather than a `TenantDb`, and that is the point: these are
 * the operations that create a school, list every school, or move a platform admin between
 * them. They are the only service allowed to see across the boundary, which is why the file is
 * small and why `requirePlatformAdmin` guards every caller but signup.
 */

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  verified: boolean;
  createdAt: string;
  staffCount: number;
  studentCount: number;
  classCount: number;
};

/**
 * A URL-safe handle from a school name. Vietnamese diacritics are decomposed and stripped
 * rather than transliterated, so "Trung tâm Anh ngữ Hoa Mai" becomes "trung-tam-anh-ngu-hoa-mai".
 * Purely internal today — there is no subdomain routing — but it makes /platform and R2 keys
 * readable, and it is the thing a vanity URL would be built on later.
 */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'school';
}

/** `slugify` plus a numeric suffix until it is free. Two "Hoa Mai"s are a normal thing. */
export async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const hit = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, candidate))
      .limit(1);
    if (!hit.length) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export type CreateTenantInput = {
  schoolName: string;
  adminName: string;
  email: string;
  password: string;
};

/**
 * Create a school, its first Admin, that admin's login, and the starter defaults — as one
 * atomic batch. A half-created school (rows but no admin, or an admin who cannot sign in)
 * would be unrecoverable without database surgery, so it must not be reachable.
 *
 * The caller is responsible for having checked the email is free and for rate limiting: this
 * function is also how a platform admin provisions a school by hand, and neither of those
 * belongs in it.
 */
export async function createTenant(
  db: Db,
  input: CreateTenantInput,
): Promise<{ tenantId: string; accountId: string; staffId: string }> {
  const tenantId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = await uniqueSlug(db, input.schoolName);
  const passwordHash = await hashPassword(input.password);

  const ops: BatchItem<'sqlite'>[] = [
    db.insert(tenants).values({
      id: tenantId,
      slug,
      name: input.schoolName,
      status: 'active',
      // Every self-serve school starts unverified. Nothing is gated on it in v1 — it is the
      // flag a platform admin clears after a look, and the hook email verification will use.
      verified: false,
      createdAt: now,
    }),
    db.insert(staff).values({
      id: staffId,
      tenantId,
      name: input.adminName,
      email: input.email,
      role: 'Admin',
      color: 'orange',
    }),
    db.insert(accounts).values({
      id: accountId,
      tenantId,
      email: input.email,
      passwordHash,
      isPlatformAdmin: false,
      staffId,
      createdAt: now,
    }),
    ...seedTenantDefaults(db, tenantId),
  ];
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  attributeAccount(accountId);
  record({
    action: 'create',
    entityType: 'tenant',
    entityId: tenantId,
    after: { name: input.schoolName, slug },
  });

  return { tenantId, accountId, staffId };
}

/**
 * Every school with its headline counts, for /platform. Three grouped queries merged in JS
 * rather than three correlated subqueries per row — the list is short and this stays one round
 * trip per table however long it gets.
 */
export async function listTenantsWithCounts(db: Db): Promise<TenantRow[]> {
  // tenant-unscoped: this is the page that exists to look across schools. `requirePlatformAdmin`
  // on every caller is what makes that safe.
  const [rows, staffCounts, studentCounts, classCounts] = await db.batch([
    db.select().from(tenants),
    db.select({ tenantId: staff.tenantId, n: count() }).from(staff).groupBy(staff.tenantId),
    db
      .select({ tenantId: students.tenantId, n: count() })
      .from(students)
      .groupBy(students.tenantId),
    db.select({ tenantId: classes.tenantId, n: count() }).from(classes).groupBy(classes.tenantId),
  ]);

  const byTenant = (list: { tenantId: string; n: number }[]) =>
    new Map(list.map((r) => [r.tenantId, r.n]));
  const staffMap = byTenant(staffCounts);
  const studentMap = byTenant(studentCounts);
  const classMap = byTenant(classCounts);

  return rows
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      verified: t.verified,
      createdAt: t.createdAt,
      staffCount: staffMap.get(t.id) ?? 0,
      studentCount: studentMap.get(t.id) ?? 0,
      classCount: classMap.get(t.id) ?? 0,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getTenant(db: Db, id: string): Promise<typeof tenants.$inferSelect | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Suspend or reactivate a school. Suspension is enforced in `userFromToken`, so it takes effect
 * on the next request every member makes rather than whenever their cookie happens to expire.
 */
export async function setTenantStatus(
  db: Db,
  id: string,
  status: 'active' | 'suspended',
): Promise<void> {
  await db.update(tenants).set({ status }).where(eq(tenants.id, id));
  record({ action: 'update', entityType: 'tenant', entityId: id, after: { status } });
}

export async function setTenantVerified(db: Db, id: string, verified: boolean): Promise<void> {
  await db.update(tenants).set({ verified }).where(eq(tenants.id, id));
  record({ action: 'update', entityType: 'tenant', entityId: id, after: { verified } });
}

/**
 * Point THIS session at another school, or back home when `tenantId` is null.
 *
 * Written on the session row rather than a second cookie so the mobile bearer path gets it for
 * free and each device switches independently. The `isPlatformAdmin` guard here is belt and
 * braces — `userFromToken` ignores the override for anyone else regardless — but a row that
 * cannot be written wrongly is easier to reason about than one that is merely ignored.
 */
export async function setActiveTenant(
  db: Db,
  sessionTokenHash: string,
  accountId: string,
  tenantId: string | null,
): Promise<void> {
  // tenant-unscoped: an account is looked up by its own id to decide whether it may cross the
  // boundary at all — scoping the check to the school it is trying to leave would be circular.
  const acct = await db
    .select({ isPlatformAdmin: accounts.isPlatformAdmin })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acct[0]?.isPlatformAdmin) return;
  await db
    .update(sessions)
    .set({ activeTenantId: tenantId })
    .where(eq(sessions.token, sessionTokenHash));
  record({
    action: 'mutation',
    entityType: 'tenant',
    entityId: tenantId ?? 'home',
    meta: { intent: tenantId ? 'tenant_enter' : 'tenant_exit' },
  });
}

/** Schools a cron sweep should visit — suspended ones are skipped, not merely filtered later. */
export async function listActiveTenantIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(ne(tenants.status, 'suspended'));
  return rows.map((r) => r.id);
}
