import { eq, and, lt, ne } from 'drizzle-orm';
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
import { sessionCookie } from '../session';

// Static dummy hash for timing-safe login (prevents user-enumeration via timing).
const DUMMY_HASH =
  'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export type SessionUser = {
  kind: 'staff' | 'student';
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
  await db.insert(sessions).values({ token: hash, accountId, expiresAt });
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
  // One joined query instead of 3 sequential D1 round-trips. The account join is
  // inner (sessions.account_id is ON DELETE CASCADE, so orphan sessions cannot
  // exist); staff/students are left joins because exactly one of them applies.
  const rows = await db
    .select({ session: sessions, account: accounts, staffRow: staff, studentRow: students })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .where(eq(sessions.token, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (new Date(row.session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, tokenHash));
    return null;
  }

  const { account } = row;
  if (account.staffId) {
    if (!row.staffRow) return null;
    return {
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

  if (account.studentId) {
    if (!row.studentRow) return null;
    return {
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

  return null; // parent accounts remain unsupported
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

export async function requireStaff(request: Request, env: Env): Promise<SessionUser> {
  const sessionUser = await requireUser(request, env);
  if (sessionUser.kind !== 'staff') throw redirect('/vocabulary');
  return sessionUser;
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
    await new Promise((r) => setTimeout(r, 1000));
    return null;
  }

  return { accountId: account.id };
}

export async function logout(db: Db, request: Request): Promise<void> {
  const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
  if (!rawToken || typeof rawToken !== 'string') return;
  const tokenHash = await hashToken(rawToken);
  await db.delete(sessions).where(eq(sessions.token, tokenHash));
}

export async function redeemInvite(
  db: Db,
  code: string,
  { name, email, password }: { name: string; email?: string; password: string },
): Promise<{ accountId: string } | null> {
  const norm = code.trim().toUpperCase().replace(/[-\s]/g, '');
  const allInvites = await db.select().from(invites);
  const invite = allInvites.find((i) => i.code.replace('-', '').toUpperCase() === norm && !i.used);
  if (!invite) return null;

  const accountId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const normalizedEmail = (email || '').trim().toLowerCase() || null;

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
  return 'ok';
}
