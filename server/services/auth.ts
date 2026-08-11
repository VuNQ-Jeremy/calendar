import { eq, and, lt, ne, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { redirect } from 'react-router';
import { createDb } from '../db';
import type { Db } from '../db';
import {
  accounts,
  sessions,
  invites,
  staff,
  students,
  parents,
  passwordResets,
} from '../db/schema';
import { hashPassword, verifyPassword, newToken, hashToken } from './crypto';
import { normalizeInviteCode } from '../../shared/logic/invite-code';
import { sessionCookie } from '../session';
import { attributeAccount, record, requestMeta, setActor } from './audit';

// Static dummy hash for timing-safe login (prevents user-enumeration via timing).
const DUMMY_HASH =
  'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export type SessionUser = {
  /**
   * `parent` is a minimal portal: profile + password, nothing else. Every surface that
   * branches on kind must treat it explicitly — the historical `kind === 'staff' ? … : …`
   * shape silently hands a parent the student's view, and the inverse hands them staff data.
   */
  kind: 'staff' | 'student' | 'parent';
  account: { id: string; email: string };
  user: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    color: string;
    phone: string | null;
  };
};

// ---- Session management ----

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param ttlDays overrides the default 1-day / 30-day ("remember me") window. The mobile
 *   API passes 90 — see server/api/auth.ts. Web callers omit it and are unaffected.
 */
export async function createSession(
  db: Db,
  accountId: string,
  remember: boolean,
  ttlDays?: number,
): Promise<string> {
  const { token, hash } = await newToken();
  const days = ttlDays ?? (remember ? 30 : 1);
  const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
  // ip/userAgent come from the ambient audit store (see server/services/audit.ts) rather than a
  // new parameter here — createSession has no Request, and every caller already runs inside one.
  const { ip, userAgent } = requestMeta();
  await db.insert(sessions).values({
    token: hash,
    accountId,
    expiresAt,
    createdAt: new Date().toISOString(),
    ip,
    userAgent,
  });
  return token;
}

/**
 * Resolve a RAW session token to a SessionUser.
 *
 * `sessions.token` stores the SHA-256 hash, never the raw value — the raw token only ever
 * lives in the client's cookie or, for the mobile app, its secure store. Expired sessions
 * are deleted and yield null.
 *
 * Extracted from getUser() so the bearer-token path (server/api/auth.ts) can share it.
 */
