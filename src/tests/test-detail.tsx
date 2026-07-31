import React from 'react';
import { useLoaderData, useFetcher, useParams } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import {
  MSelect,
  MDatePicker,
  MTimePicker,
  ColorPicker,
  PageHeader,
  Empty,
  useConfirm,
} from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { composeUtcFromIct, splitIctFromUtc, isWindowOpen } from '../../shared/logic/tests.js';
import { QuestionPicker } from './question-picker.jsx';
import { PaperScoreGrid } from './paper-entry.jsx';
import { ResultsTable, AttemptGradeModal } from './grading.jsx';
import type { AnswerRow } from '../../server/services/attempts.js';
import type { TestRow, TestQuestionRow, TestAttemptRow } from '../../server/services/tests.js';
import type { QuestionRow } from '../../server/services/questions.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';
import type { AssessmentTypeRow } from '../../server/services/assessment-types.js';

const { Card: MC, Button: MBtn, Tag: MTag, Badge: MBadge } = DS;

export interface TestDetailLoaderData {
  test: TestRow;
  links: TestQuestionRow[];
  questions: QuestionRow[];
  students: StudentRow[];
  attempts: TestAttemptRow[];
  answers: AnswerRow[];
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  types: AssessmentTypeRow[];
  totalPoints: number;
}

type Tab = 'setup' | 'questions' | 'results';

const WIN_TK = {
  upcoming: 'tests_win_upcoming',
  open: 'tests_win_open',
  closed: 'tests_win_closed',
} as const;

export function TestDetailScreen() {
  const data = useLoaderData() as TestDetailLoaderData;
  const {
    test,
    links,
    questions,
    students,
    attempts,
    answers,
    classes,
    gradeLevels,
    types,
    totalPoints,
  } = data;
  const params = useParams();
  const { t } = useLang();
  const [tab, setTab] = React.useState<Tab>('setup');
  const action = `/tests/${params.id}`;

  // Which attempt the grading modal is showing. Held as an id so a refetch swaps in fresh data
  // rather than pinning a stale row.
  const [gradingId, setGradingId] = React.useState<string | null>(null);
  const grading = gradingId ? (attempts.find((a) => a.id === gradingId) ?? null) : null;

  const cls = classes.find((c) => c.id === test.classId);
  const win =
    test.status === 'published' && test.mode === 'online'
      ? isWindowOpen(test.openAt, test.closeAt, new Date())
      : null;

  return (
    <div className="content">
      <PageHeader
        title={test.title}
        subtitle={
          <span className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {cls && <MTag color={cls.color}>{cls.name}</MTag>}
            <MBadge color={test.mode === 'online' ? 'blue' : 'orange'}>
              {t(test.mode === 'online' ? 'tests_mode_online' : 'tests_mode_paper')}
            </MBadge>
            <MBadge color={test.status === 'published' ? 'green' : 'cocoa'}>
              {t(test.status === 'published' ? 'tests_status_published' : 'tests_status_draft')}
            </MBadge>
            {win && <MBadge color="blue">{t(WIN_TK[win])}</MBadge>}
          </span>
        }
      />

      <MC style={{ padding: 14, marginBottom: 16 }}>
        <DS.Tabs
          value={tab}
          onChange={(id: string) => setTab(id as Tab)}
          tabs={[
            { id: 'setup', label: t('tests_tab_setup') },
            { id: 'questions', label: t('tests_tab_questions') },
            { id: 'results', label: t('tests_tab_results') },
          ]}
        />
      </MC>

      {tab === 'setup' && (
        <SetupCard
          test={test}
          classes={classes}
          gradeLevels={gradeLevels}
          types={types}
          action={action}
        />
      )}

      {tab === 'questions' && (
        <QuestionPicker
          links={links}
          questions={questions}
          gradeLevels={gradeLevels}
          attempts={attempts}
          action={action}
        />
      )}

      {tab === 'results' &&
        (!test.classId ? (
          <Empty icon="users" title={t('att_empty_roster')} />
        ) : test.mode === 'paper' ? (
          <PaperScoreGrid testId={test.id} roster={students} attempts={attempts} action={action} />
        ) : test.status !== 'published' && !attempts.length ? (
          <MC style={{ padding: 18 }}>
            <Empty
              icon="clock"
              title={t('grading_no_attempts_yet')}
              sub={t('tests_total_points', { n: totalPoints })}
            />
          </MC>
        ) : (
          <>
            <ResultsTable
              roster={students}
              attempts={attempts}
              action={action}
              onReview={(a) => setGradingId(a.id)}
            />
            <AttemptGradeModal
              open={!!grading}
              onClose={() => setGradingId(null)}
              attempt={grading}
              student={students.find((s) => s.id === grading?.studentId)}
              links={links}
              questions={questions}
              answers={answers.filter((a) => a.attemptId === gradingId)}
              action={action}
            />
          </>
        ))}
    </div>
  );
}

