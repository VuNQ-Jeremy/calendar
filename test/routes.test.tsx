import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { StoreProvider } from '../src/store.jsx';
import { SEEN_INTRO_KEY } from '../src/instructions.jsx';
import AppLayout from '../app/routes/_app';

const TEST_USER = {
  id: 'u1',
  name: 'Test Teacher',
  role: 'Teacher',
  color: 'orange',
};

function withProviders(element: React.ReactElement) {
  return (
    <LanguageProvider>
      <StoreProvider>{element}</StoreProvider>
    </LanguageProvider>
  );
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
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withProviders(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
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
        children: [
          {
            path: 'dashboard',
            Component: () => React.createElement('div', null, 'Dashboard content'),
          },
        ],
      },
    ]);

    await act(async () => {
      render(withProviders(React.createElement(Stub, { initialEntries: ['/dashboard'] })));
    });

    // Auth screen shown when no session
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });
});