export async function userFromToken(db: Db, rawToken: string): Promise<SessionUser | null> {
  const tokenHash = await hashToken(rawToken);
  // One joined query instead of sequential D1 round-trips. The account join is
  // inner (sessions.account_id is ON DELETE CASCADE, so orphan sessions cannot
  // exist); staff/students/parents are left joins because exactly one applies.
  const rows = await db
    .select({
      session: sessions,
      account: accounts,
      staffRow: staff,
      studentRow: students,
      parentRow: parents,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .leftJoin(parents, eq(parents.id, accounts.parentId))
    .where(eq(sessions.token, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (new Date(row.session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, tokenHash));
    return null;
  }

  const { account } = row;
  let user: SessionUser | null = null;

  if (account.staffId) {
    if (row.staffRow) {
      user = {
        kind: 'staff',
        account: { id: account.id, email: account.email },
        user: {
          id: row.staffRow.id,
          name: row.staffRow.name,
          email: row.staffRow.email ?? null,
          role: row.staffRow.role,
          color: row.staffRow.color,
          phone: row.staffRow.phone ?? null,
        },
      };
    }
  } else if (account.studentId) {
    if (row.studentRow) {
      user = {
        kind: 'student',
        account: { id: account.id, email: account.email },
        user: {
          id: row.studentRow.id,
          name: row.studentRow.name,
          email: row.studentRow.email ?? null,
          role: 'Student',
          color: row.studentRow.color,
          phone: null, // students have no phone column
        },
      };
    }
  } else if (account.parentId) {
    if (row.parentRow) {
      user = {
        kind: 'parent',
        account: { id: account.id, email: account.email },
        user: {
          id: row.parentRow.id,
          name: row.parentRow.name,
          email: row.parentRow.email ?? null,
          role: 'Parent',
          color: row.parentRow.color,
          phone: row.parentRow.phone ?? null,
        },
      };
    }
  }

  // Fires once per request: getUser/requireApiUser memoize per Request (userByRequest below /
  // server/api/auth.ts), and userFromToken is the one place both paths converge.
  if (user) setActor(user, tokenHash.slice(0, 16));
  return user;
}

// On a cold document load the layout loader and the page loader run in the
// same request — memoise per Request object so the session resolves once.
// WeakMap keyed on the Request instance cannot leak across requests, and the
// router builds a fresh Request for post-action revalidation, so loaders still
// observe post-mutation state.
const userByRequest = new WeakMap<Request, Promise<SessionUser | null>>();

export function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const memo = userByRequest.get(request);
  if (memo) return memo;
  const promise = (async () => {
    const db = createDb(env);
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    if (!rawToken || typeof rawToken !== 'string') return null;
    return userFromToken(db, rawToken);
  })();
  userByRequest.set(request, promise);
  return promise;
}

export async function requireUser(request: Request, env: Env): Promise<SessionUser> {
  const user = await getUser(request, env);
  if (!user) {
    const url = new URL(request.url);
    // Client-side navigations hit "<path>.data" (the root index is "/_.data");
    // strip the single-fetch suffix so post-login navigation targets the page itself.
    let next = url.pathname;
    if (next.endsWith('.data')) {
      next = next.slice(0, -'.data'.length);
      if (next === '/_' || next === '/_root' || next === '') next = '/';
    }
    throw redirect('/login?next=' + encodeURIComponent(next));
  }
  return user;
}

/** A session that is known not to be a parent — see requireLearner. */
export type LearnerUser = SessionUser & { kind: 'staff' | 'student' };

/**
 * Staff or student — the guard for pages that serve both, like the vocabulary lists and
 * the class garden. They branch `kind === 'staff' ? teacher view : learner view`, so a
 * parent must be turned away here rather than falling into one of those two.
 *
 * The narrowed return type is the point: the flashcard and garden services take
 * `kind: 'staff' | 'student'`, so a caller that skipped this guard will not compile.
 */
export async function requireLearner(request: Request, env: Env): Promise<LearnerUser> {
  const sessionUser = await requireUser(request, env);
  if (sessionUser.kind === 'parent') throw redirect('/profile');
  return sessionUser as LearnerUser;
}

/** A session known to be a parent — the mirror of LearnerUser, for the portal's loaders. */
export type ParentUser = SessionUser & { kind: 'parent' };

/**
 * Parents only, for the portal pages under /children.
 *
 * The narrowed type is the point, same as requireLearner: a parent-scoped loader takes a
 * parent id, and passing it a staff or student id would read the wrong person's children.
 * Anyone else goes to their own home rather than seeing a 403 for a page that is simply
 * not theirs.
 *
 * Note this guard says nothing about whether the portal is ENABLED — that is
 * parent-portal.ts's job, because it is a per-request data question, not an identity one.
 */
export async function requireParent(request: Request, env: Env): Promise<ParentUser> {
  const sessionUser = await requireUser(request, env);
  if (sessionUser.kind !== 'parent') throw redirect(homeFor(sessionUser.kind));
  return sessionUser as ParentUser;
}

export async function requireStaff(request: Request, env: Env): Promise<SessionUser> {
  const sessionUser = await requireUser(request, env);
  if (sessionUser.kind === 'student') throw redirect('/vocabulary');
  // Parents have no learning surface; /profile is their whole app.
  if (sessionUser.kind !== 'staff') throw redirect('/profile');
  return sessionUser;
}

/** Where a signed-in user belongs when they land somewhere they may not be. */
export function homeFor(kind: SessionUser['kind']): string {
  if (kind === 'staff') return '/dashboard';
  if (kind === 'student') return '/vocabulary';
  return '/profile';
}

export async function requireAdmin(request: Request, env: Env): Promise<SessionUser> {
  const sessionUser = await requireStaff(request, env);
  if (sessionUser.user.role !== 'Admin') {
    throw Response.json({ error: 'forbidden' }, { status: 403 });
  }
  return sessionUser;
}

// ---- Auth actions ----

export async function login(
  db: Db,
  email: string,
  password: string,
): Promise<{ accountId: string } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, normalizedEmail),
  });

  // Always run verifyPassword — prevents user-enumeration via timing.
  const storedHash = account?.passwordHash ?? DUMMY_HASH;
  const [hashScheme, hashIterations] = storedHash.split('$');
  const valid = await verifyPassword(password, storedHash);

  console.log('[auth] login.attempt', {
    emailDomain: normalizedEmail.split('@')[1] ?? null,
    accountFound: !!account,
    hashScheme,
    hashIterations: Number(hashIterations) || null,
    passwordValid: valid,
  });

  if (!valid || !account) {
    // The failed-login feature (security view depends on it) is exactly this call — delete it
    // if it's ever unwanted. accountFound distinguishes "wrong password for a real account" from
    // "no such account", which is what makes a brute-force-by-guessing-emails pattern visible.
    if (account) attributeAccount(account.id);
    record({ action: 'login_failed', meta: { email: normalizedEmail, accountFound: !!account } });
    await new Promise((r) => setTimeout(r, 1000));
    return null;
  }

  // meta carries the full email — a deliberate privacy deviation from the '[auth] login.attempt'
  // log above, which stores only the domain. Justified: this row is admin-only, 90-day-purged,
  // and the security view needs to identify the targeted account.
  attributeAccount(account.id);
  record({ action: 'login', meta: { email: normalizedEmail } });
  return { accountId: account.id };
}

