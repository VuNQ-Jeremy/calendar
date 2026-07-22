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

export async function createSession(db: Db, accountId: string, remember: boolean): Promise<string> {
  const { token, hash } = await newToken();
  const expiresAt = remember
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.insert(sessions).values({ token: hash, accountId, expiresAt });
  return token;
}

export async function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const db = createDb(env);
  const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
  if (!rawToken || typeof rawToken !== 'string') return null;

  const tokenHash = await hashToken(rawToken);
  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.token, tokenHash),
  });
  if (!sessionRow) return null;

  if (new Date(sessionRow.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, tokenHash));
    return null;
  }

  const accountRow = await db.query.accounts.findFirst({
    where: eq(accounts.id, sessionRow.accountId),
  });
  if (!accountRow?.staffId) return null;

  const staffRow = await db.query.staff.findFirst({
    where: eq(staff.id, accountRow.staffId),
  });
  if (!staffRow) return null;

  return {
    account: { id: accountRow.id, email: accountRow.email },
    user: {
      id: staffRow.id,
      name: staffRow.name,
      email: staffRow.email ?? null,
      role: staffRow.role,
      color: staffRow.color,
      phone: staffRow.phone ?? null,
    },
  };
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
