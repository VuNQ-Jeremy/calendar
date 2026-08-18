import React from 'react';
import type { IconName } from '../icons.jsx';

/**
 * The sidebar's navigation data and collapse state.
 *
 * This lives outside app/routes/_app.tsx so it is importable from tests: the
 * layout route pulls in server/db and the service layer, which cannot load in
 * jsdom. Nothing here may import from server/.
 */

export interface NavItem {
  id: string;
  path: string;
  tk: string;
  icon: IconName;
  staffOnly?: boolean;
  studentOnly?: boolean;
  adminOnly?: boolean;
  /**
   * Platform admins only (dev@ / admin@) — a tier above `adminOnly`, which every school's own
   * Admin holds. The distinction is load-bearing now that anyone can create a school: "admin of
   * my school" must never imply "admin of every school".
   */
  platformOnly?: boolean;
  /**
   * Opt-in for parents. Only /children sets it — the two unflagged learning rows
   * (/vocabulary, /garden) are a student's surface, not theirs. Note the row is
   * additionally hidden until an admin switches the portal on; see `visibleItems`.
   */
  parentOk?: boolean;
  /** The mirror of staffOnly: hidden from everyone EXCEPT parents. */
  parentOnly?: boolean;
  /** Opt-in for the túi mù board — hidden until the admin `checkin-settings.showClassBoard`
   *  toggle is on. The route re-enforces server-side; this flag only hides the link. */
  tuiMuOk?: boolean;
  /**
   * Render a plain anchor with a full page load instead of a `NavLink`, and open it in a new tab.
   *
   * Only for a path that is NOT a page inside the `_app` layout. `/docs/api` is a resource route:
   * it has a loader and no default export, so client-side navigation would ask for a `.data` URL
   * that does not exist, and `prefetch="intent"` would fetch it on hover. A new tab is also the
   * right shape for a reference you read beside the app rather than instead of it.
   */
  external?: boolean;
}

export interface NavSection {
  id: string;
  tk: string;
  /** Distinct from every item icon inside the section, so it reads as a heading. */
  icon: IconName;
  items: NavItem[];
}

/**
 * Five sections rather than one big "Manage" list — fourteen staff items in a
 * flat column was unscannable. Sections are collapsible (see
 * useCollapsedSections), so grouping is also how the rail gets shorter.
 */
export const NAV: NavSection[] = [
  {
    id: 'overview',
    tk: 'nav_overview',
    icon: 'grid',
    items: [
      { id: 'dashboard', path: '/dashboard', tk: 'nav_dashboard', icon: 'home', staffOnly: true },
      { id: 'calendar', path: '/calendar', tk: 'nav_calendar', icon: 'calendar', staffOnly: true },
      {
        id: 'children',
        path: '/children',
        tk: 'nav_children',
        icon: 'users',
        parentOnly: true,
        parentOk: true,
      },
    ],
  },
  {
    id: 'teaching',
    tk: 'nav_teaching',
    icon: 'star',
    items: [
      { id: 'classes', path: '/classes', tk: 'nav_classes', icon: 'book', staffOnly: true },
      { id: 'people', path: '/people', tk: 'nav_people', icon: 'users', staffOnly: true },
      { id: 'materials', path: '/materials', tk: 'nav_materials', icon: 'folder', staffOnly: true },
    ],
  },
  {
    id: 'grading',
    tk: 'nav_grading',
    icon: 'check',
    items: [
      { id: 'tests', path: '/tests', tk: 'nav_tests', icon: 'clipboard', staffOnly: true },
      { id: 'questions', path: '/questions', tk: 'nav_questions', icon: 'edit', staffOnly: true },
      {
        id: 'assessments',
        path: '/assessments',
        tk: 'nav_assessments',
        icon: 'chart',
        staffOnly: true,
      },
      { id: 'rankings', path: '/rankings', tk: 'nav_rankings', icon: 'grad', staffOnly: true },
      {
        id: 'tui-mu',
        path: '/mystery-bag',
        tk: 'tm_nav',
        icon: 'gift',
        staffOnly: true,
        tuiMuOk: true,
      },
    ],
  },
  {
    id: 'learning',
    tk: 'nav_learning',
    icon: 'sparkle',
    items: [
      { id: 'vocabulary', path: '/vocabulary', tk: 'nav_flashcards', icon: 'cards' },
      // Both roles: the class garden is the shared surface, not a staff report.
      { id: 'garden', path: '/garden', tk: 'nav_garden', icon: 'sprout' },
      // Students only — staff manage tests from /tests instead.
      {
        id: 'my-tests',
        path: '/my-tests',
        tk: 'nav_my_tests',
        icon: 'clipboard',
        studentOnly: true,
      },
      // Students only — staff see the same sessions on /calendar.
      {
        id: 'my-schedule',
        path: '/my-schedule',
        tk: 'nav_my_schedule',
        icon: 'calendar',
        studentOnly: true,
      },
    ],
  },
  {
    id: 'admin',
    tk: 'nav_admin',
    icon: 'key',
    items: [
      {
        id: 'tuition',
        path: '/tuition',
        tk: 'nav_tuition',
        icon: 'banknote',
        adminOnly: true,
        staffOnly: true,
      },
      {
        id: 'config',
        path: '/config',
        tk: 'nav_config',
        icon: 'settings',
        adminOnly: true,
        staffOnly: true,
      },
      // Every plant a student can grow, as a reference sheet. Admin rather than staff only
      // because it is a catalogue of the whole game, not a view of anyone's class.
      {
        id: 'garden-species',
        path: '/garden/species',
        tk: 'nav_garden_species',
        icon: 'sprout',
        adminOnly: true,
        staffOnly: true,
      },
      // Diagnostics, not a report: it reads every student's rows at once, so admin only. The
      // route enforces it with requireAdmin — this flag only hides the link.
      { id: 'logs', path: '/logs', tk: 'nav_logs', icon: 'list', adminOnly: true, staffOnly: true },
      // Every school on the platform. Not part of /config on purpose: /config is a school's own
      // settings page and each school's Admin sees it, so mixing platform rows in would need
      // per-row gating and blur what the page means.
      {
        id: 'platform',
        path: '/platform',
        tk: 'platform_title',
        icon: 'grad',
        platformOnly: true,
        adminOnly: true,
        staffOnly: true,
      },
      { id: 'feedback', path: '/feedback', tk: 'nav_feedback', icon: 'message', staffOnly: true },
      // The generated API reference (Scalar). Admin-only here for the same reason as logs — it is
      // a developer surface, not a teacher's — though the route itself only requires staff, so a
      // teacher who knows the URL still gets in. See server/api/docs/ and docs/api.md.
      {
        id: 'apidocs',
        path: '/docs/api',
        tk: 'nav_api_docs',
        icon: 'book',
        adminOnly: true,
        staffOnly: true,
        external: true,
      },
    ],
  },
];

