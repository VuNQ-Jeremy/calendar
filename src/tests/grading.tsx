import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { Modal, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { normalizeScore, splitIctFromUtc } from '../../shared/logic/tests.js';
import type { TestAttemptRow, TestQuestionRow } from '../../server/services/tests.js';
import type { QuestionRow } from '../../server/services/questions.js';
import type { AnswerRow } from '../../server/services/attempts.js';
import type { StudentRow } from '../../server/services/people.js';

const { Card: MC, Button: MBtn, Badge: MBadge, Tag: MTag, Avatar: MAv } = DS;

type AttemptStatus = TestAttemptRow['status'];

const STATUS_TK: Record<AttemptStatus, string> = {
  in_progress: 'grading_in_progress',
  submitted: 'grading_submitted',
  needs_grading: 'grading_needs_grading',
  graded: 'grading_graded',
};

const STATUS_COLOR: Record<AttemptStatus, string> = {
  in_progress: 'blue',
  submitted: 'violet',
  needs_grading: 'orange',
  graded: 'green',
};

/** needs_grading is the teacher's to-do, so it sorts to the top; no attempt sinks to the bottom. */
const STATUS_ORDER: Record<AttemptStatus, number> = {
  needs_grading: 0,
  submitted: 1,
  graded: 2,
  in_progress: 3,
};
const NO_ATTEMPT_ORDER = 4;

const TYPE_TK: Record<QuestionRow['type'], string> = {
  mcq: 'qb_type_mcq',
  multi: 'qb_type_multi',
  text: 'qb_type_text',
  essay: 'qb_type_essay',
};

/** 'YYYY-MM-DD HH:MM' in ICT — the only timezone this school uses. */
function ictStamp(isoUtc: string | null): string {
  if (!isoUtc) return '—';
  const { date, time } = splitIctFromUtc(isoUtc);
  return `${date} ${time}`;
}

function numOr(raw: string, fallback: number): number {
  if (raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

interface ResultsTableProps {
  roster: StudentRow[];
  attempts: TestAttemptRow[];
  action: string;
  onReview: (attempt: TestAttemptRow) => void;
}

export function ResultsTable({ roster, attempts, action, onReview }: ResultsTableProps) {
  const { t } = useLang();
  const resetFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [confirm, confirmNode] = useConfirm();

  const rows = React.useMemo(() => {
    const byStudent = new Map(attempts.map((a) => [a.studentId, a]));
    return roster
      .map((student) => ({ student, attempt: byStudent.get(student.id) ?? null }))
      .sort((a, b) => {
        const oa = a.attempt ? STATUS_ORDER[a.attempt.status] : NO_ATTEMPT_ORDER;
        const ob = b.attempt ? STATUS_ORDER[b.attempt.status] : NO_ATTEMPT_ORDER;
        if (oa !== ob) return oa - ob;
        return a.student.name.localeCompare(b.student.name);
      });
  }, [roster, attempts]);

  const needCount = attempts.filter((a) => a.status === 'needs_grading').length;
  const gradedCount = attempts.filter((a) => a.status === 'graded').length;

  const doReset = async (attempt: TestAttemptRow, name: string) => {
    if (
      await confirm({
        title: t('grading_reset'),
        message: `${name} — ${t('grading_reset_confirm')}`,
        confirmLabel: t('grading_reset'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'reset-attempt');
      fd.set('attemptId', attempt.id);
      resetFetcher.submit(fd, { action, method: 'post' });
    }
  };

  if (!roster.length) return <Empty icon="users" title={t('att_empty_roster')} />;

  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="mochi-eyebrow" style={{ flex: 1 }}>
          {t('grading_title')}
        </span>
        {needCount > 0 && (
          <MBadge color="orange">{t('tests_needs_grading', { n: needCount })}</MBadge>
        )}
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('grading_graded_count', { n: gradedCount })}
        </span>
      </div>

      {resetFetcher.data?.error && (
        <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 10 }}>
          {resetFetcher.data.error}
        </div>
      )}

      <div className="m-stack" style={{ gap: 6 }}>
        {rows.map(({ student, attempt }) => (
          <div key={student.id} className="lrow" style={{ gap: 10, flexWrap: 'wrap' }}>
            <MAv name={student.name} color={student.color} size="sm" />
            <span style={{ flex: 1, minWidth: 120 }} className="lrow__title">
              {student.name}
            </span>

            {attempt ? (
              <MBadge color={STATUS_COLOR[attempt.status]}>{t(STATUS_TK[attempt.status])}</MBadge>
            ) : (
              <MBadge color="cocoa">{t('grading_not_started')}</MBadge>
            )}

            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', minWidth: 150 }}>
              {attempt?.status === 'in_progress'
                ? attempt.deadlineAt
                  ? ictStamp(attempt.deadlineAt)
                  : '—'
                : `${t('grading_submitted_at')}: ${ictStamp(attempt?.submittedAt ?? null)}`}
            </span>

            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', minWidth: 110 }}>
              {t('grading_auto_score')}: {attempt?.autoScore ?? '—'}
            </span>

            <span style={{ fontSize: 'var(--text-sm)', minWidth: 110, fontWeight: 600 }}>
              {t('grading_final_score')}:{' '}
              {attempt?.normalizedScore != null ? `${attempt.normalizedScore}/10` : '—'}
            </span>

            <MBtn
              size="sm"
              variant={attempt?.status === 'needs_grading' ? 'primary' : 'secondary'}
              disabled={!attempt || attempt.status === 'in_progress'}
              onClick={() => attempt && onReview(attempt)}
            >
              {t(attempt?.status === 'graded' ? 'grading_review' : 'grading_grade')}
            </MBtn>
            <MBtn
              size="sm"
              variant="ghost"
              disabled={!attempt || resetFetcher.state !== 'idle'}
              onClick={() => attempt && doReset(attempt, student.name)}
            >
              {t('grading_reset')}
            </MBtn>
          </div>
        ))}
      </div>
      {confirmNode}
    </MC>
  );
}

interface AttemptGradeModalProps {
  open: boolean;
  onClose: () => void;
  attempt: TestAttemptRow | null;
  student: StudentRow | undefined;
  links: TestQuestionRow[];
  questions: QuestionRow[];
  answers: AnswerRow[];
  action: string;
}

type Draft = { points: string; feedback: string };

export function AttemptGradeModal({
  open,
  onClose,
  attempt,
  student,
  links,
  questions,
  answers,
  action,
}: AttemptGradeModalProps) {
  const { t } = useLang();
  const fetcher = useFetcher<{ ok?: boolean; attempt?: TestAttemptRow; error?: string }>();

  const items = React.useMemo(() => {
    const byId = new Map(questions.map((q) => [q.id, q]));
    const byQ = new Map(answers.map((a) => [a.questionId, a]));
    return [...links]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((l) => {
        const q = byId.get(l.questionId);
        if (!q) return [];
        return [{ link: l, q, answer: byQ.get(l.questionId) ?? null }];
      });
  }, [links, questions, answers]);

  // maxTotalPoints must be the sum over ALL the test's questions (essays included) — the same
  // figure `attempts.grade` sums server-side. Anything else would preview a score we never store.
  const maxTotalPoints = React.useMemo(() => links.reduce((s, l) => s + l.points, 0), [links]);

  const [draft, setDraft] = React.useState<Record<string, Draft>>({});
  const [override, setOverride] = React.useState('');
  const [comment, setComment] = React.useState('');

  // Seed from loader data on every open / attempt switch. Edits stay local: loader data is
  // never mutated, and the route's clientAction refetches after a successful save.
  React.useEffect(() => {
    if (!open || !attempt) return;
    const seeded: Record<string, Draft> = {};
    for (const { link, answer } of items) {
      const pts = answer?.manualPoints ?? answer?.autoPoints ?? 0;
      seeded[link.questionId] = { points: String(pts), feedback: answer?.feedback ?? '' };
    }
    setDraft(seeded);
    setComment(attempt.comment ?? '');
    setOverride('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt?.id]);

  const setPoints = (qid: string, points: string) =>
    setDraft((d) => ({ ...d, [qid]: { ...(d[qid] ?? { feedback: '' }), points } }));
  const setFeedback = (qid: string, feedback: string) =>
    setDraft((d) => ({ ...d, [qid]: { ...(d[qid] ?? { points: '' }), feedback } }));

  // Mirrors the server exactly: manualPoints ?? autoPoints ?? 0. A blank input sends null, so the
  // preview must fall back to the auto mark for that question too.
  const total = items.reduce(
    (sum, { link, answer }) =>
      sum + numOr(draft[link.questionId]?.points ?? '', answer?.autoPoints ?? 0),
    0,
  );
  const derived = normalizeScore(total, maxTotalPoints);

  const save = () => {
    if (!attempt) return;
    const grades = items.map(({ link }) => {
      const raw = draft[link.questionId]?.points ?? '';
      const fb = draft[link.questionId]?.feedback ?? '';
      return {
        questionId: link.questionId,
        manualPoints: raw.trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw),
        feedback: fb.trim() === '' ? null : fb,
      };
    });
    const fd = new FormData();
    fd.set('intent', 'grade-attempt');
    fd.set('attemptId', attempt.id);
    fd.set(
      'payload',
      JSON.stringify({
        grades,
        normalizedOverride: override.trim() === '' ? null : Number(override),
        comment: comment.trim() === '' ? null : comment,
      }),
    );
    fetcher.submit(fd, { action, method: 'post' });
  };

  const saving = fetcher.state !== 'idle';
  const saved = !saving && fetcher.data?.ok === true;

  if (!open || !attempt) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('grading_title')}
      subtitle={student?.name}
      width={760}
      footer={
        <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', width: '100%' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>
            {t('grading_total')}: <b>{Math.round(total * 100) / 100}</b> / {maxTotalPoints}
          </span>
          <span style={{ fontSize: 'var(--text-sm)' }}>
            {t('grading_derived')}: <b>{derived}</b>/10
          </span>
          <span style={{ flex: 1 }} />
          {saved && (
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
              {t('grading_saved')}
            </span>
          )}
          <MBtn variant="ghost" onClick={onClose}>
            {t('close')}
          </MBtn>
          <MBtn variant="primary" onClick={save} disabled={saving}>
            {t('grading_save')}
          </MBtn>
        </div>
      }
    >
      {fetcher.data?.error && (
        <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginBottom: 10 }}>
          {fetcher.data.error}
        </div>
      )}

      <div className="m-stack" style={{ gap: 14 }}>
        {items.map(({ link, q, answer }, i) => (
          <MC key={link.questionId} flat style={{ padding: 12 }}>
            <div className="m-row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 'var(--text-sm)' }}>{i + 1}.</b>
              <span style={{ flex: 1, minWidth: 120 }}>{q.prompt}</span>
              <MTag>{t(TYPE_TK[q.type])}</MTag>
              <MBadge color="cocoa">{t('tests_total_points', { n: link.points })}</MBadge>
              {q.type === 'essay' ? (
                <MBadge color="violet">{t('grading_manual_only')}</MBadge>
              ) : (
                <MBadge color={answer?.autoCorrect ? 'green' : 'orange'}>
                  {answer?.autoCorrect ? '✓' : '✗'}
                </MBadge>
              )}
            </div>

            <div style={{ fontSize: 'var(--text-sm)', marginBottom: 4 }}>
              {renderAnswer(q, answer?.answer ?? null) || t('grading_no_answer')}
            </div>

            {q.type !== 'essay' && (
              <div
                className="m-muted"
                style={{ fontSize: 'var(--text-sm)', marginBottom: q.explanation ? 2 : 8 }}
              >
                {t('grading_correct_answer')}: {renderAnswer(q, q.answerKey) || '—'}
              </div>
            )}
            {q.explanation && (
              <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 8 }}>
                {q.explanation}
              </div>
            )}

            <div className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div style={{ width: 120 }}>
                <label className="mochi-field__label">{t('grading_points_label')}</label>
                <input
                  className="mochi-input"
                  type="number"
                  step="0.5"
                  min="0"
                  max={link.points}
                  value={draft[link.questionId]?.points ?? ''}
                  onChange={(e) => setPoints(link.questionId, e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="mochi-field__label">{t('grading_feedback_ph')}</label>
                <input
                  className="mochi-input"
                  placeholder={t('grading_feedback_ph')}
                  value={draft[link.questionId]?.feedback ?? ''}
                  onChange={(e) => setFeedback(link.questionId, e.target.value)}
                />
              </div>
            </div>
          </MC>
        ))}
      </div>

      <hr className="divider" />

      <div className="m-row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 150 }}>
          <label className="mochi-field__label">{t('grading_override')}</label>
          <input
            className="mochi-input"
            type="number"
            step="0.25"
            min="0"
            max="10"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
          />
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('grading_override_hint')}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="mochi-field__label">{t('grading_comment_label')}</label>
          <textarea
            className="mochi-input"
            rows={3}
            placeholder={t('grading_comment_ph')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/** mcq/multi answers are option ids — resolve them to the option text the student actually saw. */
function renderAnswer(q: QuestionRow, value: string | string[] | null): string {
  if (value == null) return '';
  if (q.type === 'mcq' || q.type === 'multi') {
    const ids = Array.isArray(value) ? value : [value];
    const labels = ids
      .map((id) => q.options.find((o) => o.id === id)?.text ?? id)
      .filter((s) => s !== '');
    return labels.join(', ');
  }
  return Array.isArray(value) ? value.join(', ') : value;
}
