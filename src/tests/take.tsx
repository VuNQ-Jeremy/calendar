import React from 'react';
import { Link, useFetcher, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { splitIctFromUtc } from '../../shared/logic/tests.js';
import type { ReviewQuestion, StudentQuestion } from '../../server/services/attempts.js';

const { Card: MC, Button: MBtn, Tag: MTag, Badge: MBadge, Checkbox: MCheck, Input: MInput } = DS;

// ---------------------------------------------------------------- loader shape

/** Mirrors the shape app/routes/my-tests.$id.tsx returns. Never widened with an answer key. */
type TestMeta = {
  id: string;
  title: string;
  openAt: string | null;
  closeAt: string | null;
  timeLimitMinutes: number | null;
  instructions: string | null;
};

type AttemptLite = {
  id: string;
  status: 'in_progress' | 'submitted' | 'needs_grading' | 'graded';
  normalizedScore: number | null;
  submittedAt: string | null;
  deadlineAt: string | null;
};

type ReviewItem = {
  questionId: string;
  answer: string | string[] | null;
  autoCorrect: boolean | null;
  pointsEarned: number;
  feedback: string | null;
};

type Base = {
  test: TestMeta;
  window: 'upcoming' | 'open' | 'closed';
  serverNow: string;
  questionCount: number;
};

type NotStartedData = Base & { state: 'not_started' };
type TakingData = Base & {
  state: 'taking';
  attempt: AttemptLite;
  questions: StudentQuestion[];
  answers: { questionId: string; answer: string | string[] | null }[];
};
type SubmittedData = Base & { state: 'submitted'; attempt: AttemptLite };
/**
 * Graded is the ONLY state whose questions carry the answer key: the server only attaches it once
 * the teacher has finished marking (see `attemptsSvc.reviewForStudent`).
 */
type GradedData = Base & {
  state: 'graded';
  attempt: AttemptLite;
  questions: ReviewQuestion[];
  review: ReviewItem[];
  comment: string | null;
};

type TakeLoaderData = NotStartedData | TakingData | SubmittedData | GradedData;

type ActionData = { ok?: boolean; saved?: boolean; submitted?: boolean; error?: string };

type AnswerMap = Record<string, string | string[] | null>;

// ---------------------------------------------------------------- helpers

function ictLabel(isoUtc: string | null): string {
  if (!isoUtc) return '—';
  const { date, time } = splitIctFromUtc(isoUtc);
  return `${date} ${time}`;
}

/** mm:ss, or h:mm:ss once the remaining time passes an hour. Never negative. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function hasAnswer(v: string | string[] | null | undefined): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return v.trim() !== '';
}

/** Renders a stored answer for the review screen: option ids become their option text. */
function answerText(q: StudentQuestion, v: string | string[] | null): string {
  if (v == null) return '—';
  const label = (id: string) => q.options.find((o) => o.id === id)?.text ?? id;
  if (Array.isArray(v)) return v.length ? v.map(label).join(', ') : '—';
  if (q.type === 'mcq' || q.type === 'multi') return label(v);
  return v.trim() === '' ? '—' : v;
}

/**
 * The correct answer as a student can read it: option ids become their option text (a raw uuid
 * means nothing), a text question lists every accepted spelling, an essay has no key at all.
 * Returns null when there is nothing to show, so the caller can omit the whole row.
 */
function answerKeyText(q: ReviewQuestion): string | null {
  if (q.type === 'essay') return null;
  const key = q.answerKey;
  if (key == null) return null;
  const list = Array.isArray(key) ? key : [key];
  if (!list.length) return null;
  if (q.type === 'mcq' || q.type === 'multi') {
    return list.map((id) => q.options.find((o) => o.id === id)?.text ?? id).join(', ');
  }
  return list.join(', ');
}

/**
 * Milliseconds left on the attempt, corrected for a wrong client clock.
 *
 * The skew between this browser and the server is measured ONCE, on mount, against the loader's
 * `serverNow`; every later tick is `deadlineAt - (Date.now() - skew)`, so a student who winds their
 * system clock back does not buy extra time (and the server re-checks the deadline anyway).
 *
 * Returns null when the attempt has no deadline (no time limit and no closing time) — there is
 * nothing to count down. The single interval is created in the effect and always cleared on
 * unmount, and `stopped` tears it down the moment the attempt is submitted.
 */
function useCountdown(
  deadlineAt: string | null,
  serverNow: string,
  stopped: boolean,
): number | null {
  const skewRef = React.useRef<number | null>(null);
  // Starts null so the server render and the first client render agree; the effect fills it in.
  const [remaining, setRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!deadlineAt || stopped) return;
    if (skewRef.current == null) skewRef.current = Date.now() - Date.parse(serverNow);
    const skew = skewRef.current;
    const tick = () => setRemaining(Date.parse(deadlineAt) - (Date.now() - skew));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // serverNow is read once via the ref guard on purpose — re-measuring skew mid-attempt would
    // let a revalidation nudge the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, stopped]);

  return remaining;
}

// ---------------------------------------------------------------- question inputs

interface QuestionInputProps {
  q: StudentQuestion;
  value: string | string[] | null;
  onChange: (v: string | string[] | null) => void;
}

function McqInput({ q, value, onChange }: QuestionInputProps) {
  return (
    <div className="m-stack" style={{ gap: 8 }}>
      {q.options.map((opt) => (
        <MBtn
          key={opt.id}
          variant={value === opt.id ? 'primary' : 'secondary'}
          block={true}
          onClick={() => onChange(opt.id)}
        >
          {opt.text}
        </MBtn>
      ))}
    </div>
  );
}

function MultiInput({ q, value, onChange }: QuestionInputProps) {
  const { t } = useLang();
  const picked = Array.isArray(value) ? value : [];
  const toggle = (id: string) =>
    onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="m-stack" style={{ gap: 8 }}>
      <div className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
        {t('take_multi_hint')}
      </div>
      {q.options.map((opt) => (
        <MCheck
          key={opt.id}
          label={opt.text}
          checked={picked.includes(opt.id)}
          onChange={() => toggle(opt.id)}
        />
      ))}
    </div>
  );
}

