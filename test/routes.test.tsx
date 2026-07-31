import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { SEEN_INTRO_KEY } from '../src/instructions.jsx';
import AppLayout from '../app/routes/_app';
import { DEFAULT_UI_PREFS } from '../server/services/ui-prefs';

const TEST_USER = {
  id: 'staff-001',
  name: 'Test Teacher',
  role: 'Teacher',
  color: 'orange',
  email: 'test@school.edu',
  phone: null,
  kind: 'staff' as const,
};

const STUB_LOADER_DATA = {
  unusedInviteCount: 0,
  unresolvedFeedbackCount: 0,
  // AppLayout reads uiPrefs.scrollbar in an effect; omitting it throws before render.
  uiPrefs: DEFAULT_UI_PREFS,
  user: TEST_USER,
};

function withLang(element: React.ReactElement) {
  return React.createElement(LanguageProvider, null, element);
}

describe('AppLayout (_app.tsx)', () => {
  it('renders sidebar navigation items when loader provides user', async () => {
    localStorage.setItem(SEEN_INTRO_KEY, '1');

    const Stub = createRoutesStub([
      {
        path: '/',
        Component: AppLayout,
        loader: () => STUB_LOADER_DATA,
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
    });

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Classes' })).toBeInTheDocument();

    localStorage.clear();
  });

  it('renders the user name in the sidebar footer', async () => {
    localStorage.setItem(SEEN_INTRO_KEY, '1');

    const Stub = createRoutesStub([
      {
        path: '/',
        Component: AppLayout,
        loader: () => STUB_LOADER_DATA,
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
    });

    expect(screen.getByText('Test Teacher')).toBeInTheDocument();

    localStorage.clear();
  });

  it('hides the System Config nav item for a non-Admin user', async () => {
    localStorage.setItem(SEEN_INTRO_KEY, '1');

    const Stub = createRoutesStub([
      {
        path: '/',
        Component: AppLayout,
        loader: () => STUB_LOADER_DATA,
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
    });

    expect(screen.queryByRole('link', { name: 'System Config' })).not.toBeInTheDocument();

    localStorage.clear();
  });

  it('shows the System Config nav item for an Admin user', async () => {
    localStorage.setItem(SEEN_INTRO_KEY, '1');

    const adminLoaderData = {
      ...STUB_LOADER_DATA,
      user: { ...TEST_USER, role: 'Admin' },
    };

    const Stub = createRoutesStub([
      {
        path: '/',
        Component: AppLayout,
        loader: () => adminLoaderData,
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
    });

    expect(screen.getByRole('link', { name: 'System Config' })).toBeInTheDocument();

    localStorage.clear();
  });
});
