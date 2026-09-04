import { translate, type LangId } from '../../shared/i18n/strings';
import { NAV } from './sidebar-nav.jsx';

/**
 * The browser tab title for a pathname — "Mochi — Feedback" for /feedback.
 *
 * The page names come from `NAV` rather than a second hand-written list, so a nav row and its
 * tab title can never drift apart: adding a page to the sidebar gives it a title for free, and
 * test/page-title.test.ts fails if a nav row ever has no resolvable label.
 *
 * Pure and DOM-free on purpose — app/root.tsx calls it from `meta` (which runs on the server
 * too) and from the client effect that re-titles the page when the language toggle flips.
 */

export const BRAND = 'Mochi';

/** Every page without a nav row, and the /logs sub-pages the single `/logs` row stands in for. */
const EXTRA: Record<string, string> = {
  '/login': 'auth_signin',
  '/signup': 'signup_title',
  '/verify-email': 'verify_email_title',
  '/profile': 'prof_title',
  '/logs/notifications': 'logs_tab_notifications',
  '/logs/activity': 'logs_tab_activity',
  '/logs/usage': 'logs_tab_usage',
};

/**
 * path → translation key for every titled page.
 *
 * `external` nav items are skipped: the only one is /docs/api, a resource route that returns
 * Scalar's own HTML document and never renders app/root.tsx, so a title here would be a lie.
 */
const PATH_KEYS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const sec of NAV) {
    for (const item of sec.items) {
      if (item.external) continue;
      map[item.path] = item.tk;
    }
  }
  // EXTRA last so a hand-written entry wins over a nav row with the same path.
  return { ...map, ...EXTRA };
})();

/**
 * The translation key for `pathname`, or null when nothing matches.
 *
 * Longest segment-aware prefix wins, which is what makes the dynamic routes work without
 * listing them: /tests/42 falls back to /tests, and /garden/5/album/2026-08 to /garden. Matching
 * whole segments rather than string prefixes is what keeps /garden-species off /garden.
 */
export function titleKeyForPath(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  for (let i = segs.length; i > 0; i--) {
    const key = PATH_KEYS['/' + segs.slice(0, i).join('/')];
    if (key) return key;
  }
  return null;
}

/**
 * "Mochi — <page>" for a known page, "Mochi — School OS" for anything else — the landing page,
 * the print documents, and the share-card routes, none of which is a page in the app shell.
 */
export function titleForPath(pathname: string, lang: LangId = 'en'): string {
  const key = titleKeyForPath(pathname);
  return `${BRAND} — ${key ? translate(lang, key) : 'School OS'}`;
}
