import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { DashboardScreen } from '../src/screens-core.jsx';
import { MaterialsScreen, ProfileScreen } from '../src/screens-extra.jsx';
import { ClassesScreen, StudentsScreen } from '../src/screens-manage/index.jsx';
import { FeedbackScreen } from '../src/feedback.jsx';
import { AuthScreen } from '../src/auth.jsx';
import { CalendarScreen } from '../src/calendar/index.jsx';
import type { AppUser } from '../src/screens-core.jsx';

const TEST_USER: AppUser = {
  id: 'u1',
  name: 'Test',
  email: 't@t.t',
  role: 'Teacher',
  color: 'orange',
};

const DEFAULT_THEME = {
  bg: '#FFFCF8',
  gridLine: '#ECE0CF',
  today: '#FFE7D1',
  header: '#FDF6EC',
  bgImage: '',
  bgOpacity: 0.12,
};

function withLang(element: React.ReactElement): React.ReactElement {
  return React.createElement(LanguageProvider, null, element);
}

function makeStub<P extends object>(
  loaderData: unknown,
  Comp: React.ComponentType<P>,
  props: P = {} as P,
) {
  const Wrapper = () => React.createElement(Comp, props);
  return createRoutesStub([{ path: '/', Component: Wrapper, loader: () => loaderData }]);
}

async function renderStub(Stub: ReturnType<typeof createRoutesStub>) {
  await act(async () => {
    render(withLang(React.createElement(Stub, { initialEntries: ['/'] })));
  });
}

describe('DashboardScreen', () => {
  it('renders stat card labels', async () => {
    const Stub = makeStub(
      {
        todayEvents: [],
        tests: [],
        attemptsSummary: {},
        classes: [],
        studentCount: 0,
        materialCount: 0,
      },
      DashboardScreen,
      { user: TEST_USER, onNav: () => {} },
    );
    await renderStub(Stub);
    expect(screen.getByText('Active classes')).toBeInTheDocument();
    expect(screen.getByText('Students')).toBeInTheDocument();
  });
});

describe('CalendarScreen', () => {
  it('renders calendar title and view buttons', async () => {
    const Stub = makeStub({ events: [], classes: [], theme: DEFAULT_THEME }, CalendarScreen);
    await renderStub(Stub);
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
  });
});

describe('ClassesScreen', () => {
  it('renders Classes heading', async () => {
    const Stub = makeStub({ classes: [], students: [], materials: [] }, ClassesScreen);
    await renderStub(Stub);
    expect(screen.getByText('Classes')).toBeInTheDocument();
  });
});

describe('StudentsScreen', () => {
  it('renders People heading', async () => {
    const Stub = makeStub(
      { students: [], staff: [], parents: [], invites: [], classes: [] },
      StudentsScreen,
    );
    await renderStub(Stub);
    expect(screen.getByText('People')).toBeInTheDocument();
  });
});

describe('MaterialsScreen', () => {
  it('renders Materials heading', async () => {
    const Stub = makeStub({ materials: [], classes: [] }, MaterialsScreen);
    await renderStub(Stub);
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeInTheDocument();
  });
});

describe('FeedbackScreen', () => {
  it('renders Feedback heading', async () => {
    const Stub = makeStub({ feedback: [] }, FeedbackScreen, { user: TEST_USER });
    await renderStub(Stub);
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });

  it('shows release notes on the Changelog tab, without row actions', async () => {
    const Stub = makeStub({ feedback: [] }, FeedbackScreen, { user: TEST_USER });
    await renderStub(Stub);
    // __CHANGELOG__ is stubbed in vitest.config.js.
    expect(screen.queryByText('Test entry')).not.toBeInTheDocument();
    await act(async () => {
      screen.getByText('Changelog').click();
    });
    expect(screen.getByText('Test entry')).toBeInTheDocument();
    expect(screen.getByText('v0.0001')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mark resolved')).not.toBeInTheDocument();
  });
});

describe('ProfileScreen', () => {
  it('renders Your profile heading', () => {
    render(
      withLang(
        React.createElement(ProfileScreen, {
          user: TEST_USER,
          onSave: () => {},
          onLogout: () => {},
          onChangePassword: () => {},
          pwStatus: { busy: false, ok: false, error: null },
        }),
      ),
    );
    expect(screen.getByText('Your profile')).toBeInTheDocument();
  });
});

describe('AuthScreen', () => {
  it('renders Welcome back login card', () => {
    render(withLang(React.createElement(AuthScreen, { onLogin: () => {}, invites: [] })));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });
});
