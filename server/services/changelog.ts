import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { TenantDb } from '../db/index';
import { record } from './audit';

/**
 * Which release notes this school hides from the changelog modal on /feedback.
 *
 * CHANGELOG.md is baked into the bundle at build time (src/lib/changelog.ts), so there is no
 * row for an entry and nothing to DELETE: "deleting" one means remembering its version here
 * and filtering it out on the way to the screen. The entry itself stays in the file and in
 * every build that already shipped — to make it go away for good, drop its `## v…` block from
 * CHANGELOG.md instead. Nothing derives from the file (the build number comes from the git
 * commit count), so removing a block is safe.
 *
 * School-wide, in the same k/v `settings` table as the theme and the parent portal, and with
 * the same limitation: one school, one list. Writes are admin-only — see the route — because
 * this decides what every teacher in the school reads.
 */
export const HIDDEN_KEY = 'changelog-hidden';

type Hidden = { versions: string[] };

export async function getHiddenVersions(db: TenantDb): Promise<string[]> {
  const rows = await db.raw
    .select()
    .from(settings)
    .where(db.own(settings, eq(settings.key, HIDDEN_KEY)));
  const row = rows[0];
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as Partial<Hidden>;
    // Defensive: a hand-edited row must not take the changelog modal down with it.
    return Array.isArray(parsed.versions)
      ? parsed.versions.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Hide or restore one version. Returns the new list; a no-op write is skipped. */
export async function setVersionHidden(
  db: TenantDb,
  version: string,
  hidden: boolean,
): Promise<string[]> {
  const current = await getHiddenVersions(db);
  if (current.includes(version) === hidden) return current;
  const next = hidden ? [...current, version] : current.filter((v) => v !== version);
  const value = JSON.stringify({ versions: next } satisfies Hidden);
  await db
    .insert(settings)
    .values({ key: HIDDEN_KEY, value })
    // (tenant_id, key) is the primary key — both columns, or one school's list overwrites another's.
    .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value } });
  record({
    action: 'update',
    entityType: 'setting',
    entityId: HIDDEN_KEY,
    before: { versions: current },
    after: { versions: next },
  });
  return next;
}
