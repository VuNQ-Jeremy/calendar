import type { LoaderFunctionArgs, ClientLoaderFunctionArgs } from 'react-router';
import { LogsScreen } from '../../src/screens-logs.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import * as peopleSvc from '../../server/services/people';
import { ictDateOf } from '../../shared/logic/tests';
import { K, logsStudentKey, swrLoad } from '../../src/lib/route-cache.js';

/**
 * Logs — the admin's window on state the app normally only shows indirectly.
 *
 * `requireAdmin`, not `requireStaff`: this reads every student's rows at once, which is a school-
 * wide view rather than a teacher's. The nav row is `adminOnly` too, but the guard is what actually
 * enforces it — a hidden link is not a permission.
 *
 * Read-only by design. There is no action on this route: a diagnostic screen that can also write is
 * a screen you stop trusting as a diagnosis.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const studentId = params.studentId ?? null;
  const [students, scheduledWords] = await Promise.all([
    peopleSvc.listStudents(db),
    flashcardsSvc.listScheduledWords(db, { studentId }),
  ]);
  return {
    studentId,
    // Name and colour only: the picker needs nothing else, and the roster is the biggest thing
    // this loader touches.
    students: students.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    scheduledWords,
    limit: flashcardsSvc.SCHEDULED_WORDS_LIMIT,
    // ICT today, from the server, so "overdue" here means what it means everywhere else.
    today: ictDateOf(new Date().toISOString()),
  };
}

export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  // The unfiltered view MUST use K.logs — that is what cacheKeyForPath returns for a bare /logs,
  // and useStaleRouteRefresh compares against it. See logsStudentKey's note.
  const key = params.studentId ? logsStudentKey(params.studentId) : K.logs;
  return swrLoad(key, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export default function LogsRoute() {
  return <LogsScreen />;
}
