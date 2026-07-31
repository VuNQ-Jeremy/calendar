import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { splitIctFromUtc } from '../../shared/logic/tests.js';
import type { StudentTestListItem } from '../../server/services/attempts.js';

const { Card: MC, Button: MBtn, Tag: MTag, Badge: MBadge } = DS;

interface MyTestsLoaderData {
  items: StudentTestListItem[];
  serverNow: string;
}

/** ICT 'YYYY-MM-DD HH:mm' for a stored UTC instant — the only time format this screen shows. */
function ictLabel(isoUtc: string | null): string {
  if (!isoUtc) return '—';
  const { date, time } = splitIctFromUtc(isoUtc);
  return `${date} ${time}`;
}

function WindowBadge({ item }: { item: StudentTestListItem }) {
  const { t } = useLang();
  if (item.window === 'upcoming') {
    return (
      <MBadge color="blue">{t('my_tests_upcoming', { time: ictLabel(item.test.openAt) })}</MBadge>
    );
  }
  if (item.window === 'open') {
    return (
      <MBadge color="green">{t('my_tests_open', { time: ictLabel(item.test.closeAt) })}</MBadge>
    );
  }
  return <MBadge color="cocoa">{t('my_tests_closed')}</MBadge>;
}

/**
 * The state-dependent right-hand side of a row. Every branch is driven by the attempt status the
 * server reported — nothing here decides whether a student may sit a test, the route does.
 */
function RowAction({ item }: { item: StudentTestListItem }) {
  const { t } = useLang();
  const href = `/my-tests/${item.test.id}`;
  const status = item.attempt?.status;

  if (status === 'graded') {
    return (
      <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>
          {item.attempt?.normalizedScore ?? 0}/10
        </span>
        <Link to={href} style={{ color: 'var(--text-link)', fontWeight: 600 }}>
          {t('take_view_result')}
        </Link>
      </div>
    );
  }

  if (status === 'submitted' || status === 'needs_grading') {
    return <MBadge color="violet">{t('take_awaiting_grading')}</MBadge>;
  }

  if (status === 'in_progress') {
    return (
      <Link to={href}>
        <MBtn variant="primary" size="sm">
          {t('take_continue')}
        </MBtn>
      </Link>
    );
  }

  // No attempt yet: only an open window offers a way in.
  if (item.window === 'open') {
    return (
      <Link to={href}>
        <MBtn variant="primary" size="sm">
          {t('take_start')}
        </MBtn>
      </Link>
    );
  }
  return null;
}

function TestRowCard({ item }: { item: StudentTestListItem }) {
  const { t } = useLang();
  const dim = item.window === 'upcoming' && !item.attempt;
  return (
    <MC style={{ padding: 16, opacity: dim ? 0.7 : 1 }}>
      <div className="m-row" style={{ gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{item.test.title}</div>
          <div className="m-row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <WindowBadge item={item} />
            {item.test.timeLimitMinutes != null && (
              <MTag>{t('print_time_limit', { n: item.test.timeLimitMinutes })}</MTag>
            )}
          </div>
        </div>
        <RowAction item={item} />
      </div>
    </MC>
  );
}

export function MyTestsScreen() {
  const { items } = useLoaderData() as MyTestsLoaderData;
  const { t } = useLang();

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={t('my_tests_title')} subtitle={t('my_tests_subtitle')} />
      {items.length === 0 ? (
        <Empty icon="clipboard" title={t('my_tests_empty')} />
      ) : (
        items.map((item) => <TestRowCard key={item.test.id} item={item} />)
      )}
    </div>
  );
}