function QuestionCard({ q, index, value, onChange }: QuestionInputProps & { index: number }) {
  const { t } = useLang();
  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontWeight: 800, minWidth: 24 }}>{index + 1}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{q.prompt}</div>
          <div style={{ marginTop: 10 }}>
            {q.type === 'mcq' && <McqInput q={q} value={value} onChange={onChange} />}
            {q.type === 'multi' && <MultiInput q={q} value={value} onChange={onChange} />}
            {q.type === 'text' && (
              <MInput
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
              />
            )}
            {q.type === 'essay' && (
              <textarea
                className="mochi-input"
                rows={6}
                style={{ width: '100%', resize: 'vertical' }}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
              />
            )}
          </div>
        </div>
        <MTag>{t('print_points_suffix', { n: q.points })}</MTag>
      </div>
    </MC>
  );
}

// ---------------------------------------------------------------- states

function BackLink() {
  const { t } = useLang();
  return (
    <Link to="/my-tests" style={{ color: 'var(--text-link)', fontWeight: 600 }}>
      ← {t('my_tests_title')}
    </Link>
  );
}

function NotStarted({ data }: { data: NotStartedData }) {
  const { t } = useLang();
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== 'idle';

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={data.test.title} subtitle={<BackLink />} />
      <MC style={{ padding: 16 }}>
        <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {data.window === 'open' ? (
            <MBadge color="green">
              {t('my_tests_open', { time: ictLabel(data.test.closeAt) })}
            </MBadge>
          ) : data.window === 'upcoming' ? (
            <MBadge color="blue">
              {t('my_tests_upcoming', { time: ictLabel(data.test.openAt) })}
            </MBadge>
          ) : (
            <MBadge color="cocoa">{t('my_tests_closed')}</MBadge>
          )}
          {data.test.timeLimitMinutes != null && (
            <MTag>{t('print_time_limit', { n: data.test.timeLimitMinutes })}</MTag>
          )}
          <MTag>{t('tests_q_count', { n: data.questionCount })}</MTag>
        </div>
        {data.test.instructions && (
          <div style={{ marginBottom: 12 }}>
            <div className="mochi-eyebrow">{t('take_instructions')}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{data.test.instructions}</div>
          </div>
        )}
        {data.window === 'open' ? (
          data.questionCount === 0 ? (
            <div className="m-muted">{t('take_no_questions')}</div>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="start" />
              <MBtn type="submit" variant="primary" disabled={busy}>
                {t('take_start')}
              </MBtn>
            </fetcher.Form>
          )
        ) : (
          <div className="m-muted">
            {data.window === 'upcoming' ? t('take_not_open') : t('take_closed')}
          </div>
        )}
        {fetcher.data?.error && !fetcher.data.ok && (
          <div style={{ marginTop: 10, color: 'var(--text-danger, crimson)' }}>
            {t('take_closed')}
          </div>
        )}
      </MC>
    </div>
  );
}

