import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { Db } from '../db/index';
import { studentIdsOfParent } from './people';
import { record } from './audit';

/**
 * The parent portal: whether a signed-in parent gets anything beyond /profile.
 *
 * Parents have been able to sign in since v0.0156; this flag decides whether the children
 * screens exist for them. It is NOT a login switch — turning it off returns a parent to the
 * profile-only app they have today, it never locks anyone out of an account they already have.
 *
 * Lives in the same school-wide `settings` k/v table as the theme and the UI prefs, with the
 * same limitation: one school, one setting, no per-family rollout. Defaults to OFF so the
 * portal ships dark and an admin opens it deliberately.
 */

export type ParentPortalSettings = { enabled: boolean };

export const DEFAULT_PARENT_PORTAL: ParentPortalSettings = { enabled: false };

const KEY = 'parent-portal';

export async function getParentPortal(db: Db): Promise<ParentPortalSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, KEY));
  const row = rows[0];
  if (!row) return { ...DEFAULT_PARENT_PORTAL };
  try {
    return {
      ...DEFAULT_PARENT_PORTAL,
      ...(JSON.parse(row.value) as Partial<ParentPortalSettings>),
    };
  } catch {
    return { ...DEFAULT_PARENT_PORTAL };
  }
}

export async function setParentPortal(
  db: Db,
  patch: Partial<ParentPortalSettings>,
): Promise<ParentPortalSettings> {
  const current = await getParentPortal(db);
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  // A toggle that gates a whole family's access to their children's data — worth a full row
  // even though it's a one-boolean setting.
  if (current.enabled !== next.enabled) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: KEY,
      before: current,
      after: next,
    });
  }
  return next;
}

/**
 * The one authorization rule of the whole portal, in two shapes.
 *
 * Every parent-facing read passes through here, because "is the portal on" and "is this my
 * child" are the same question asked twice and forgetting either one leaks another family's
 * data. A parent's own row carries the answer: `parent_students` IS the authorization set.
 *
 * Both throw a JSON 403 rather than redirecting, so the same helper serves the document
 * routes (report card, fee slip) and the bearer API. Page loaders that want a friendlier
 * bounce catch it and redirect to /profile instead.
 */

/** @throws {Response} 403 when the portal is disabled. */
export async function portalChildIds(db: Db, parentId: string): Promise<string[]> {
  const { enabled } = await getParentPortal(db);
  if (!enabled) throw Response.json({ error: 'forbidden' }, { status: 403 });
  return studentIdsOfParent(db, parentId);
}

/** @throws {Response} 403 when the portal is disabled or `studentId` is another family's child. */
export async function portalChild(db: Db, parentId: string, studentId: string): Promise<void> {
  const ids = await portalChildIds(db, parentId);
  if (!ids.includes(studentId)) throw Response.json({ error: 'forbidden' }, { status: 403 });
}
