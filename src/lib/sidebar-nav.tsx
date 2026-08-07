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
      { id: 'feedback', path: '/feedback', tk: 'nav_feedback', icon: 'message', staffOnly: true },
    ],
  },
];

/** The items of `sec` this user may see. Empty means the section is hidden entirely. */
export function visibleItems(sec: NavSection, user: { kind: string; role: string }): NavItem[] {
  return sec.items.filter(
    (n) =>
      (!n.staffOnly || user.kind === 'staff') &&
      (!n.studentOnly || user.kind === 'student') &&
      (!n.adminOnly || user.role === 'Admin'),
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
 * Per-device collapse state. Sections start collapsed, so the sidebar opens as
 * five headings and the user expands what they need.
 *
 * Server and first client render agree on all-collapsed, then the stored set is
 * applied after mount — the same SSR-safe shape LanguageProvider uses
 * (src/lib/i18n.tsx), so there is no hydration mismatch. Collapsed-by-default is
 * also what makes that read invisible: the sections a user had open expand into
 * place, rather than the whole list appearing and then snapping shut.
 */
export function useCollapsedSections(activeSectionId: string | null) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(allCollapsed);
  // The mount read below runs once, so it needs the active id without taking it
  // as a dependency.
  const activeRef = React.useRef(activeSectionId);
  activeRef.current = activeSectionId;

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SB_COLLAPSED_KEY);
      // No stored preference — stay as loaded, i.e. everything collapsed.
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const ids = new Set(parsed.filter((x): x is string => typeof x === 'string'));
      // Drop the active section here too: the effect below won't fire again
      // after this read (its dep is activeSectionId, not collapsed), so a
      // stored collapse would otherwise hide the page the user landed on.
      // Write the removal back so storage matches what is on screen.
      if (activeRef.current && ids.delete(activeRef.current)) write(ids);
      setCollapsed(ids);
    } catch {
      /* unavailable or corrupt */
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
