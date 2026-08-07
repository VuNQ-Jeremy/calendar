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

  it('hides admin-only rows from a non-admin staff user', () => {
    const teacher = { kind: 'staff', role: 'Teacher' };
    expect(
      visibleItems(
        NAV.find((s) => s.id === 'admin')!,
        teacher,
      ).map((n) => n.id),
    ).toEqual(['feedback']);
  });

  it('persists a toggled section', async () => {
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });
    expect(expanded('grading')).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByTestId('h-grading'));
    });
    expect(expanded('grading')).toBe('false');
    expect(stored()).toBe('["grading"]');

    await act(async () => {
      fireEvent.click(screen.getByTestId('h-grading'));
    });
    expect(expanded('grading')).toBe('true');
    expect(stored()).toBe('[]');
  });

  it('applies stored collapse on mount but never to the landing section', async () => {
    localStorage.setItem(SB_COLLAPSED_KEY, '["grading","admin"]');
    await act(async () => {
      render(<Harness activeSectionId="grading" />);
    });
    await waitFor(() => expect(expanded('admin')).toBe('false'));
    // The user landed on a grading page, so that section opens regardless...
    expect(expanded('grading')).toBe('true');
    // ...and the write records it, while admin keeps the user's choice.
    expect(stored()).toBe('["admin"]');
  });

  it('expands the section entered by a later navigation, leaving the rest alone', async () => {
    localStorage.setItem(SB_COLLAPSED_KEY, '["grading","admin"]');
    const view = render(<Harness activeSectionId={null} />);
    await waitFor(() => expect(expanded('grading')).toBe('false'));
    expect(expanded('admin')).toBe('false');

    await act(async () => {
      view.rerender(<Harness activeSectionId="grading" />);
    });
    expect(expanded('grading')).toBe('true');
    expect(expanded('admin')).toBe('false');
    expect(stored()).toBe('["admin"]');
  });

  it('survives corrupt stored state', async () => {
    localStorage.setItem(SB_COLLAPSED_KEY, '{not json');
    await act(async () => {
      render(<Harness activeSectionId={null} />);
    });
    expect(expanded('grading')).toBe('true');
  });
});