export async function logout(db: Db, request: Request): Promise<void> {
  const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
  if (!rawToken || typeof rawToken !== 'string') return;
  const tokenHash = await hashToken(rawToken);
  await db.delete(sessions).where(eq(sessions.token, tokenHash));
  // Attribution needs the caller to have already resolved the session (getUser/userFromToken)
  // in this request — logout() itself never looks up who is signing out.
  record({ action: 'logout' });
}

/**
 * The unused invite for a typed code, or null.
 *
 * Two stored spellings are accepted, not one: `makeInviteCode` writes `ABC-123`, but codes
 * created through the API carry whatever the caller sent, and some were stored bare. The
 * old lookup read every invite and compared in JS, which tolerated both; matching on the
 * pair keeps that tolerance while still using the unique index.
 */
export async function findOpenInvite(
  db: Db,
  code: string,
): Promise<typeof invites.$inferSelect | null> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;
  const rows = await db
    .select()
    .from(invites)
    .where(inArray(invites.code, [normalized, normalized.replace('-', '')]));
  return rows.find((r) => !r.used) ?? null;
}

/** True for codes minted against a person who already exists. */
function linkedIdOf(invite: typeof invites.$inferSelect): string | null {
  return invite.studentId ?? invite.staffId ?? invite.parentId ?? null;
}

export async function redeemInvite(
  db: Db,
  code: string,
  { name, email, password }: { name: string; email?: string; password: string },
): Promise<{ accountId: string } | null> {
  const invite = await findOpenInvite(db, code);
  if (!invite) return null;

  const accountId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const normalizedEmail = (email || '').trim().toLowerCase() || null;

  // ---- Linked invite: attach an account to the row staff already created. ----
  const linkedId = linkedIdOf(invite);
  if (linkedId) {
    const person = invite.studentId
      ? await db.query.students.findFirst({ where: eq(students.id, linkedId) })
      : invite.staffId
        ? await db.query.staff.findFirst({ where: eq(staff.id, linkedId) })
        : await db.query.parents.findFirst({ where: eq(parents.id, linkedId) });
    if (!person) return null;

    // A person can end up with two codes (staff re-issues one). The first redeem wins;
    // the second must not mint a second login for the same row.
    const existing = await db.query.accounts.findFirst({
      where: invite.studentId
        ? eq(accounts.studentId, linkedId)
        : invite.staffId
          ? eq(accounts.staffId, linkedId)
          : eq(accounts.parentId, linkedId),
    });
    if (existing) return null;

    const ops: BatchItem<'sqlite'>[] = [
      db.insert(accounts).values({
        id: accountId,
        email: normalizedEmail || `invite-${accountId}@mochi.local`,
        passwordHash,
        studentId: invite.studentId ?? null,
        staffId: invite.staffId ?? null,
        parentId: invite.parentId ?? null,
        createdAt: now,
      }),
    ];
    // The staff-entered name is canonical, so `name` is ignored — no second row, no rename.
    // An email the person signed up with is worth keeping, but only where staff left it blank.
    if (!person.email && normalizedEmail) {
      const set = { email: normalizedEmail };
      ops.push(
        invite.studentId
          ? db.update(students).set(set).where(eq(students.id, linkedId))
          : invite.staffId
            ? db.update(staff).set(set).where(eq(staff.id, linkedId))
            : db.update(parents).set(set).where(eq(parents.id, linkedId)),
      );
    }
    ops.push(
      db
        .update(invites)
        .set({ used: true, usedBy: accountId, usedAt: now })
        .where(eq(invites.id, invite.id)),
    );
    await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
    attributeAccount(accountId);
    record({
      action: 'invite_redeem',
      entityType: 'invite',
      entityId: invite.id,
      meta: { role: invite.role, linked: true },
    });
    return { accountId };
  }

  // ---- Legacy invite (no link): the code creates the person. Still minted by mobile. ----
  if (invite.role === 'Staff') {
    const staffId = crypto.randomUUID();
    await db.batch([
      db.insert(staff).values({
        id: staffId,
        name,
        email: normalizedEmail,
        role: 'Teacher',
        color: 'orange',
      }),
      db.insert(accounts).values({
        id: accountId,
        email: normalizedEmail || `invite-${accountId}@mochi.local`,
        passwordHash,
        staffId,
        createdAt: now,
      }),
      db
        .update(invites)
        .set({ used: true, usedBy: accountId, usedAt: now })
        .where(eq(invites.id, invite.id)),
    ]);
  } else if (invite.role === 'Student') {
    const studentId = crypto.randomUUID();
    await db.batch([
      db.insert(students).values({
        id: studentId,
        name,
        email: normalizedEmail,
        color: 'blue',
      }),
      db.insert(accounts).values({
        id: accountId,
        email: normalizedEmail || `invite-${accountId}@mochi.local`,
        passwordHash,
        studentId,
        createdAt: now,
      }),
      db
        .update(invites)
        .set({ used: true, usedBy: accountId, usedAt: now })
        .where(eq(invites.id, invite.id)),
    ]);
  } else if (invite.role === 'Parent') {
    const parentId = crypto.randomUUID();
    await db.batch([
      db.insert(parents).values({
        id: parentId,
        name,
        email: normalizedEmail,
        color: 'green',
      }),
      db.insert(accounts).values({
        id: accountId,
        email: normalizedEmail || `invite-${accountId}@mochi.local`,
        passwordHash,
        parentId,
        createdAt: now,
      }),
      db
        .update(invites)
        .set({ used: true, usedBy: accountId, usedAt: now })
        .where(eq(invites.id, invite.id)),
    ]);
  } else {
    return null;
  }

  attributeAccount(accountId);
  record({
    action: 'invite_redeem',
    entityType: 'invite',
    entityId: invite.id,
    meta: { role: invite.role, linked: false },
  });
  return { accountId };
}