/**
 * The items of `sec` this user may see. Empty means the section is hidden entirely.
 *
 * `opts.parentPortal` is the admin toggle. It only ever subtracts: with the portal off a parent
 * sees no rows at all, which is the profile-only app they had before the portal existed. The flag
 * has to be passed in rather than read here because this module may not import from server/.
 */
export function visibleItems(
  sec: NavSection,
  user: { kind: string; role: string; isPlatformAdmin?: boolean },
  opts?: { parentPortal?: boolean; tuiMuBoard?: boolean },
): NavItem[] {
  const isParent = user.kind === 'parent';
  return sec.items.filter(
    (n) =>
      (!n.staffOnly || user.kind === 'staff') &&
      (!n.studentOnly || user.kind === 'student') &&
      (!n.parentOnly || isParent) &&
      // Unflagged rows are staff+student by default; a parent must be named explicitly, and then
      // only while the portal is open.
      (!isParent || (n.parentOk && opts?.parentPortal === true)) &&
      (!n.adminOnly || user.role === 'Admin') &&
      (!n.platformOnly || user.isPlatformAdmin === true) &&
      (!n.tuiMuOk || opts?.tuiMuBoard === true),
  );
}

/**
 * Which section owns `pathname`, so it can be force-expanded. The trailing-slash
 * boundary keeps /tests/123 in grading without matching /my-tests.
 */
export function activeSectionFor(pathname: string): string | null {
  return (
    NAV.find((sec) =>
      sec.items.some((n) => pathname === n.path || pathname.startsWith(n.path + '/')),
    )?.id ?? null
  );
}

/** Badge total for a collapsed section: the counts of the rows it is hiding. */
export function rollupCount(items: NavItem[], counts: Record<string, number>): number {
  return items.reduce((n, it) => n + (counts[it.id] ?? 0), 0);
}

export const SB_COLLAPSED_KEY = 'mochi_sb_collapsed_v1';

function write(ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(SB_COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable */
  }
}

/** Every section, collapsed — the state a fresh load starts from. */
function allCollapsed(): Set<string> {
  return new Set(NAV.map((sec) => sec.id));
}

/**
 * Per-device collapse state, reset on every page load.
 *
 * A load always starts from all-collapsed and expands exactly one section: the
 * one owning the current route. Expanding sections is deliberately *not*
 * persisted across loads — a user who opens three sections over a session would
 * otherwise come back to a sidebar with three open, and the rail creeps back to
 * the unscannable flat column that sections exist to avoid. Within a load,
 * toggles still stick as you navigate (see the write() calls below), so storage
 * keeps the in-session state and only the initial render ignores it.
 *
 * Server and first client render agree on all-collapsed, then the active
 * section expands after mount — the same SSR-safe shape LanguageProvider uses
 * (src/lib/i18n.tsx), so there is no hydration mismatch. Collapsed-by-default is
 * also what makes that invisible: one section expands into place, rather than
 * the whole list appearing and then snapping shut.
 */
export function useCollapsedSections(activeSectionId: string | null) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(allCollapsed);

  // Discard whatever a previous load stored, so this load starts from
  // all-collapsed regardless of how many sections were open when the user left.
  // The auto-expand effect below then opens the active one and writes the
  // corrected set back, so storage matches the screen. Clearing rather than
  // writing all-collapsed keeps an untouched sidebar leaving no preference
  // behind at all.
  React.useEffect(() => {
    try {
      localStorage.removeItem(SB_COLLAPSED_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Auto-expand on navigation. One-shot, and only for the section just entered
  // — every other section keeps whatever the user chose. Deliberately an effect
  // rather than derived state: a derived force-open would fight the toggle and
  // make the active section impossible to collapse.
  React.useEffect(() => {
    if (!activeSectionId) return;
    setCollapsed((prev) => {
      if (!prev.has(activeSectionId)) return prev;
      const next = new Set(prev);
      next.delete(activeSectionId);
      write(next);
      return next;
    });
  }, [activeSectionId]);

  const toggle = React.useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
