import { eq } from 'drizzle-orm';
import { settings } from '../db/schema';
import type { Db } from '../db/index';
import { record } from './audit';

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
};

export type Theme = typeof DEFAULT_THEME;

export async function getTheme(db: Db): Promise<Theme> {
  const rows = await db.select().from(settings).where(eq(settings.key, 'theme'));
  const row = rows[0];
  if (!row) return { ...DEFAULT_THEME };
  try {
    return { ...DEFAULT_THEME, ...(JSON.parse(row.value) as Partial<Theme>) };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export async function setTheme(db: Db, patch: Partial<Theme>): Promise<Theme> {
  const current = await getTheme(db);
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: 'theme', value: JSON.stringify(next) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(next) } });
  if (!sameJson(current, next)) {
    record({
      action: 'update',
      entityType: 'setting',
      entityId: 'theme',
      before: current,
      after: next,
    });
  }
  return next;
}
