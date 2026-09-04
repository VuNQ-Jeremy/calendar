import React from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Empty, PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { monthLabel, shiftMonth } from '../../shared/logic/month.js';
import {
  buildSheet,
  needsReviewCount,
  type SheetFilter,
} from '../../shared/logic/practice-sheet.js';
import type { SheetLoaderData } from '../../app/routes/practice.$classId.$month.js';
import { usePracticeSubmit, weekdayLabels } from './common.jsx';
import { WeekdaysDialog } from './weekdays-dialog.jsx';
import { StandingStrip } from './standing-strip.jsx';
import { DayHeader } from './sheet-day.jsx';
import { BlankRow, TaskRow } from './sheet-row.jsx';

const { Button, Tabs } = DS;

/**
 * The Practice sheet: one class-month, one tab per student, the student's tasks grouped by date
 * with every column editable in place. Replaces the week planner, the review queue and the ledger
 * (docs/superpowers/specs/2026-09-04-practice-sheet-design.md).
 *
 * The fetcher is owned HERE and passed down: a row unmounts the moment its copy leaves a filtered
 * view, and `useFetcher`'s cleanup aborts whatever it had in flight (see usePracticeSubmit).
 */
export function PracticeSheetScreen() {
  const data = useLoaderData() as SheetLoaderData;
  const {
    classId,
    month,
    today,
    cls,
    settings,
    practiceDays,
    copies,
    roster,
    materials,
    excuses,
    ledger,
  } = data;
  const { t, lang } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState<SheetFilter>('all');
  const [editingDays, setEditingDays] = React.useState(false);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);

  const requested = params.get('student');
  const student = roster.find((s) => s.id === requested) ?? roster[0] ?? null;
  const standing = student ? (ledger.find((r) => r.studentId === student.id) ?? null) : null;

  const pickStudent = (id: string) =>
    setParams(
      (p) => {
        p.set('student', id);
        return p;
      },
      { replace: true },
    );

  // Today into view once per class-month, after the first paint of the grid — but ONLY when it is
  // off screen. The app shell scrolls an inner container, not the window, so an unconditional
  // `scrollIntoView({ block: 'start' })` threw the header, the filters, the standing cards and the
  // student tabs off the top and dropped the teacher into the middle of the month with no context.
  // Early in the month today is already visible and the right amount to scroll is none; later in
  // the month `nearest` moves the minimum that brings the day on screen.
  const scrolled = React.useRef<string | null>(null);
  React.useEffect(() => {
    const key = `${classId}:${month}`;
    if (scrolled.current === key) return;
    scrolled.current = key;
    const el = document.querySelector('[data-testid="pr-day"][data-today="true"]');
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [classId, month]);

  const crumbs = [{ label: t('pr_title'), to: '/practice' }, { label: cls.name }];

  if (!settings?.enabled) {
    return (
      <div className="content pr-sheet">
        <PageHeader breadcrumbs={crumbs} title={cls.name} subtitle={t('pr_title')} />
        <Empty
          icon="repeat"
          title={t('pr_not_enabled')}
          action={
            <Link to="/practice">
              <Button>{t('pr_enable')}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const mine = student ? copies.filter((c) => c.studentId === student.id) : [];
  const days = student
    ? buildSheet({
        month,
        today,
        filter,
        practiceDays,
        copies: mine,
        misses: standing?.misses ?? [],
        excuses: excuses.filter((e) => e.studentId === student.id),
      })
    : [];
  const reviewFor = (sid: string) => needsReviewCount(copies.filter((c) => c.studentId === sid));

  const chips: { id: SheetFilter; label: string; count: number | null }[] = [
    { id: 'all', label: t('pr_filter_all'), count: null },
    { id: 'review', label: t('pr_filter_review'), count: student ? reviewFor(student.id) : 0 },
    { id: 'misses', label: t('pr_misses'), count: standing?.misses.length ?? 0 },
  ];

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <div className="content pr-sheet">
      <PageHeader
        breadcrumbs={crumbs}
        title={cls.name}
        subtitle={t('pr_sheet_sub', {
          month: monthLabel(month, lang),
          days: weekdayLabels(settings.weekdays, lang),
        })}
        actions={
          <>
            <Link to={`/practice/${classId}/${prev}`} aria-label={t('pr_month_prev')}>
              <Button variant="secondary" iconLeft={<MIcon name="chevronLeft" size={16} />}>
                {monthLabel(prev, lang)}
              </Button>
            </Link>
            <Link to={`/practice/${classId}/${next}`} aria-label={t('pr_month_next')}>
              <Button variant="secondary" iconRight={<MIcon name="chevronRight" size={16} />}>
                {monthLabel(next, lang)}
              </Button>
            </Link>
            <Button
              variant="secondary"
              iconLeft={<MIcon name="settings" size={16} />}
              onClick={() => setEditingDays(true)}
            >
              {t('pr_weekdays')}
            </Button>
          </>
        }
      />

      <div className="pr-sheet__bar">
        <div className="pr-sheet__filters" role="group" aria-label={t('pr_filter_all')}>
          {chips.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={filter === c.id ? 'soft' : 'secondary'}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.count === null ? c.label : `${c.label} · ${c.count}`}
            </Button>
          ))}
        </div>
        <StandingStrip rows={ledger} classId={classId} submit={submit} confirm={confirm} />
      </div>

      {!student ? (
        <Empty icon="users" title={t('pr_no_students')} />
      ) : (
        <>
          <Tabs
            tabs={roster.map((s) => {
              const n = reviewFor(s.id);
              return { id: s.id, label: n ? `${s.name} · ${n}` : s.name };
            })}
            value={student.id}
            onChange={pickStudent}
          />
          <div className="pr-sheet__table">
            <div className="pr-sheet__head">
              <div className="pr-sheet__c">{t('pr_task_title')}</div>
              <div className="pr-sheet__c">{t('pr_material')}</div>
              <div className="pr-sheet__c">{t('pr_url')}</div>
              <div className="pr-sheet__c">{t('pr_time')}</div>
              <div className="pr-sheet__c">{t('pr_col_status')}</div>
              <div className="pr-sheet__c">{t('pr_note')}</div>
              <div className="pr-sheet__c">{t('pr_feedback')}</div>
              <div className="pr-sheet__c" />
            </div>
            {days.map((day) => (
              <React.Fragment key={day.date}>
                <DayHeader
                  day={day}
                  classId={classId}
                  penalty={
                    standing && standing.summary.pendingForDate === day.date
                      ? standing.summary.pendingMultiplier
                      : 0
                  }
                  menuOpen={menuFor === day.date}
                  onToggleMenu={() => setMenuFor(menuFor === day.date ? null : day.date)}
                  submit={submit}
                />
                {day.rows.map((row) => (
                  <TaskRow
                    key={row.copy.id}
                    row={row}
                    studentName={student.name}
                    materials={materials}
                    submit={submit}
                    confirm={confirm}
                  />
                ))}
                {day.showBlank && (
                  <BlankRow
                    classId={classId}
                    date={day.date}
                    studentId={student.id}
                    studentName={student.name}
                    materials={materials}
                    defaultMaterialId={day.rows.at(-1)?.copy.materialId ?? null}
                    submit={submit}
                  />
                )}
              </React.Fragment>
            ))}
            {days.length === 0 && (
              <div className="pr-sheet__empty">
                {t(filter === 'review' ? 'pr_empty_review' : 'pr_empty_misses', {
                  name: student.name,
                })}
              </div>
            )}
          </div>
        </>
      )}

      <WeekdaysDialog
        open={editingDays}
        title={t('pr_weekdays')}
        subtitle={cls.name}
        initial={settings.weekdays}
        onClose={() => setEditingDays(false)}
        onSave={(weekdays) =>
          submit({
            intent: 'settings',
            classId,
            enabled: 'true',
            weekdays: weekdays ?? settings.weekdays,
          })
        }
      />
      {confirmNode}
    </div>
  );
}
