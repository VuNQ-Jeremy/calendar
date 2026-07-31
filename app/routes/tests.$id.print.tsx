import type { LoaderFunctionArgs } from 'react-router';
import { TestPrintView } from '../../src/tests/print-view.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as testsSvc from '../../server/services/tests';
import * as questionsSvc from '../../server/services/questions';
import * as classesSvc from '../../server/services/classes';
import * as glSvc from '../../server/services/grade-levels';

/**
 * Printable paper-mode test: a plain A4 document a teacher can print and hand out.
 *
 * Registered OUTSIDE the `_app` layout — this is a print document, not an app screen, so it
 * gets no app shell, no nav chrome, and no route cache (`?key=1` toggles the answer-key
 * variant, and a cached blank/key mix-up would be a correctness bug on paper).
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const id = params.id!;
  const showKey = !!new URL(request.url).searchParams.get('key');

  const test = await testsSvc.get(db, id);
  const [links, questions, classes, gradeLevels, totalPoints] = await Promise.all([
    testsSvc.listQuestionLinks(db, id),
    questionsSvc.list(db),
    classesSvc.list(db),
    glSvc.list(db),
    testsSvc.totalPoints(db, id),
  ]);

  // Join the links (already ordered by sortOrder) against the question bank, carrying each
  // link's per-question points. A link whose question row has vanished is dropped.
  const joined = links.flatMap((link) => {
    const q = questions.find((x) => x.id === link.questionId);
    return q ? [{ ...q, points: link.points }] : [];
  });

  // The blank test must not ship the answers in its HTML: a student could read the page
  // source (or the embedded loader payload) and lift the key straight out of it. Strip
  // `answerKey` and `explanation` on the server whenever the key variant was not requested.
  const items = showKey
    ? joined
    : joined.map((q) => ({ ...q, answerKey: null, explanation: null }));

  const className = test.classId
    ? (classes.find((c) => c.id === test.classId)?.name ?? null)
    : null;
  const gradeName = test.gradeLevelId
    ? (gradeLevels.find((g) => g.id === test.gradeLevelId)?.name ?? null)
    : null;

  return { test, items, className, gradeName, totalPoints, showKey };
}

export default function TestPrint() {
  return <TestPrintView />;
}