interface SetupCardProps {
  test: TestRow;
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  types: AssessmentTypeRow[];
  action: string;
}

type SetupDraft = {
  title: string;
  classId: string;
  gradeLevelId: string;
  assessmentTypeId: string;
  mode: 'online' | 'paper';
  date: string;
  openDate: string;
  openTime: string;
  closeDate: string;
  closeTime: string;
  timeLimitMinutes: string;
  instructions: string;
  color: string;
};

function draftOf(test: TestRow): SetupDraft {
  // Windows are stored in UTC and edited in ICT (UTC+7, no DST) — the whole user base is
  // in Vietnam. splitIctFromUtc/composeUtcFromIct are the only conversion points.
  const open = test.openAt ? splitIctFromUtc(test.openAt) : { date: '', time: '' };
  const close = test.closeAt ? splitIctFromUtc(test.closeAt) : { date: '', time: '' };
  return {
    title: test.title,
    classId: test.classId ?? '',
    gradeLevelId: test.gradeLevelId ?? '',
    assessmentTypeId: test.assessmentTypeId ?? '',
    mode: test.mode,
    date: test.date ?? '',
    openDate: open.date,
    openTime: open.time,
    closeDate: close.date,
    closeTime: close.time,
    timeLimitMinutes: test.timeLimitMinutes != null ? String(test.timeLimitMinutes) : '',
    instructions: test.instructions ?? '',
    color: test.color ?? 'violet',
  };
}

