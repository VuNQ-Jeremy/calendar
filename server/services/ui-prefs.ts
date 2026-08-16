import type { Db } from '../db/index';
import type { ScrollbarStyle, TabBarStyle } from '../../shared/schemas';
import { record } from './audit';
import { deleteJson, readJson, readSchoolJson, writeJson, writeSchoolJson } from './user-settings';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * How the UI looks — a school default that any account may override for itself.
 *
 * The split matters and is not the same arrangement as the calendar theme. Both surfaces that
 * EDIT these values are admin-gated "System Config" screens (the web's /config and the phone's
 * config tab), and they are meant to set the school's look — so they keep writing the shared
 * `settings` row through `setSchoolUiPrefs`. What migration 0043 adds is the override: an
 * individual account can store its own row, and every READ resolves override → school → default.
 *
 * That is also what makes a non-admin write safe. `/api/settings/ui-prefs` PATCH is admin-only
 * because it used to be the ONLY writer and it wrote the whole school's styling; the personal
 * override lives on its own route (`/api/settings/ui-prefs/me`) where the blast radius is one
 * account.
 */

export type UiPrefs = { scrollbar: ScrollbarStyle; mobileTabBar: TabBarStyle };

export const DEFAULT_UI_PREFS: UiPrefs = { scrollbar: 'slim', mobileTabBar: 'pill' };

export const UI_PREFS_KEY = 'ui-prefs';

/** What THIS account should actually see: its own row, else the school's, else the default. */
export async function getUiPrefs(db: Db, accountId: string): Promise<UiPrefs> {
  return readJson(db, accountId, UI_PREFS_KEY, DEFAULT_UI_PREFS);
}

/** Store a personal override. Never touches the school row. */
export async function setUiPrefs(
  db: Db,
  accountId: string,
  patch: Partial<UiPrefs>,
): Promise<UiPrefs> {
  const current = await getUiPrefs(db, accountId);
  const next = { ...current, ...patch };
  await writeJson(db, accountId, UI_PREFS_KEY, next);
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: UI_PREFS_KEY,
      before: current,
      after: next,
    });
  }
  return next;
}

/** Drop the personal override; this account follows the school default again. */
export async function clearUiPrefsOverride(db: Db, accountId: string): Promise<void> {
  await deleteJson(db, accountId, UI_PREFS_KEY);
  record({ action: 'update', entityType: 'setting', entityId: UI_PREFS_KEY });
}

/** The school default, as the System Config screens present it. */
export async function getSchoolUiPrefs(db: Db): Promise<UiPrefs> {
  return readSchoolJson(db, UI_PREFS_KEY, DEFAULT_UI_PREFS);
}

export async function setSchoolUiPrefs(db: Db, patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const current = await getSchoolUiPrefs(db);
  const next = { ...current, ...patch };
  await writeSchoolJson(db, UI_PREFS_KEY, next);
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: UI_PREFS_KEY,
      before: current,
      after: next,
    });
  }
  return next;
}
