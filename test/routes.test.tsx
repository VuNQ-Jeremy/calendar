import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { SEEN_INTRO_KEY } from '../src/instructions.jsx';
import AppLayout from '../app/routes/_app';

const TEST_USER = {
  id: 'u1',
  name: 'Test Teacher',
  role: 'Teacher',
  color: 'orange',
};

const STUB_LOADER_DATA = {
  homeworkDueCount: 0,
  unusedInviteCount: 0,
  newFeedbackCount: 0,
  invites: [],
};

function withLang(element: React.ReactElement) {
  return React.createElement(LanguageProvider, null, element);
}

describe('AppLayout (_app.tsx)', () => {
  beforeEach(() => {
    localStorage.setItem('mochi_session_v1', JSON.stringify(TEST_USER));
    // Suppress the first-run intro modal so it doesn't duplicate nav text in queries.
    localStorage.setItem(SEEN_INTRO_KEY, '1');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders sidebar navigation items', async () => {
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

    // Sidebar nav items are rendered as links
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Classes' })).toBeInTheDocument();
  });

  it('shows AuthScreen when no session in localStorage', async () => {
    localStorage.clear();

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

    // Auth screen shown when no session
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });
});
