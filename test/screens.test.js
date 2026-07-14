import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { DashboardScreen, HomeworkScreen } from '../src/screens-core.jsx';
import { MaterialsScreen, ProfileScreen } from '../src/screens-extra.jsx';
import { ClassesScreen, StudentsScreen } from '../src/screens-manage/index.jsx';
import { FeedbackScreen } from '../src/feedback.jsx';
import { AuthScreen } from '../src/auth.jsx';
import { CalendarScreen } from '../src/calendar/index.jsx';

const TEST_USER = {
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

function withLang(element) {
  return React.createElement(LanguageProvider, null, element);
}

function makeStub(loaderData, Comp, props = {}) {
  const Wrapper = () => React.createElement(Comp, props);
  return createRoutesStub([{ path: '/', Component: Wrapper, loader: () => loaderData }]);
}

async function renderStub(Stub) {
  await act(async () => {
    render(withLang(React.createElement(Stub, { initialEntries: ['/'] })));
  });
}

describe('DashboardScreen', () => {
  it('renders stat card labels', async () => {
    const Stub = makeStub(
      { todayEvents: [], homework: [], classes: [], studentCount: 0, materialCount: 0 },
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
    const Stub = makeStub(
      { events: [], classes: [], theme: DEFAULT_THEME },
      CalendarScreen,
    );
    await renderStub(Stub);
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
  });
});

describe('ClassesScreen', () => {
  it('renders Classes heading', async () => {
    const Stub = makeStub(
      { classes: [], students: [], materials: [], homework: [] },
      ClassesScreen,
    );
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

describe('HomeworkScreen', () => {
  it('renders Homework heading', async () => {
    const Stub = makeStub({ homework: [], classes: [] }, HomeworkScreen);
    await renderStub(Stub);
    expect(screen.getByText('Homework')).toBeInTheDocument();
  });
});

describe('FeedbackScreen', () => {
  it('renders Feedback heading', async () => {
    const Stub = makeStub({ feedback: [] }, FeedbackScreen, { user: TEST_USER });
    await renderStub(Stub);
    expect(screen.getByText('Feedback')).toBeInTheDocument();
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
