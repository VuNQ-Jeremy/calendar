import { eq, and, lt, ne, or, inArray, isNotNull, exists } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { redirect } from 'react-router';
import { createRawDb } from '../db/internal';
import type { Db } from '../db';
import {
  accounts,
  sessions,
  invites,
  staff,
  students,
  parents,
  passwordResets,
  emailVerifications,
  zaloChats,
  tenants,
} from '../db/schema';
import { hashPassword, verifyPassword, newToken, hashToken, NO_PASSWORD } from './crypto';
import { sendEmail, isRealEmail } from './email';
import { normalizeInviteCode } from '../../shared/logic/invite-code';
import { normalizePhone } from '../../shared/logic/phone';
import { hasFamilyChat } from './zalo';
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
  /**
   * The school every query this request makes must be fenced to. Already resolved: for a
   * platform admin who has entered another school from /platform it is that school, for
   * everyone else it is their own. Pass it to `tenantDbFor` and never second-guess it.
   */
  tenantId: string;
  /** The account's own school, so the layout can tell "entered" from "at home". */
  homeTenantId: string;
  /** dev@ / admin@ — may enter any school, and may write the platform content library. */
  isPlatformAdmin: boolean;
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
      tenant: tenants,
      staffRow: staff,
      studentRow: students,
      parentRow: parents,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .leftJoin(tenants, eq(tenants.id, accounts.tenantId))
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

  // Suspending a school kills its live sessions, not just its logins — otherwise an open tab
  // keeps working until its cookie expires. Platform admins are exempt so they can still get
  // in and undo it.
  const isPlatformAdmin = account.isPlatformAdmin;
  if (row.tenant?.status === 'suspended' && !isPlatformAdmin) return null;

  // The "entered another school" override is honored ONLY for platform admins, so a stray
  // value on an ordinary account is inert rather than an escalation. The /platform action
  // that writes it checks too — this is the half that cannot be bypassed.
  const homeTenantId = account.tenantId;
  const tenantId =
    isPlatformAdmin && row.session.activeTenantId ? row.session.activeTenantId : homeTenantId;
  const scope = { tenantId, homeTenantId, isPlatformAdmin };

  let user: SessionUser | null = null;

  if (account.staffId) {
    if (row.staffRow) {
      user = {
        kind: 'staff',
        ...scope,
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
        ...scope,
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
        ...scope,
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
    const db = createRawDb(env);
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

/**
 * A `?next=` value it is safe to redirect to after a successful sign-in, or null.
 *
 * Same-origin PATHS only. `startsWith('/')` alone is an open redirect: browsers resolve
 * `//evil.com` (and `/\evil.com` — backslash normalises to slash in URL parsing) as
 * protocol-relative, so a Location built from either leaves the origin — and doing so right
 * after a REAL sign-in is a premium phishing primitive. `.data` is the single-fetch suffix,
 * a document navigation target for no one.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.endsWith('.data')) return null;
  return raw;
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

/**
 * The tier above `Admin`: dev@ / admin@, who own the platform rather than a school.
 *
 * Every school has its own Admins, and they must never reach /platform — "admin of my school"
 * and "admin of every school" are different powers, and conflating them is how a self-serve
 * signup form becomes a privilege escalation. The flag is a column on `accounts` (set by
 * migration 0045), not a hardcoded email list, so adding a third needs no deploy.
 */
export async function requirePlatformAdmin(request: Request, env: Env): Promise<SessionUser> {
  const sessionUser = await requireAdmin(request, env);
  if (!sessionUser.isPlatformAdmin) {
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

  // Always run verifyPassword — prevents user-enumeration via timing. A passwordless
  // (Zalo-only) account stores NO_PASSWORD, which routes here too: it can never match, and the
  // timing is identical to a missing account or a wrong password.
  const storedHash =
    !account || account.passwordHash === NO_PASSWORD ? DUMMY_HASH : account.passwordHash;
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
 *
 * tenant-unscoped, and it must stay that way: redemption runs with no session, so the CODE is
 * what selects the school. `invites.code` is globally unique for exactly this reason, and
 * `redeemInvite` reads the school off the row it finds. Scoping this lookup would make every
 * invite unredeemable.
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

/**
 * @param password Required for a staff invite. Optional for a student/parent invite — omitting
 *   it redeems passwordless instead, which requires `phone` AND the family already having a
 *   reachable Zalo chat (checked before any row is written).
 * @returns `null` for an unknown/spent/expired code, `'no_login_method'` when neither a valid
 *   password nor a workable phone was supplied, or the new account id on success.
 */
export async function redeemInvite(
  db: Db,
  code: string,
  {
    name,
    email,
    password,
    phone,
  }: { name: string; email?: string; password?: string; phone?: string },
): Promise<{ accountId: string } | null | 'no_login_method'> {
  const invite = await findOpenInvite(db, code);
  if (!invite) return null;

  const linkedId = linkedIdOf(invite);

  // A staff account is never Zalo-only — teaching/admin tools have no OTP entry point.
  if (invite.role === 'Staff' && !password) return 'no_login_method';

  let passwordHash: string;
  let phoneE164: string | null = null;
  if (password) {
    passwordHash = await hashPassword(password);
  } else {
    const normalized = phone ? normalizePhone(phone) : null;
    if (!normalized) return 'no_login_method';
    // Only a LINKED student/parent invite can go passwordless: a legacy invite has no person row
    // yet, so no Zalo chat could possibly already be paired to it. The family must be reachable
    // BEFORE the account is created, or a passwordless account would have no way in at all.
    const target = invite.studentId
      ? { studentId: invite.studentId }
      : invite.parentId
        ? { parentId: invite.parentId }
        : null;
    if (!target || !(await hasFamilyChat(db, target))) return 'no_login_method';
    passwordHash = NO_PASSWORD;
    phoneE164 = normalized;
  }

  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalizedEmail = (email || '').trim().toLowerCase() || null;

  // ---- Linked invite: attach an account to the row staff already created. ----
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
        // The invite carries the school of the staff member who minted it — this is the one
        // hop that puts a redeeming student, parent or teacher into the right school, and
        // the reason families never see anything tenant-shaped.
        tenantId: invite.tenantId,
        email: normalizedEmail || `invite-${accountId}@mochi.local`,
        passwordHash,
        phoneE164,
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
        tenantId: invite.tenantId,
        id: staffId,
        name,
        email: normalizedEmail,
        role: 'Teacher',
        color: 'orange',
      }),
      db.insert(accounts).values({
        tenantId: invite.tenantId,
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
        tenantId: invite.tenantId,
        id: studentId,
        name,
        email: normalizedEmail,
        color: 'blue',
      }),
      db.insert(accounts).values({
        tenantId: invite.tenantId,
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
        tenantId: invite.tenantId,
        id: parentId,
        name,
        email: normalizedEmail,
        color: 'green',
      }),
      db.insert(accounts).values({
        tenantId: invite.tenantId,
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

/**
 * @param origin The request's own origin (`new URL(request.url).origin`) — `requestReset` has no
 *   `Request` in scope, so the reset link's host has to come in from the caller.
 */
export async function requestReset(
  db: Db,
  email: string,
  env: Env,
  origin: string,
): Promise<{ devUrl?: string }> {
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

  const resetPath = `/login?mode=reset&token=${token}`;
  if (isRealEmail(account.email)) {
    await sendEmail(env, {
      to: account.email,
      subject: 'Đặt lại mật khẩu Mochi',
      text:
        `Đặt lại mật khẩu Mochi: ${origin}${resetPath}\n\n` +
        'Liên kết hết hạn sau 1 giờ. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.',
    });
  }

  if (import.meta.env.DEV) {
    return { devUrl: resetPath };
  }

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

/**
 * Pull-based email verification: mail a link, the visitor clicks it, `verifyEmail` below consumes
 * it. A no-op for a synthetic or missing address — there is nothing to prove ownership of.
 *
 * @param origin See `requestReset` — this function has no `Request` either.
 */
export async function requestEmailVerification(
  db: Db,
  accountId: string,
  email: string,
  env: Env,
  origin: string,
): Promise<{ devUrl?: string } | null> {
  if (!isRealEmail(email)) return null;
  const normalizedEmail = email.trim().toLowerCase();
  const { token, hash } = await newToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.insert(emailVerifications).values({
    tokenHash: hash,
    accountId,
    email: normalizedEmail,
    expiresAt,
    used: 0,
  });
  const path = `/verify-email?token=${token}`;
  await sendEmail(env, {
    to: normalizedEmail,
    subject: 'Xác minh email Mochi',
    text: `Xác minh email của bạn: ${origin}${path}\n\nLiên kết hết hạn sau 24 giờ.`,
  });
  attributeAccount(accountId);
  record({ action: 'email_verify', meta: { stage: 'requested', email: normalizedEmail } });

  if (import.meta.env.DEV) return { devUrl: path };
  return {};
}

export async function verifyEmail(db: Db, token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const row = await db.query.emailVerifications.findFirst({
    where: eq(emailVerifications.tokenHash, tokenHash),
  });
  if (!row || row.used || new Date(row.expiresAt) < new Date()) return false;

  // The account's email may have changed since this token was minted — a stale token must not
  // silently verify whatever address the row carries NOW.
  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, row.accountId) });
  if (!account || account.email !== row.email) return false;

  await db.batch([
    db
      .update(accounts)
      .set({ emailVerifiedAt: new Date().toISOString() })
      .where(eq(accounts.id, row.accountId)),
    db
      .update(emailVerifications)
      .set({ used: 1 })
      .where(eq(emailVerifications.tokenHash, tokenHash)),
  ]);
  attributeAccount(row.accountId);
  record({ action: 'email_verify', meta: { stage: 'completed' } });

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

  // A passwordless (Zalo-only) account is SETTING its first password, not changing one — there
  // is no current password to verify. `login()` and the generic path below both still route
  // NO_PASSWORD to a dummy-hash comparison when this branch does NOT apply (a wrong accountId,
  // say), so the timing-safe posture elsewhere is undisturbed by this account actually being
  // allowed through here.
  const allowNoCurrent = account?.passwordHash === NO_PASSWORD;
  if (!allowNoCurrent) {
    const storedHash = !account ? DUMMY_HASH : account.passwordHash;
    const valid = await verifyPassword(currentPassword, storedHash);

    console.log('[auth] change_password.attempt', {
      accountFound: !!account,
      currentPasswordValid: valid,
    });

    if (!valid || !account) return 'wrong_current_password';
  }

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

export type RemovePasswordResult = 'ok' | 'needs_another_method';

/**
 * Go passwordless (back to `NO_PASSWORD`). Guarded here, not just at the route: an account may
 * never end up with NO working login method, so this refuses unless a Google sub is pinned or an
 * account-paired Zalo chat exists. Purges every OTHER session, same as `changePassword`.
 *
 * The guard lives in the UPDATE's WHERE clause, not in a read beforehand: this and the
 * unlink-google intent (app/routes/profile.tsx) can race from two tabs, and read-then-write
 * would let each observe the other's method still present and both proceed — a methodless
 * account. D1 serialises writes, so a conditional write means whichever commits second simply
 * matches zero rows; the re-read below is only to learn which outcome this request got.
 */
export async function removePassword(
  db: Db,
  accountId: string,
  currentTokenHash: string,
): Promise<RemovePasswordResult> {
  // tenant-unscoped: keyed on the caller's own account id, resolved from their session —
  // `accounts`/`zalo_chats.account_id` are auth-owned, the same exemption changePassword uses.
  const pairedChat = exists(
    db.select({ id: zaloChats.id }).from(zaloChats).where(eq(zaloChats.accountId, accountId)),
  );
  await db
    .update(accounts)
    .set({ passwordHash: NO_PASSWORD })
    .where(and(eq(accounts.id, accountId), or(isNotNull(accounts.googleSub), pairedChat)));

  const after = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
  if (!after || after.passwordHash !== NO_PASSWORD) return 'needs_another_method';

  // Log out every other device, keep the session performing the change. Outside the guarded
  // write on purpose — it must only run once the write is known to have applied.
  await db
    .delete(sessions)
    .where(and(eq(sessions.accountId, accountId), ne(sessions.token, currentTokenHash)));
  attributeAccount(accountId);
  record({ action: 'password_change', meta: { removed: true } });
  return 'ok';
}