function Taking({ data }: { data: TakingData }) {
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const saveFetcher = useFetcher<ActionData>();
  const submitFetcher = useFetcher<ActionData>();

  const [answers, setAnswers] = React.useState<AnswerMap>(() => {
    const seed: AnswerMap = {};
    for (const a of data.answers) seed[a.questionId] = a.answer;
    return seed;
  });
  // Bumped on every edit. Starts at 0 so the debounce effect below cannot fire on first render.
  const [revision, setRevision] = React.useState(0);
  const [pendingSubmit, setPendingSubmit] = React.useState(false);
  const [timeUp, setTimeUp] = React.useState(false);

  const answersRef = React.useRef(answers);
  answersRef.current = answers;
  const unsavedRef = React.useRef(false);
  /** Latches the moment a submit is requested, so no re-render can fire a second one. */
  const submittedRef = React.useRef(false);

  const saveRef = React.useRef<() => void>(() => {});
  saveRef.current = () => {
    unsavedRef.current = false;
    const payload = Object.entries(answersRef.current).map(([questionId, answer]) => ({
      questionId,
      answer,
    }));
    const fd = new FormData();
    fd.set('intent', 'save-answers');
    fd.set('answers', JSON.stringify(payload));
    saveFetcher.submit(fd, { method: 'post' });
  };

  // Autosave: one debounce window per burst of edits, cleared and restarted by the next edit.
  React.useEffect(() => {
    if (revision === 0) return;
    const id = window.setTimeout(() => saveRef.current(), 800);
    return () => window.clearTimeout(id);
  }, [revision]);

  const setAnswer = (questionId: string, value: string | string[] | null) => {
    if (submittedRef.current) return;
    unsavedRef.current = true;
    setAnswers((p) => ({ ...p, [questionId]: value }));
    setRevision((r) => r + 1);
  };

  const requestSubmit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    // Flush anything the debounce has not sent yet, so the submit grades the latest answers.
    if (unsavedRef.current) saveRef.current();
    setPendingSubmit(true);
  };

  // Fires the actual submit once the in-flight autosave has landed.
  React.useEffect(() => {
    if (!pendingSubmit || saveFetcher.state !== 'idle') return;
    setPendingSubmit(false);
    const fd = new FormData();
    fd.set('intent', 'submit');
    submitFetcher.submit(fd, { method: 'post' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, saveFetcher.state]);

  const remaining = useCountdown(data.attempt.deadlineAt, data.serverNow, submittedRef.current);

  // Auto-submit at zero. `submittedRef` is the single-fire guard; `stopped` above kills the
  // interval as soon as it latches, so this cannot run twice however often the component renders.
  React.useEffect(() => {
    if (remaining == null || remaining > 0) return;
    setTimeUp(true);
    requestSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const onSubmitClick = async () => {
    const unanswered = data.questions.filter((q) => !hasAnswer(answers[q.id])).length;
    const ok = await confirm({
      title: t('take_submit'),
      message:
        t('take_submit_confirm') +
        (unanswered > 0 ? ' ' + t('take_unanswered_warn', { n: unanswered }) : ''),
      confirmLabel: t('take_submit'),
    });
    if (ok) requestSubmit();
  };

  const answered = data.questions.filter((q) => hasAnswer(answers[q.id])).length;
  const closedByServer =
    saveFetcher.data?.error === 'attempt_closed' || submitFetcher.data?.error === 'attempt_closed';
  const warn = remaining != null && remaining > 0 && remaining <= 60_000;

  if (closedByServer || timeUp) {
    return (
      <div className="m-stack" style={{ gap: 12 }}>
        <PageHeader title={data.test.title} subtitle={<BackLink />} />
        <MC style={{ padding: 16 }}>
          <div style={{ fontWeight: 700 }}>{t('take_auto_submitted')}</div>
          <div className="m-muted" style={{ marginTop: 6 }}>
            {t('take_awaiting_grading')}
          </div>
        </MC>
      </div>
    );
  }

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={data.test.title} subtitle={<BackLink />} />
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--surface, #fff)',
          padding: '10px 0',
        }}
      >
        <MC style={{ padding: 12 }}>
          <div className="m-row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mochi-eyebrow">{t('take_answered')}</span>
            <span style={{ fontWeight: 700 }}>
              {answered}/{data.questions.length}
            </span>
            {remaining != null && (
              <span style={{ marginLeft: 'auto', fontWeight: 800 }}>
                {t('take_time_left')} {formatRemaining(remaining)}
              </span>
            )}
            <span className="m-muted" style={{ fontSize: 'var(--text-sm)', minWidth: 70 }}>
              {saveFetcher.state !== 'idle'
                ? t('take_saving')
                : saveFetcher.data?.saved
                  ? t('take_saved')
                  : ''}
            </span>
          </div>
        </MC>
      </div>
      {warn && <MC style={{ padding: 12, fontWeight: 600 }}>{t('take_auto_submit_warn')}</MC>}
      {data.questions.length === 0 ? (
        <Empty icon="clipboard" title={t('take_no_questions')} />
      ) : (
        data.questions.map((q, i) => (
          <QuestionCard
            key={q.id}
            q={q}
            index={i}
            value={answers[q.id] ?? null}
            onChange={(v) => setAnswer(q.id, v)}
          />
        ))
      )}
      <div className="m-row" style={{ justifyContent: 'flex-end' }}>
        <MBtn
          variant="primary"
          onClick={onSubmitClick}
          disabled={submitFetcher.state !== 'idle' || pendingSubmit}
        >
          {t('take_submit')}
        </MBtn>
      </div>
      {confirmNode}
    </div>
  );
}

