import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { Db } from '../db/index';
import type { ScrollbarStyle, TabBarStyle } from '../../shared/schemas';
import { record } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type UiPrefs = { scrollbar: ScrollbarStyle; mobileTabBar: TabBarStyle };

export const DEFAULT_UI_PREFS: UiPrefs = { scrollbar: 'slim', mobileTabBar: 'pill' };

export async function getUiPrefs(db: Db): Promise<UiPrefs> {
  const rows = await db.select().from(settings).where(eq(settings.key, 'ui-prefs'));
  const row = rows[0];
  if (!row) return { ...DEFAULT_UI_PREFS };
  try {
    return { ...DEFAULT_UI_PREFS, ...(JSON.parse(row.value) as Partial<UiPrefs>) };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export async function setUiPrefs(db: Db, patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const current = await getUiPrefs(db);
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: 'ui-prefs', value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: 'ui-prefs',
      before: current,
      after: next,
    });
  }
  return next;
}
