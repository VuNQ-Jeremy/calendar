import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { createRoutesStub, Outlet } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { CalendarScreen } from '../src/calendar/index.jsx';
import { iso, TODAY } from '../src/lib/core.js';
import { cacheGet, cacheSet, clearCache } from '../src/lib/cache.js';
import { invalidateAfterMutation } from '../src/lib/route-cache.js';

const CLASSES = [{ id: 'c1', name: 'Studio Art', color: 'orange', studentIds: ['s1'] }];
const STUDENTS = [{ id: 's1', name: 'Alice' }];
const HW = [{ id: 'hw1', classId: 'c1', title: 'Sketchbook page', due: '2026-07-20' }];
const EVENT = {
  id: 'e1',
  title: 'Art Lesson',
  date: iso(TODAY),
  start: '09:00',
  end: '10:00',
  classId: 'c1',
  color: 'orange',
  location: '',
  recurrence: 'none',
  notes: '',
};
const THEME = {
  bg: '#FFFCF8',
  gridLine: '#ECE0CF',
  today: '#FFE7D1',
  header: '#FDF6EC',
  bgImage: '',
  bgOpacity: 0.12,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeStub() {
  let saveCount = 0;
  let calLoads = 0;
  const Stub = createRoutesStub([
    {
      id: 'layout',
      path: '/',
      Component: () => React.createElement(Outlet),
      HydrateFallback: () => null,
      // _app layout loader: uncached, revalidates over "network" after actions
      loader: async () => {
        await sleep(15);
        return { homeworkDueCount: 1, unusedInviteCount: 0, newFeedbackCount: 0 };
      },
      children: [
        {
          path: 'calendar',
          Component: CalendarScreen,
          // mirrors the real cache-first clientLoader
          loader: async () => {
            const cached = cacheGet('route:calendar');
            if (cached !== undefined) return cached;
            calLoads++;
            await sleep(25);
            const data = {
              events: [EVENT],
              classes: CLASSES,
              students: STUDENTS,
              theme: THEME,
              materials: [],
              eventMaterials: [],
            };
            cacheSet('route:calendar', data);
            return data;
          },
        },
        {
          path: 'homework',
          loader: async () => {
            const cached = cacheGet('route:homework');
            if (cached !== undefined) return cached;
            await sleep(20);
            const data = {
              homework: HW,
              grades: [],
              classes: CLASSES,
              students: STUDENTS,
              types: [],
            };
            cacheSet('route:homework', data);
            return data;
          },
          action: async () => {
            await sleep(30);
            saveCount++;
            const res = {
              ok: true,
              grades: [{ homeworkId: 'hw1', studentId: 's1', score: 7, comment: null }],
            };
            // Mirrors the real /homework clientAction (app/routes/homework.tsx).
            invalidateAfterMutation('homework');
            return res;
          },
        },
      ],
    },
    {
      path: '/event-materials',
      loader: async () => {
        await sleep(10);
        return { materialIds: [] };
      },
      action: async () => ({ ok: true }),
    },
  ]);
  return { Stub, getSaveCount: () => saveCount, getCalLoads: () => calLoads };
}

describe('CalendarScreen homework grade auto-save (full wiring)', () => {
  beforeEach(() => clearCache());

  it('keeps the homework section visible after picking a score', async () => {
    const { Stub, getSaveCount } = makeStub();
    await act(async () => {
      render(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(Stub, { initialEntries: ['/calendar'] }),
        ),
      );
    });

    // wait for hydration (async loaders)
    await waitFor(() => expect(screen.getByText('Agenda')).toBeInTheDocument());

    // switch to agenda view and open the event
    await act(async () => {
      fireEvent.click(screen.getByText('Agenda'));
    });
    await waitFor(() => expect(screen.getByText('Art Lesson')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByText('Art Lesson'));
    });
    await waitFor(() => expect(screen.getByText('Edit event')).toBeInTheDocument());

    // go to Homework tab
    await act(async () => {
      fireEvent.click(screen.getByText('Homework'));
    });
    await waitFor(() => expect(screen.getAllByText('Sketchbook page').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // open the score dropdown and pick 7
    const trigger = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.click(trigger);
    });
    const option = await screen.findByText('7');
    await act(async () => {
      fireEvent.click(option);
    });

    // wait for the save + all revalidations to settle
    await waitFor(() => expect(getSaveCount()).toBe(1));
    await act(async () => {
      await sleep(200);
    });

    // the section must still be visible
    expect(screen.getAllByText('Sketchbook page').length).toBeGreaterThan(0);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('No homework for this class yet.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Select a homework to grade'),
    ).not.toBeInTheDocument();
  });
});
