import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/theme';
import type { Theme } from '../../server/services/theme';
import { ThemeInput } from '../../shared/schemas';

/** Calendar theme, stored in the `settings` k/v table. Mirrors `intent=theme`. */
export const loader = withAuth('staff', ({ db }) => svc.getTheme(db));

export const action = withAuth('staff', async ({ request, db }) => {
  const parsed = await parsePatchBody(request, ThemeInput);
  // ThemeInput permits null for each field, but Theme's values are non-nullable — a null
  // means "leave this one alone". Strip them, exactly as calendar.tsx:58-60 does.
  const patch = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v != null),
  ) as Partial<Theme>;
  return svc.setTheme(db, patch);
});