function SetupCard({ test, classes, gradeLevels, types, action }: SetupCardProps) {
  const { t } = useLang();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [confirm, confirmNode] = useConfirm();
  const [f, setF] = React.useState<SetupDraft>(() => draftOf(test));

  React.useEffect(() => {
    setF(draftOf(test));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.id, test.status, test.mode]);

  const set = <K extends keyof SetupDraft>(k: K, v: SetupDraft[K]) =>
    setF((d) => ({ ...d, [k]: v }));

  const err = fetcher.data && 'error' in fetcher.data ? fetcher.data.error : undefined;
  const errMsg =
    err === 'test_empty'
      ? t('tests_err_empty')
      : err === 'test_no_close'
        ? t('tests_err_no_close')
        : err === 'test_has_attempts'
          ? t('tests_err_has_attempts')
          : null;

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('title', f.title.trim() || test.title);
    fd.set('classId', f.classId);
    fd.set('gradeLevelId', f.gradeLevelId);
    fd.set('assessmentTypeId', f.assessmentTypeId);
    fd.set('mode', f.mode);
    fd.set('date', f.date);
    fd.set('color', f.color);
    if (f.mode === 'online') {
      fd.set('openAt', f.openDate && f.openTime ? composeUtcFromIct(f.openDate, f.openTime) : '');
      fd.set(
        'closeAt',
        f.closeDate && f.closeTime ? composeUtcFromIct(f.closeDate, f.closeTime) : '',
      );
      fd.set('timeLimitMinutes', f.timeLimitMinutes);
      fd.set('instructions', f.instructions);
    } else {
      fd.set('openAt', '');
      fd.set('closeAt', '');
      fd.set('instructions', f.instructions);
    }
    fetcher.submit(fd, { action, method: 'post' });
  };

  const togglePublish = () => {
    const fd = new FormData();
    fd.set('intent', test.status === 'published' ? 'unpublish' : 'publish');
    fetcher.submit(fd, { action, method: 'post' });
  };

  const del = async () => {
    if (
      await confirm({
        title: t('tests_delete_confirm'),
        message: test.title,
        confirmLabel: t('delete'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'delete');
      fetcher.submit(fd, { action, method: 'post' });
    }
  };

  return (
    <MC style={{ padding: 18 }}>
      {errMsg && (
        <div
          style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 12 }}
          className="m-muted"
        >
          {errMsg}
        </div>
      )}

      <div className="mochi-field">
        <label className="mochi-field__label">{t('tests_title_label')}</label>
        <input
          className="mochi-input"
          placeholder={t('tests_title_ph')}
          value={f.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('tests_class_label')}
          value={f.classId}
          onChange={(v) => set('classId', v)}
          options={[
            { value: '', label: t('no_class') },
            ...classes.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <MSelect
          label={t('tests_grade_label')}
          value={f.gradeLevelId}
          onChange={(v) => set('gradeLevelId', v)}
          options={[
            { value: '', label: t('qb_grade_none') },
            ...gradeLevels
              .filter((g) => g.active || g.id === f.gradeLevelId)
              .map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <MSelect
          label={t('tests_type_label')}
          value={f.assessmentTypeId}
          onChange={(v) => set('assessmentTypeId', v)}
          options={[
            { value: '', label: t('assess_type_none') },
            // An already-selected but deactivated type must stay visible, or saving
            // the form would silently drop it.
            ...types
              .filter((x) => x.active || x.id === f.assessmentTypeId)
              .map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
        {test.status === 'published' ? (
          <MSelect
            label={t('tests_mode_label')}
            value={f.mode}
            onChange={() => {}}
            options={[
              { value: 'paper', label: t('tests_mode_paper') },
              { value: 'online', label: t('tests_mode_online') },
            ]}
            hint={t('tests_mode_locked')}
          />
        ) : (
          <MSelect
            label={t('tests_mode_label')}
            value={f.mode}
            onChange={(v) => set('mode', v as SetupDraft['mode'])}
            options={[
              { value: 'paper', label: t('tests_mode_paper') },
              { value: 'online', label: t('tests_mode_online') },
            ]}
          />
        )}
        <MDatePicker
          label={t('tests_date_label')}
          value={f.date}
          onChange={(v) => set('date', v)}
          clearable
        />
        <ColorPicker label={t('color')} value={f.color} onChange={(v) => set('color', v)} />
      </div>

      {f.mode === 'online' && (
        <>
          <hr className="divider" />
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MDatePicker
              label={t('tests_open_label')}
              value={f.openDate}
              onChange={(v) => set('openDate', v)}
              clearable
            />
            <MTimePicker
              label={t('tests_open_label')}
              value={f.openTime}
              onChange={(v) => set('openTime', v)}
            />
            <MDatePicker
              label={t('tests_close_label')}
              value={f.closeDate}
              onChange={(v) => set('closeDate', v)}
              clearable
            />
            <MTimePicker
              label={t('tests_close_label')}
              value={f.closeTime}
              onChange={(v) => set('closeTime', v)}
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('tests_limit_label')}</label>
            <input
              className="mochi-input"
              type="number"
              min={1}
              max={300}
              placeholder={t('tests_limit_ph')}
              value={f.timeLimitMinutes}
              onChange={(e) => set('timeLimitMinutes', e.target.value)}
            />
          </div>
        </>
      )}

      <div className="mochi-field">
        <label className="mochi-field__label">{t('tests_instructions_label')}</label>
        <textarea
          className="mochi-input"
          rows={4}
          placeholder={t('tests_instructions_ph')}
          value={f.instructions}
          onChange={(e) => set('instructions', e.target.value)}
        />
      </div>

      <div className="m-row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <MBtn variant="primary" onClick={save}>
          {t('save')}
        </MBtn>
        <MBtn variant="secondary" onClick={togglePublish}>
          {t(test.status === 'published' ? 'tests_unpublish' : 'tests_publish')}
        </MBtn>
        <span style={{ flex: 1 }} />
        <MBtn variant="danger" onClick={del} iconLeft={<MIcon name="trash" size={16} />}>
          {t('delete')}
        </MBtn>
      </div>
      {confirmNode}
    </MC>
  );
}
