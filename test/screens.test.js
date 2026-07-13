import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/lib/i18n.js';
import { StoreProvider } from '../src/store.js';
import { DashboardScreen, HomeworkScreen } from '../src/screens-core.jsx';
import { MaterialsScreen, ProfileScreen } from '../src/screens-extra.jsx';
import { ClassesScreen, StudentsScreen } from '../src/screens-manage.jsx';
import { FeedbackScreen } from '../src/feedback.jsx';
import { AuthScreen } from '../src/auth.jsx';
import { CalendarScreen } from '../src/calendar.jsx';

const TEST_USER = {
  id: 'u1',
  name: 'Test',
  email: 't@t.t',
  role: 'Teacher',
  color: 'orange',
};

function Providers({ children }) {
  return React.createElement(
    LanguageProvider,
    null,
    React.createElement(StoreProvider, null, children),
  );
}

describe('DashboardScreen', () => {
  it('renders stat card labels', () => {
    render(
      React.createElement(
        Providers,
        null,
        React.createElement(DashboardScreen, { user: TEST_USER, onNav: () => {} }),
      ),
    );
    expect(screen.getByText('Active classes')).toBeInTheDocument();
    expect(screen.getByText('Students')).toBeInTheDocument();
  });
});

describe('CalendarScreen', () => {
  it('renders calendar title and view buttons', () => {
    render(React.createElement(Providers, null, React.createElement(CalendarScreen, null)));
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
  });
});

describe('ClassesScreen', () => {
  it('renders Classes heading', () => {
    render(React.createElement(Providers, null, React.createElement(ClassesScreen, null)));
    expect(screen.getByText('Classes')).toBeInTheDocument();
  });
});

describe('StudentsScreen', () => {
  it('renders People heading', () => {
    render(React.createElement(Providers, null, React.createElement(StudentsScreen, null)));
    expect(screen.getByText('People')).toBeInTheDocument();
  });
});

describe('MaterialsScreen', () => {
  it('renders Materials heading', () => {
    render(React.createElement(Providers, null, React.createElement(MaterialsScreen, null)));
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeInTheDocument();
  });
});

describe('HomeworkScreen', () => {
  it('renders Homework heading', () => {
    render(React.createElement(Providers, null, React.createElement(HomeworkScreen, null)));
    expect(screen.getByText('Homework')).toBeInTheDocument();
  });
});

describe('FeedbackScreen', () => {
  it('renders Feedback heading', () => {
    render(
      React.createElement(
        Providers,
        null,
        React.createElement(FeedbackScreen, { user: TEST_USER }),
      ),
    );
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });
});

describe('ProfileScreen', () => {
  it('renders Your profile heading', () => {
    render(
      React.createElement(
        Providers,
        null,
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
    render(
      React.createElement(Providers, null, React.createElement(AuthScreen, { onLogin: () => {} })),
    );
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });
});
