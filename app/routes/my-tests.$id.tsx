import { redirect } from 'react-router';
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { TakeTestScreen } from '../../src/tests/take.jsx';
import { createDb } from '../../server/db/index';
import type { Db } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as attemptsSvc from '../../server/services/attempts';
import type { StudentQuestion } from '../../server/services/attempts';
import * as testsSvc from '../../server/services/tests';
import * as questionsSvc from '../../server/services/questions';
import { isWindowOpen } from '../../shared/logic/tests';
import { AttemptAnswersSaveInput } from '../../shared/schemas';

/**
 * Taking one online test.
 *
 * DELIBERATELY NO clientLoader / no route cache: the payload carries `serverNow` and the
 * attempt's `deadlineAt`, and the browser's countdown is derived from both. Serving a cached
 * `serverNow` would hand the client a stale clock reference and could show time remaining on an
 * attempt that has already expired, so this route always hits the server.
 */

/** What the student's session may know about one question — never an answer key. */
type ReviewItem = {
  questionId: string;
  answer: string | string[] | null;
  autoCorrect: boolean | null;
  /** Effective marks: the teacher's override, else the machine's, else zero. */
  pointsEarned: number;
  feedback: string | null;
};

/**
 * The `StudentQuestion[]` projection for a test, built without going through `start()`.
 *
 * Used only by the `in_progress` branch: `start()` refuses a closed window, so an attempt still
 * marked in-progress after the test closed could not render its paper through it at all. This
 * builds the SAME `StudentQuestion` shape from the question bank and is typed as such, so
 * `answerKey` and `explanation` are dropped here on the server and cannot reach the client.
 * (The graded branch goes through `attemptsSvc.reviewForStudent`, which does include the keys.)
 */
async function studentQuestionsOf(db: Db, testId: string): Promise<StudentQuestion[]> {
  const [links, bank] = await Promise.all([
    testsSvc.listQuestionLinks(db, testId),
    questionsSvc.list(db),
  ]);
  const byId = new Map(bank.map((q) => [q.id, q]));
  return links.flatMap((l): StudentQuestion[] => {
    const q = byId.get(l.questionId);
    if (!q) return [];
    return [
      {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        points: l.points,
        sortOrder: l.sortOrder,
      },
    ];
  });
}

/**
 * Resolves the test + the student's own attempt from the SESSION student id.
 *
 * Going through `listOpenForStudent` rather than a bare test lookup is what enforces enrollment:
 * a test that is not published, not online, or not in one of this student's classes never appears
 * in the list, and the absence becomes a 404 here.
 */
async function ownItem(db: Db, testId: string, studentId: string, now: Date) {
  const items = await attemptsSvc.listOpenForStudent(db, studentId, now);
  const item = items.find((i) => i.test.id === testId);
  if (!item) throw Response.json({ error: 'test_not_found' }, { status: 404 });
  return item;
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  if (kind === 'staff') throw redirect('/tests');
  if (kind !== 'student') throw redirect('/profile');

  const db = createDb(env);
  const now = new Date();
  const serverNow = now.toISOString();
  const item = await ownItem(db, params.id!, user.id, now);
  const test = item.test;
  const window = isWindowOpen(test.openAt, test.closeAt, now);
  const questionCount = (await testsSvc.listQuestionLinks(db, test.id)).length;

  const base = { test, window, serverNow, questionCount };
  const attempt = item.attempt;

  if (!attempt) return { ...base, state: 'not_started' as const };

  if (attempt.status === 'in_progress') {
    // `start` is idempotent and never moves an existing deadline, so re-entering is safe. It does
    // refuse a closed window, in which case the projection below stands in.
    let questions: StudentQuestion[];
    try {
      questions = (await attemptsSvc.start(db, test.id, user.id, now)).questions;
    } catch (e) {
      if (!(e instanceof Response)) throw e;
      questions = await studentQuestionsOf(db, test.id);
    }
    const saved = await attemptsSvc.listAnswers(db, attempt.id);
    return {
      ...base,
      state: 'taking' as const,
      attempt,
      questions,
      answers: saved.map((a) => ({ questionId: a.questionId, answer: a.answer })),
    };
  }

  if (attempt.status === 'graded') {
    // The service is the gate: it re-checks ownership from the SESSION student id and refuses to
    // hand over answer keys unless the attempt really is graded. A 409 `not_graded` here means the
    // status moved under us (a reset, or a concurrent regrade) — fall through to status-only.
    let review: attemptsSvc.AttemptReview | null = null;
    try {
      review = await attemptsSvc.reviewForStudent(db, attempt.id, user.id);
    } catch (e) {
      if (!(e instanceof Response)) throw e;
      review = null;
    }
    if (review) {
      const bySaved = new Map(review.answers.map((a) => [a.questionId, a]));
      const items: ReviewItem[] = review.questions.map((q) => {
        const a = bySaved.get(q.id);
        return {
          questionId: q.id,
          answer: a?.answer ?? null,
          autoCorrect: a?.autoCorrect ?? null,
          pointsEarned: a?.manualPoints ?? a?.autoPoints ?? 0,
          feedback: a?.feedback ?? null,
        };
      });
      return {
        ...base,
        state: 'graded' as const,
        attempt,
        questions: review.questions,
        review: items,
        comment: review.attempt.comment,
      };
    }
  }

  // submitted / needs_grading: status only. No questions, no answers, no marks — the student must
  // not be able to reconstruct the paper (or infer a grade) while a teacher is still marking it.
  return { ...base, state: 'submitted' as const, attempt };
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user, kind } = await requireUser(request, env);
  if (kind !== 'student') return Response.json({ error: 'forbidden' }, { status: 403 });

  const db = createDb(env);
  const now = new Date();
  const testId = params.id!;
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  // The services throw Responses (403 not_enrolled, 404 attempt_not_found, 409
  // attempt_closed/window_closed, 400 unknown_question). Return them so the screen can render a
  // friendly state — an expired attempt is a normal outcome, not a crash.
  try {
    if (intent === 'start') {
      const started = await attemptsSvc.start(db, testId, user.id, now);
      return { ok: true, attempt: started.attempt };
    }

    // Never trust a client-supplied attempt id: it is always looked up from the session student.
    const item = await ownItem(db, testId, user.id, now);
    if (!item.attempt) return Response.json({ error: 'attempt_not_found' }, { status: 404 });
    const attemptId = item.attempt.id;

    if (intent === 'save-answers') {
      let answersRaw: unknown;
      try {
        answersRaw = JSON.parse((formData.get('answers') as string) ?? '[]');
      } catch {
        return Response.json({ error: 'bad answers json' }, { status: 400 });
      }
      const parsed = AttemptAnswersSaveInput.safeParse({ attemptId, answers: answersRaw });
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      await attemptsSvc.saveAnswers(db, attemptId, user.id, parsed.data.answers, now);
      return { ok: true, saved: true };
    }

    if (intent === 'submit') {
      const attempt = await attemptsSvc.submit(db, attemptId, user.id, now);
      return { ok: true, submitted: true, attempt };
    }
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function MyTestDetail() {
  return <TakeTestScreen />;
}