export async function requestReset(db: Db, email: string): Promise<{ devUrl?: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.email, normalizedEmail),
  });

  if (!account) return {};

  const { token, hash } = await newToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await db
    .insert(passwordResets)
    .values({ tokenHash: hash, accountId: account.id, expiresAt, used: 0 });
  attributeAccount(account.id);
  record({ action: 'password_reset', meta: { stage: 'requested', email: normalizedEmail } });

  if (import.meta.env.DEV) {
    return { devUrl: `/login?mode=reset&token=${token}` };
  }

  // TODO: send via email provider
  return {};
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const resetRow = await db.query.passwordResets.findFirst({
    where: eq(passwordResets.tokenHash, tokenHash),
  });

  if (!resetRow || resetRow.used || new Date(resetRow.expiresAt) < new Date()) {
    return false;
  }

  const passwordHash = await hashPassword(newPassword);
  await db.batch([
    db.update(accounts).set({ passwordHash }).where(eq(accounts.id, resetRow.accountId)),
    db.update(passwordResets).set({ used: 1 }).where(eq(passwordResets.tokenHash, tokenHash)),
    db.delete(sessions).where(eq(sessions.accountId, resetRow.accountId)),
  ]);
  attributeAccount(resetRow.accountId);
  record({ action: 'password_reset', meta: { stage: 'completed' } });

  return true;
}

export type ChangePasswordResult = 'ok' | 'wrong_current_password';

export async function changePassword(
  db: Db,
  accountId: string,
  currentPassword: string,
  newPassword: string,
  currentTokenHash: string,
): Promise<ChangePasswordResult> {
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  // Timing-safe: always run a verify even if account is somehow missing.
  const storedHash = account?.passwordHash ?? DUMMY_HASH;
  const valid = await verifyPassword(currentPassword, storedHash);

  console.log('[auth] change_password.attempt', {
    accountFound: !!account,
    currentPasswordValid: valid,
  });

  if (!valid || !account) return 'wrong_current_password';

  const passwordHash = await hashPassword(newPassword);
  await db.batch([
    db.update(accounts).set({ passwordHash }).where(eq(accounts.id, accountId)),
    // Log out every other device, keep the session performing the change.
    db
      .delete(sessions)
      .where(and(eq(sessions.accountId, accountId), ne(sessions.token, currentTokenHash))),
  ]);
  // Actor is already resolved here — every caller reaches changePassword through an
  // authenticated route, so userFromToken has already run setActor for this request.
  record({ action: 'password_change' });
  return 'ok';
}
