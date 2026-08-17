import type { TenantDb } from '../db/index';
import type { CalendarView } from '../../shared/schemas';
import { record } from './audit';
import { readJson, writeJson } from './user-settings';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export const DEFAULT_THEME = {
  bg: '#FFFCF8',
  gridLine: '#ECE0CF',
  today: '#FFE7D1',
  header: '#FDF6EC',
  bgImage: '',
  bgOpacity: 0.12,
  // Which view the calendar opens in (F-22). Rows written before this key existed fall back to
  // it through the `{ ...default, ...stored }` merge in readJson.
  defaultView: 'week' as CalendarView,
};

export type Theme = typeof DEFAULT_THEME;

/**
 * The key in BOTH tables: `user_settings` holds one row per account, and the legacy `settings`
 * row of the same name is the school default anyone who has never customised still sees.
 * Nothing writes that global row any more.
 */
export const THEME_KEY = 'theme';

export async function getTheme(db: TenantDb, accountId: string): Promise<Theme> {
  return readJson(db, accountId, THEME_KEY, DEFAULT_THEME);
}

export async function setTheme(
  db: TenantDb,
  accountId: string,
  patch: Partial<Theme>,
): Promise<Theme> {
  const current = await getTheme(db, accountId);
  const next = { ...current, ...patch };
  await writeJson(db, accountId, THEME_KEY, next);
  if (!sameJson(current, next)) {
    // entityId stays 'theme': the audit row already carries the actor, which is now the only
    // thing distinguishing one person's recolour from another's.
    record({
      action: 'update',
      entityType: 'setting',
      entityId: THEME_KEY,
      before: current,
      after: next,
    });
  }
  return next;
}