function SubmittedView({ data }: { data: SubmittedData }) {
  const { t } = useLang();
  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={data.test.title} subtitle={<BackLink />} />
      <MC style={{ padding: 16 }}>
        <div style={{ fontWeight: 700 }}>{t('take_submitted')}</div>
        <div className="m-muted" style={{ marginTop: 6 }}>
          {t('take_awaiting_grading')}
        </div>
      </MC>
    </div>
  );
}

function ReviewCard({ q, index, item }: { q: ReviewQuestion; index: number; item?: ReviewItem }) {
  const { t } = useLang();
  const keyText = answerKeyText(q);
  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <span style={{ fontWeight: 800, minWidth: 24 }}>{index + 1}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{q.prompt}</div>
          <div style={{ marginTop: 8 }}>
            <span className="mochi-eyebrow">{t('take_review_your_answer')}</span>
            <div style={{ whiteSpace: 'pre-wrap' }}>{answerText(q, item?.answer ?? null)}</div>
          </div>
          {keyText && (
            <div style={{ marginTop: 8 }}>
              <span className="mochi-eyebrow">{t('take_review_answer')}</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{keyText}</div>
            </div>
          )}
          {q.explanation && (
            <div style={{ marginTop: 8 }}>
              <span className="mochi-eyebrow">{t('take_review_explanation')}</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{q.explanation}</div>
            </div>
          )}
          {item?.feedback && (
            <div style={{ marginTop: 8 }}>
              <span className="mochi-eyebrow">{t('take_review_feedback')}</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{item.feedback}</div>
            </div>
          )}
        </div>
        <div className="m-stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          {item?.autoCorrect != null &&
            (item.autoCorrect ? (
              <MBadge color="green">{t('take_review_correct')}</MBadge>
            ) : (
              <MBadge color="cocoa">{t('take_review_incorrect')}</MBadge>
            ))}
          <MTag>
            {t('take_points_earned', { earned: item?.pointsEarned ?? 0, points: q.points })}
          </MTag>
        </div>
      </div>
    </MC>
  );
}

function GradedView({ data }: { data: GradedData }) {
  const { t } = useLang();
  const byId = new Map(data.review.map((r) => [r.questionId, r]));
  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={data.test.title} subtitle={<BackLink />} />
      <MC style={{ padding: 16 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="mochi-eyebrow">{t('take_score')}</span>
          <span style={{ fontWeight: 800, fontSize: 'var(--text-xl, 28px)' }}>
            {data.attempt.normalizedScore ?? 0}/10
          </span>
        </div>
        {data.comment && (
          <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{data.comment}</div>
        )}
      </MC>
      {data.questions.map((q, i) => (
        <ReviewCard key={q.id} q={q} index={i} item={byId.get(q.id)} />
      ))}
    </div>
  );
}

export function TakeTestScreen() {
  const data = useLoaderData() as TakeLoaderData;
  if (data.state === 'taking') return <Taking data={data} />;
  if (data.state === 'submitted') return <SubmittedView data={data} />;
  if (data.state === 'graded') return <GradedView data={data} />;
  return <NotStarted data={data} />;
}
