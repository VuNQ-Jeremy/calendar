import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { LanguageProvider } from '../src/lib/i18n.jsx';
import { DashboardScreen } from '../src/screens-core.jsx';
import { MaterialsScreen, ProfileScreen } from '../src/screens-extra.jsx';
import { ClassesScreen, StudentsScreen } from '../src/screens-manage/index.jsx';
import { FeedbackScreen } from '../src/feedback.jsx';
import { CalendarScreen } from '../src/calendar/index.jsx';
import { TuitionScreen } from '../src/screens-tuition.jsx';
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
    const Stub = makeStub(
      {
        classes: [],
        students: [],
        materials: [],
        gradeLevels: [],
        classLevels: [],
        subjects: [],
      },
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

describe('FeedbackScreen', () => {
  it('renders Feedback heading', async () => {
    const Stub = makeStub({ feedback: [] }, FeedbackScreen, { user: TEST_USER });
    await renderStub(Stub);
    expect(screen.getByText('Feedback')).toBeInTheDocument();
  });

  it('shows release notes in the Changelog modal, without row actions', async () => {
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

describe('FeedbackScreen board', () => {
  const row = (id: string, message: string, status: string) => ({
    id,
    message,
    category: 'idea',
    author: null,
    status,
    createdAt: null,
    appVersion: null,
    // 'f3' -> 3: the board shows this as the "F-3" handle.
    ref: Number(id.slice(1)),
    issueNumber: null,
  });
  const ROWS = [
    row('f1', 'Fresh idea', 'new'),
    row('f2', 'Looked at it', 'reviewed'),
    row('f3', 'Shipped it', 'done'),
    row('f4', 'Second idea', 'new'),
  ];

  /** Board + a real `/feedback` action, so the fetcher submit has somewhere to land. */
  function boardStub(seen: FormData[]) {
    const Wrapper = () => React.createElement(FeedbackScreen, { user: TEST_USER });
    return createRoutesStub([
      {
        path: '/feedback',
        Component: Wrapper,
        loader: () => ({ feedback: ROWS }),
        action: async ({ request }) => {
          seen.push(await request.formData());
          return { ok: true };
        },
      },
    ]);
  }

  const column = (title: string) => screen.getByText(title).closest('.m-board__col') as HTMLElement;

  it('sorts reports into one column per status, with counts', async () => {
    const Stub = boardStub([]);
    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/feedback'] })));
    });
    expect(column('New')).toContainElement(screen.getByText('Fresh idea'));
    expect(column('New')).toContainElement(screen.getByText('Second idea'));
    expect(column('Reviewed')).toContainElement(screen.getByText('Looked at it'));
    expect(column('Resolved')).toContainElement(screen.getByText('Shipped it'));
    expect(column('New').querySelector('.m-board__count')).toHaveTextContent('2');
    expect(column('Resolved').querySelector('.m-board__count')).toHaveTextContent('1');
  });

  it('dropping a card on another column submits that status', async () => {
    const seen: FormData[] = [];
    const Stub = boardStub(seen);
    await act(async () => {
      render(withLang(React.createElement(Stub, { initialEntries: ['/feedback'] })));
    });
    const card = screen.getByText('Fresh idea').closest('.kcard') as HTMLElement;
    // jsdom has no DataTransfer; the handlers only set effectAllowed/dropEffect and setData.
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: () => {} };
    // One act per event: the drop handler reads state the dragStart set, which only
    // lands once React has flushed.
    await act(async () => {
      fireEvent.dragStart(card, { dataTransfer });
    });
    await act(async () => {
      fireEvent.dragOver(column('Resolved'), { dataTransfer });
    });
    await act(async () => {
      fireEvent.drop(column('Resolved'), { dataTransfer });
    });
    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(seen[0])).toEqual({ intent: 'update', id: 'f1', status: 'done' });
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

describe('TuitionScreen', () => {
  const LINE = {
    studentId: 'stu-1',
    classId: 'cls-1',
    className: 'Toán 9',
    sessions: 4,
    statusCounts: { present: 3, late: 1 },
    unitPriceVnd: 150_000,
    amountVnd: 600_000,
  };

  const baseData = (over: Record<string, unknown> = {}) => ({
    month: '2031-03',
    report: {
      month: '2031-03',
      status: 'open' as const,
      closedAt: null,
      closedBy: null,
      lines: [LINE],
      studentMonths: [],
      missingPriceClasses: [],
    },
    prices: [{ id: 'p1', classId: 'cls-1', priceVnd: 150_000, effectiveFrom: '2031-03-01' }],
    classes: [{ id: 'cls-1', name: 'Toán 9', color: 'blue' }],
    students: [
      {
        id: 'stu-1',
        name: 'Nguyễn An',
        grade: null,
        guardian: null,
        email: null,
        color: 'blue',
        classIds: ['cls-1'],
      },
    ],
    settings: { billableStatuses: ['present', 'late', 'absent'] },
    ...over,
  });

  it('shows the month, the amount due and an unpaid badge for an open month', async () => {
    const Stub = makeStub(baseData(), TuitionScreen);
    await renderStub(Stub);
    expect(screen.getByText('March 2031')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn An')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Close month')).toBeInTheDocument();
    // 4 billable sessions × 150.000, nothing paid.
    expect(screen.getAllByText('600.000 ₫').length).toBeGreaterThan(0);
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
  });

  it('offers Reopen instead of Close once the month is closed', async () => {
    const Stub = makeStub(
      baseData({
        report: {
          month: '2031-03',
          status: 'closed' as const,
          closedAt: '2031-04-01T02:00:00.000Z',
          closedBy: 'Admin One',
          lines: [LINE],
          studentMonths: [
            {
              month: '2031-03',
              studentId: 'stu-1',
              adjustmentVnd: 0,
              adjustmentNote: null,
              paidVnd: 600_000,
              paidAt: '2031-03-20',
              paymentNote: null,
            },
          ],
          missingPriceClasses: [],
        },
      }),
      TuitionScreen,
    );
    await renderStub(Stub);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('Reopen month')).toBeInTheDocument();
    expect(screen.queryByText('Close month')).not.toBeInTheDocument();
    expect(screen.getByText('Paid in full')).toBeInTheDocument();
    expect(screen.getByText(/Closed 2031-04-01 by Admin One/)).toBeInTheDocument();
  });

  it('names the classes that block a close when a price is missing', async () => {
    const Stub = makeStub(
      baseData({
        report: {
          month: '2031-03',
          status: 'open' as const,
          closedAt: null,
          closedBy: null,
          lines: [],
          studentMonths: [],
          missingPriceClasses: [{ id: 'cls-9', name: 'Lý 9' }],
        },
      }),
      TuitionScreen,
    );
    await renderStub(Stub);
    expect(screen.getByText(/Lý 9/)).toBeInTheDocument();
    expect(screen.getByText('No fees this month')).toBeInTheDocument();
  });
});
