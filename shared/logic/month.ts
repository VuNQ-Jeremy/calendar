/**
 * Month ('YYYY-MM') helpers, shared by the web app and the mobile app.
 *
 * These lived in `shared/logic/tuition.ts` until the assessments month filter needed them too.
 * They had to move: tuition.ts type-imports `server/services/tuition`, which drags the Workers
 * types into anything that touches it, and React Native cannot follow that graph. Same reason
 * `shared/logic/assess.ts` exists. No React, no DOM, no `server/` imports.
 *
 * tuition.ts re-exports both names, so every existing import keeps working.
 */

import { getCal } from '../i18n/strings';

/**
 * '2026-03' -> 'March 2026' / 'Tháng 3 2026', reusing the calendar's own month names so the two
 * screens never disagree about what to call a month.
 */
export function monthLabel(month: string, lang: string): string {
  const { months } = getCal(lang);
  const [year, monthNo] = month.split('-');
  return `${months[Number(monthNo) - 1] ?? monthNo} ${year}`;
}

/** '2026-03' + 1 -> '2026-04'. Plain string math; no Date, so no timezone can get involved. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const zeroBased = y * 12 + (m - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const monthNo = (zeroBased % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(monthNo).padStart(2, '0')}`;
}
