import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty } from './ui.jsx';
import { colorOf, iso, TODAY, ICON_TINT } from './lib/core.js';
import { expandEvents, fmtTime, toMin } from './calendar/index.jsx';
import { useLang, locale } from './lib/i18n.jsx';
import type { IconName } from './icons.jsx';
import type { ClassLite } from '../server/services/classes.js';
import type { TestRow } from '../server/services/tests.js';
import type { EventRow } from '../server/services/events.js';
import { isWindowOpen } from '../shared/logic/tests.js';

const { Card: SC, Button: SBtn, Tag: STag, Badge: SBadge } = DS;

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  color: string;
  phone?: string | null;
  avatar?: string;
}

interface DashLoaderData {
  todayEvents: EventRow[];
  tests: TestRow[];
  attemptsSummary: Record<string, { total: number; needsGrading: number; graded: number }>;
  classes: ClassLite[];
  studentCount: number;
  materialCount: number;
}

// ---- StatCard ----
function StatCard({
  icon,
  color,
  num,
  label,
  onClick,
}: {
  icon: IconName;
  color: string;
  num: number;
  label: string;
  onClick?: () => void;
}) {
  return (
    <SC
      interactive
      onClick={onClick}
      style={{ padding: 0, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="statcard">
        <div className="statcard__icon" style={ICON_TINT(color)}>
          <MIcon name={icon} size={24} />
        </div>
        <div>
          <div className="statcard__num">{num}</div>
          <div className="statcard__label">{label}</div>
        </div>
      </div>
    </SC>
  );
}

/** One row of the dashboard's open-tests card. Links straight to the test's page. */
function DashTestItem({ test, classes }: { test: TestRow; classes: ClassLite[] }) {
  const c = colorOf(test.color);
  const clsName = classes.find((cl) => cl.id === test.classId)?.name;
  return (
    <Link to={`/tests/${test.id}`} className="m-row" style={{ gap: 12, textDecoration: 'none' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--text-sm)' }}>
          {test.title}
        </div>
        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {clsName}
        </div>
      </div>
      <span style={{ width: 10, height: 10, borderRadius: 9, background: c.base }} />
    </Link>
  );
}

// ---- Dashboard / Today ----
function DashboardScreen({ user, onNav }: { user: AppUser; onNav: (route: string) => void }) {
  const { todayEvents, tests, attemptsSummary, classes, studentCount, materialCount } =
    useLoaderData() as DashLoaderData;
  const { t, lang } = useLang();
  const today = iso(TODAY);
  const todays = expandEvents(todayEvents, TODAY, TODAY).sort(
    (a, b) => toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00'),
  );
  // What a teacher can act on right now: an online test whose window is open, or any
  // test dated today (paper tests carry a date, not a window).
  const now = new Date();
  const openTests = tests.filter(
    (tst) =>
      tst.status === 'published' &&
      ((tst.mode === 'online' && isWindowOpen(tst.openAt, tst.closeAt, now) === 'open') ||
        tst.date === today),
  );
  const needsGrading = Object.values(attemptsSummary).reduce((n, s) => n + s.needsGrading, 0);
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name;
  const todayStr = new Date(TODAY).toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="content">
      <PageHeader
        title={t('dash_greeting', { name: user.name.split(' ')[0] })}
        subtitle={t(
          todays.length === 0
            ? 'dash_sub_none'
            : todays.length === 1
              ? 'dash_sub_one'
              : 'dash_sub_many',
          { date: todayStr, count: todays.length },
        )}
      />
      <div className="m-grid cols-4">
        <StatCard icon="book" color="green" num={classes.length} label={t('stat_classes')} />
        <StatCard icon="users" color="blue" num={studentCount} label={t('stat_students')} />
        <StatCard
          icon="clipboard"
          color="orange"
          num={needsGrading}
          label={t('stat_needs_grading')}
          onClick={() => onNav('tests')}
        />
        <StatCard icon="folder" color="violet" num={materialCount} label={t('stat_materials')} />
      </div>
      <div className="m-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Today's schedule */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_today_schedule')}</h2>
            <SBtn
              variant="ghost"
              size="sm"
              iconRight={<MIcon name="chevronRight" size={16} />}
              onClick={() => onNav('calendar')}
            >
              {t('nav_calendar')}
            </SBtn>
          </div>
          {todays.length ? (
            <div className="m-stack">
              {todays.map((e, i) => {
                const c = colorOf(e.color);
                return (
                  <div key={i} className="lrow" style={{ padding: 12 }}>
                    <div className="lrow__bar" style={{ background: c.base }} />
                    <div
                      className="m-mono"
                      style={{
                        minWidth: 70,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                      }}
                    >
                      {fmtTime(e.start ?? '00:00')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="lrow__title" style={{ fontSize: 'var(--text-md)' }}>
                        {e.title}
                      </div>
                      {e.location && (
                        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                          {e.location}
                        </div>
                      )}
                    </div>
                    {e.classId && <STag color={e.color}>{className(e.classId) || t('class')}</STag>}
                    {e.classId && (
                      <a
                        title={t('ck_open_kiosk_in')}
                        href={`/kiosk/${encodeURIComponent(e.id)}/${encodeURIComponent(e.date)}/checkin`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'grid',
                          placeItems: 'center',
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--radius-md)',
                          background: colorOf('orange').soft,
                          color: colorOf('orange').ink,
                          flexShrink: 0,
                        }}
                      >
                        <MIcon name="gift" size={16} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              icon="calendar"
              title={t('dash_nothing_scheduled')}
              sub={t('dash_enjoy_quiet')}
            />
          )}
        </SC>
        {/* Open tests */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_open_tests')}</h2>
            {openTests.length > 0 && <SBadge color="brand">{openTests.length}</SBadge>}
          </div>
          {openTests.length ? (
            <div className="m-stack">
              {openTests.map((tst) => (
                <DashTestItem key={tst.id} test={tst} classes={classes} />
              ))}
            </div>
          ) : (
            <Empty icon="check" title={t('dash_all_caught')} sub={t('dash_no_open_tests')} />
          )}
        </SC>
      </div>
    </div>
  );
}

export { DashboardScreen };
