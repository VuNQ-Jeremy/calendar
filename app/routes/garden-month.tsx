import type { LoaderFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as svc from '../../server/services/garden';
import { TuitionMonth } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * One student's garden month for the assessments monthly report — the cookie-authenticated twin
 * of /api/garden/month/:id, which serves the mobile app over a bearer token.
 *
 * The twin exists because everything under /api/* authenticates by `Authorization: Bearer` ONLY
 * (server/api/auth.ts): a browser sends the session cookie and no header, so the report card's
 * `useFetcher().load` got a 401 on every call and silently rendered nothing. Every other
 * fetcher on the web client talks to a cookie-authed route like this one; the report card was
 * the only place that pointed at /api/*.
 *
 * Student and month ride as query params rather than a path segment, matching the other twins
 * (event-previews, event-materials).
 *
 * `TuitionMonth` is the project's shared 'YYYY-MM' guard — the name is about where it started,
 * not what it validates. Today is the ICT day because a plant's wilt is keyed on the ICT day and
 * the Worker clock is UTC.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const db = tenantDbFor(env, await requireStaff(request, env));

  const url = new URL(request.url);
  const studentId = url.searchParams.get('student');
  if (!studentId) return Response.json({ error: 'missing_student' }, { status: 400 });
  const parsed = TuitionMonth.safeParse(url.searchParams.get('month'));
  if (!parsed.success) return Response.json({ error: 'bad_month' }, { status: 400 });

  // The `{ data }` envelope mirrors the /api twin, so both clients read the same shape — and the
  // card's `error` branch (which drops the card rather than breaking the report) keeps working.
  const summary = await svc.studentGardenMonth(
    db,
    studentId,
    parsed.data,
    ictDateOf(new Date().toISOString()),
  );
  return { data: summary };
}
