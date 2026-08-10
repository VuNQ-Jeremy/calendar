import { eq } from 'drizzle-orm';
import { createDb, type Db } from '../db';
import { sessions } from '../db/schema';
import { hashToken } from '../services/crypto';
import {
  DAY_MS,
  requireStaff,
  userFromToken,
  type SessionUser,
  type LearnerUser,
  type ParentUser,
} from '../services/auth';

/**
 * Bearer-token auth for the JSON API.
 *
 * These guards exist alongside requireUser/requireStaff/requireAdmin in services/auth.ts,
 * which are for the BROWSER and throw `redirect()`. A 302 to an HTML login page is useless
 * to a native client, so everything here throws a machine-readable JSON Response instead.
 *
 * Both paths read the same `sessions` table, so a device and a browser are just two
 * concurrent sessions on one account.
 */

/** Mobile sessions last this long, refreshed on use. */
export const MOBILE_TTL_DAYS = 90;

/**
 * Only extend a session once it has burned more than a week of its window. Without this
 * throttle every authenticated request would write to D1.
 */
const SLIDE_AFTER_MS = 7 * DAY_MS;

function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Push `expires_at` back out to the full window, but only if it has drifted far enough in. */
async function slideExpiry(db: Db, rawToken: string): Promise<void> {
  const tokenHash = await hashToken(rawToken);
  const row = await db.query.sessions.findFirst({ where: eq(sessions.token, tokenHash) });
  if (!row) return;
  const full = Date.now() + MOBILE_TTL_DAYS * DAY_MS;
  if (full - new Date(row.expiresAt).getTime() < SLIDE_AFTER_MS) return;
  await db
    .update(sessions)
    .set({ expiresAt: new Date(full).toISOString() })
    .where(eq(sessions.token, tokenHash));
}

/**
 * Resolve the caller from `Authorization: Bearer <token>`.
 * @throws {Response} 401 JSON when the token is missing, unknown, or expired.
 */
export async function requireApiUser(request: Request, env: Env): Promise<SessionUser> {
  const raw = bearer(request);
  if (!raw) throw Response.json({ error: 'unauthorized' }, { status: 401 });
  const db = createDb(env);
  const user = await userFromToken(db, raw);
  if (!user) throw Response.json({ error: 'unauthorized' }, { status: 401 });
  await slideExpiry(db, raw);
  return user;
}

/**
 * @throws {Response} 401 when unauthenticated, 403 when the caller is a student.
 *   Note the web equivalent redirects students to /flashcards — deliberately not done here.
 */
export async function requireApiStaff(request: Request, env: Env): Promise<SessionUser> {
  const u = await requireApiUser(request, env);
  if (u.kind !== 'staff') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u;
}

/**
 * Staff or student — the two kinds every 'user'-level endpoint was written for.
 *
 * Those handlers are shaped `kind === 'student' ? own-data : everything`, so letting a
 * third kind through hands a parent the teacher's view by default. A parent's API is the
 * short 'any' list (profile, prefs, push, logout); everything else is 403 until a
 * handler is deliberately taught what a parent should see.
 *
 * @throws {Response} 403 when the caller is a parent.
 */
export async function requireApiLearner(request: Request, env: Env): Promise<LearnerUser> {
  const u = await requireApiUser(request, env);
  if (u.kind === 'parent') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u as LearnerUser;
}

/**
 * Parents only — the mirror of requireApiLearner, for /api/parent/*.
 *
 * Staff and students are refused rather than waved through: these handlers scope every read
 * to `parent_students`, so another kind of caller has no children to resolve and would either
 * read nothing or, worse, be handed an empty filter meaning "the whole school".
 *
 * Whether the portal is switched on is a separate check each handler makes through
 * parent-portal.ts — this guard only answers "who is calling".
 *
 * @throws {Response} 401 when unauthenticated, 403 when the caller is not a parent.
 */
export async function requireApiParent(request: Request, env: Env): Promise<ParentUser> {
  const u = await requireApiUser(request, env);
  if (u.kind !== 'parent') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u as ParentUser;
}

/** @throws {Response} 403 for any staff member who is not an Admin. */
export async function requireApiAdmin(request: Request, env: Env): Promise<SessionUser> {
  const u = await requireApiStaff(request, env);
  if (u.user.role !== 'Admin') throw Response.json({ error: 'forbidden' }, { status: 403 });
  return u;
}

/**
 * Staff guard for routes serving BOTH clients — the R2 file streams and the translate proxy.
 *
 * Dispatches on the credential the caller actually presented: a bearer token gets JSON
 * 401/403, anything else falls through to the cookie guard and its redirect. That keeps
 * browser behaviour byte-identical while giving native clients something parseable.
 */
export async function requireStaffCookieOrBearer(request: Request, env: Env): Promise<SessionUser> {
  if (bearer(request)) return requireApiStaff(request, env);
  return requireStaff(request, env);
}
