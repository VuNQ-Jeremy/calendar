import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import {
  NAV,
  SB_COLLAPSED_KEY,
  activeSectionFor,
  rollupCount,
  useCollapsedSections,
  visibleItems,
} from '../src/lib/sidebar-nav.jsx';

/** Minimal stand-in for the section headers in app/routes/_app.tsx's Sidebar. */
function Harness({ activeSectionId }: { activeSectionId: string | null }) {
  const { collapsed, toggle } = useCollapsedSections(activeSectionId);
  return (
    <div>
      {NAV.map((sec) => (
        <button
          key={sec.id}
          data-testid={`h-${sec.id}`}
          aria-expanded={!collapsed.has(sec.id)}
          onClick={() => toggle(sec.id)}
        >
          {sec.id}
        </button>
      ))}
    </div>
  );
}

const stored = () => localStorage.getItem(SB_COLLAPSED_KEY);
const expanded = (id: string) => screen.getByTestId(`h-${id}`).getAttribute('aria-expanded');

describe('sidebar nav sections', () => {
  beforeEach(() => localStorage.clear());

  it('maps a pathname to the section that owns it', () => {
    expect(activeSectionFor('/tests')).toBe('grading');
    // Detail routes belong to their parent section...
    expect(activeSectionFor('/tests/123')).toBe('grading');
    // ...but the prefix must not leak across items: /my-tests is its own row.
    expect(activeSectionFor('/my-tests')).toBe('learning');
    expect(activeSectionFor('/dashboard')).toBe('overview');
    expect(activeSectionFor('/config')).toBe('admin');
    expect(activeSectionFor('/login')).toBeNull();
  });

  it('gives every section an icon no item inside it also uses', () => {
    for (const sec of NAV) {
      expect(sec.icon).toBeTruthy();
      expect(sec.items.map((n) => n.icon)).not.toContain(sec.icon);
    }
    // And the five headings are distinguishable from each other.
    expect(new Set(NAV.map((s) => s.icon)).size).toBe(NAV.length);
  });

  it('sums only the counts of the items it is given', () => {
    const grading = NAV.find((s) => s.id === 'grading')!;
    expect(rollupCount(grading.items, { tests: 3, people: 9 })).toBe(3);
    expect(rollupCount(grading.items, {})).toBe(0);
  });

  it('shows students only their own section', () => {
    const student = { kind: 'student', role: 'Student' };
    const visible = NAV.filter((sec) => visibleItems(sec, student).length > 0).map((s) => s.id);
    expect(visible).toEqual(['learning']);
    expect(
      visibleItems(
        NAV.find((s) => s.id === 'learning')!,
        student,
      ).map((n) => n.id),
    ).toEqual(['vocabulary', 'garden', 'my-tests', 'my-schedule']);
  });

  // Unflagged rows are staff+student. A parent must not inherit them by default: their app
  // is /profile, and /vocabulary and /garden would 403 behind the scenes.
  const parent = { kind: 'parent', role: 'Parent' };

  it('shows a parent no navigation while the portal is closed', () => {
    // No opts at all, and an explicit false — a caller that forgets to pass the flag must get the
    // closed behaviour, not an open portal.
    expect(NAV.flatMap((sec) => visibleItems(sec, parent))).toEqual([]);
    expect(NAV.flatMap((sec) => visibleItems(sec, parent, {}))).toEqual([]);
    expect(NAV.flatMap((sec) => visibleItems(sec, parent, { parentPortal: false }))).toEqual([]);
  });

  it('shows a parent exactly one row once the portal opens', () => {
    const items = NAV.flatMap((sec) => visibleItems(sec, parent, { parentPortal: true }));
    expect(items.map((n) => n.id)).toEqual(['children']);
  });

  // The flag is about parents only. Opening the portal must not add a row to anyone else's rail,
  // and /children must never appear for staff or students.
  it('leaves staff and student navigation untouched by the portal flag', () => {
    for (const user of [
      { kind: 'staff', role: 'Admin' },
      { kind: 'student', role: 'Student' },
    ]) {
      const closed = NAV.flatMap((sec) => visibleItems(sec, user)).map((n) => n.id);
      const open = NAV.flatMap((sec) => visibleItems(sec, user, { parentPortal: true })).map(
        (n) => n.id,
      );
      expect(open).toEqual(closed);
      expect(open).not.toContain('children');
    }
  });

  it('hides admin-only rows from a non-admin staff user', () => {
    const teacher = { kind: 'staff', role: 'Teacher' };
    expect(
      visibleItems(
        NAV.find((s) => s.id === 'admin')!,
        teacher,
      ).map((n) => n.id),
    ).toEqual(['feedback']);
  });

  it('starts every section collapsed with nothing stored', async () => {
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });
    for (const sec of NAV) expect(expanded(sec.id)).toBe('false');
    // Nothing was written: an untouched sidebar leaves no preference behind.
    expect(stored()).toBeNull();
  });

  it('persists a toggled section', async () => {
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });

    // Expanding writes the set MINUS that section (collapsed ids are stored).
    await act(async () => {
      fireEvent.click(screen.getByTestId('h-grading'));
    });
    expect(expanded('grading')).toBe('true');
    expect(JSON.parse(stored()!)).not.toContain('grading');
    expect(JSON.parse(stored()!)).toContain('admin');

    await act(async () => {
      fireEvent.click(screen.getByTestId('h-grading'));
    });
    expect(expanded('grading')).toBe('false');
    expect(JSON.parse(stored()!)).toContain('grading');
  });

  it('ignores stored expansion on mount, expanding only the landing section', async () => {
    // A previous load left three sections open. A fresh mount must not restore
    // them — otherwise the rail accumulates open sections over a user's life.
    localStorage.setItem(SB_COLLAPSED_KEY, '["overview","admin","grading"]');
    await act(async () => {
      render(<Harness activeSectionId="grading" />);
    });
    // The user landed on a grading page, so that section — and only it — opens.
    await waitFor(() => expect(expanded('grading')).toBe('true'));
    for (const id of ['overview', 'teaching', 'learning', 'admin']) {
      expect(expanded(id), id).toBe('false');
    }
    // Storage is rewritten to match the screen, not left holding the stale set.
    expect(JSON.parse(stored()!).sort()).toEqual(['admin', 'learning', 'overview', 'teaching']);
  });

  it('expands nothing on a mount with no active section', async () => {
    localStorage.setItem(SB_COLLAPSED_KEY, '["grading","admin"]');
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });
    for (const id of ['overview', 'teaching', 'grading', 'learning', 'admin']) {
      expect(expanded(id), id).toBe('false');
    }
  });

  it('expands the section entered by a later navigation, leaving the rest alone', async () => {
    const view = render(<Harness activeSectionId={null} />);
    // Within one load the user opens teaching by hand; it must survive the
    // navigation below — only a fresh mount resets.
    await act(async () => {
      fireEvent.click(screen.getByTestId('h-teaching'));
    });
    expect(expanded('teaching')).toBe('true');

    await act(async () => {
      view.rerender(<Harness activeSectionId="grading" />);
    });
    expect(expanded('grading')).toBe('true');
    expect(expanded('teaching')).toBe('true');
    expect(expanded('admin')).toBe('false');
    expect(JSON.parse(stored()!).sort()).toEqual(['admin', 'learning', 'overview']);
  });

  it('survives corrupt stored state', async () => {
    localStorage.setItem(SB_COLLAPSED_KEY, '{not json');
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });
    // Falls back to the as-loaded default rather than throwing.
    expect(expanded('grading')).toBe('false');
  });
});
