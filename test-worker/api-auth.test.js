import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import { hashPassword, hashToken } from '../server/services/crypto';
import { accounts, sessions } from '../server/db/schema';
import {
  requireApiUser,
  requireApiStaff,
  requireApiLearner,
  requireApiParent,
  requireApiAdmin,
  MOBILE_TTL_DAYS,
} from '../server/api/auth';
import * as parentPortalSvc from '../server/services/parent-portal';

/**
 * Bearer-token auth for the JSON API.
 *
 * The single most important property under test: these guards must throw a JSON Response,
 * never a redirect. A native client cannot follow a 302 to an HTML login page.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seedStaff(d, { email, password = 'pw', role = 'Teacher' }) {
  const staffRow = await peopleSvc.createStaff(d, {
    name: 'API Staff',
    email,
    role,
    color: 'orange',
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  return { accountId, staffId: staffRow.id };
}

async function seedStudent(d, { email, password = 'pw' }) {
  const studentRow = await peopleSvc.createStudent(d, {
    name: 'API Student',
    email,
    color: 'blue',
    classIds: [],
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    studentId: studentRow.id,
    createdAt: new Date().toISOString(),
  });
  return { accountId, studentId: studentRow.id };
}

async function seedParent(d, { email, password = 'pw', studentIds = [] }) {
  const parentRow = await peopleSvc.createParent(d, {
    name: 'API Parent',
    email,
    color: 'green',
    studentIds,
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    parentId: parentRow.id,
    createdAt: new Date().toISOString(),
  });
  return { accountId, parentId: parentRow.id };
}

const withBearer = (token) =>
  new Request('http://localhost/api/bootstrap', { headers: { Authorization: `Bearer ${token}` } });

/** Run a guard and return whatever it threw, so we can assert on the Response. */
async function caught(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('userFromToken', () => {
  it('resolves a raw token to the account', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'uft@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true);

    const user = await authSvc.userFromToken(d.raw, token);
    expect(user).not.toBeNull();
    expect(user.account.id).toBe(accountId);
    expect(user.kind).toBe('staff');
  });

  it('stores the HASH, never the raw token', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'hash@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true);

    const raw = await d.raw.select().from(sessions).where(eq(sessions.token, token));
    expect(raw).toHaveLength(0);

    const hashed = await d.raw
      .select()
      .from(sessions)
      .where(eq(sessions.token, await hashToken(token)));
    expect(hashed).toHaveLength(1);
  });

  it('returns null for an unknown token', async () => {
    expect(await authSvc.userFromToken(db().raw, 'not-a-real-token')).toBeNull();
  });

  it('deletes and rejects an expired session', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'expired@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true);
    const tokenHash = await hashToken(token);

    await d.raw
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.token, tokenHash));

    expect(await authSvc.userFromToken(d.raw, token)).toBeNull();
    const rows = await d.raw.select().from(sessions).where(eq(sessions.token, tokenHash));
    expect(rows).toHaveLength(0);
  });
});

describe('createSession ttlDays', () => {
  it('defaults to 1 day without remember, 30 with', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'ttl1@test.com' });

    const short = await authSvc.createSession(d.raw, accountId, false);
    const long = await authSvc.createSession(d.raw, accountId, true);

    const at = async (t) =>
      (
        await d.raw
          .select()
          .from(sessions)
          .where(eq(sessions.token, await hashToken(t)))
      )[0].expiresAt;

    const shortDays = (new Date(await at(short)) - Date.now()) / authSvc.DAY_MS;
    const longDays = (new Date(await at(long)) - Date.now()) / authSvc.DAY_MS;
    expect(Math.round(shortDays)).toBe(1);
    expect(Math.round(longDays)).toBe(30);
  });

  it('honours an explicit ttlDays for mobile', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'ttl90@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const row = (
      await d.raw
        .select()
        .from(sessions)
        .where(eq(sessions.token, await hashToken(token)))
    )[0];
    const days = (new Date(row.expiresAt) - Date.now()) / authSvc.DAY_MS;
    expect(Math.round(days)).toBe(MOBILE_TTL_DAYS);
  });
});

describe('API guards reject with JSON, never a redirect', () => {
  it('401s with no Authorization header', async () => {
    const err = await caught(() =>
      requireApiUser(new Request('http://localhost/api/bootstrap'), env),
    );
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(401);
    // The whole point: not a 302, and not HTML.
    expect(err.status).not.toBe(302);
    expect(err.headers.get('content-type')).toContain('application/json');
    expect(await err.json()).toEqual({ error: 'unauthorized' });
  });

  it('401s on a garbage token', async () => {
    const err = await caught(() => requireApiUser(withBearer('garbage'), env));
    expect(err.status).toBe(401);
  });

  it('401s on a malformed Authorization header', async () => {
    const req = new Request('http://localhost/api/bootstrap', {
      headers: { Authorization: 'Basic abc123' },
    });
    const err = await caught(() => requireApiUser(req, env));
    expect(err.status).toBe(401);
  });

  it('accepts a valid bearer token', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'valid@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiUser(withBearer(token), env);
    expect(user.account.id).toBe(accountId);
  });
});

describe('role enforcement', () => {
  it('403s a student against a staff endpoint — not a redirect to /flashcards', async () => {
    const d = db();
    const { accountId } = await seedStudent(d, { email: 'student@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const err = await caught(() => requireApiStaff(withBearer(token), env));
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(403);
    expect(err.status).not.toBe(302);
    expect(await err.json()).toEqual({ error: 'forbidden' });
  });

  it('lets a student through a user-level endpoint', async () => {
    const d = db();
    const { accountId } = await seedStudent(d, { email: 'student2@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiUser(withBearer(token), env);
    expect(user.kind).toBe('student');
  });

  it('403s a Teacher against an admin endpoint', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'teacher@test.com', role: 'Teacher' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const err = await caught(() => requireApiAdmin(withBearer(token), env));
    expect(err.status).toBe(403);
  });

  it('lets an Admin through', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'admin@test.com', role: 'Admin' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiAdmin(withBearer(token), env);
    expect(user.user.role).toBe('Admin');
  });
});

describe('changePassword and multi-device sessions', () => {
  it('keeps the calling session and kills the others', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'multi@test.com', password: 'old-pw' });

    const phone = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);
    const browser = await authSvc.createSession(d.raw, accountId, true);

    const result = await authSvc.changePassword(
      d.raw,
      accountId,
      'old-pw',
      'new-pw',
      await hashToken(phone),
    );
    expect(result).toBe('ok');

    // The device that made the change stays signed in; every other one is evicted.
    expect(await authSvc.userFromToken(d.raw, phone)).not.toBeNull();
    expect(await authSvc.userFromToken(d.raw, browser)).toBeNull();
  });

  it('rejects a wrong current password without touching sessions', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'wrongpw@test.com', password: 'right' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    const result = await authSvc.changePassword(
      d.raw,
      accountId,
      'wrong',
      'new-pw',
      await hashToken(token),
    );
    expect(result).toBe('wrong_current_password');
    expect(await authSvc.userFromToken(d.raw, token)).not.toBeNull();
  });
});

describe('requireApiParent and the parent portal gate', () => {
  it('admits only parents, and 403s staff and students', async () => {
    const d = db();
    const { accountId: parentAccount } = await seedParent(d, { email: 'rap-parent@test.com' });
    const { accountId: staffAccount } = await seedStaff(d, { email: 'rap-staff@test.com' });
    const { accountId: studentAccount } = await seedStudent(d, { email: 'rap-student@test.com' });

    const parentToken = await authSvc.createSession(d.raw, parentAccount, true, MOBILE_TTL_DAYS);
    const staffToken = await authSvc.createSession(d.raw, staffAccount, true, MOBILE_TTL_DAYS);
    const studentToken = await authSvc.createSession(d.raw, studentAccount, true, MOBILE_TTL_DAYS);

    const parent = await requireApiParent(withBearer(parentToken), env);
    expect(parent.kind).toBe('parent');
    expect(parent.user.role).toBe('Parent');

    // The mirror image of requireApiLearner: these handlers scope everything to parent_students,
    // so a staff or student caller has no children to resolve and must not fall through.
    for (const token of [staffToken, studentToken]) {
      const err = await caught(() => requireApiParent(withBearer(token), env));
      expect(err).toBeInstanceOf(Response);
      expect(err.status).toBe(403);
      expect(await err.json()).toEqual({ error: 'forbidden' });
    }

    // No credential at all is 401, not 403 — the client must re-login rather than give up.
    const noToken = await caught(() =>
      requireApiParent(new Request('http://localhost/api/parent/home'), env),
    );
    expect(noToken.status).toBe(401);
  });

  it('403s a parent for learner-level endpoints, both before and after the portal opens', async () => {
    const d = db();
    const { accountId } = await seedParent(d, { email: 'learner-gate@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    // The portal never widens `user` level: /api/my-sessions passes an EMPTY filter for a
    // non-student, which means "every class in the school". A parent must never reach it.
    for (const enabled of [false, true]) {
      await parentPortalSvc.setParentPortal(d, { enabled });
      const err = await caught(() => requireApiLearner(withBearer(token), env));
      expect(err.status).toBe(403);
    }
    await parentPortalSvc.setParentPortal(d, { enabled: false });
  });

  it('never lets a parent write the portal setting that governs them', async () => {
    const d = db();
    const { accountId } = await seedParent(d, { email: 'portal-write@test.com' });
    const token = await authSvc.createSession(d.raw, accountId, true, MOBILE_TTL_DAYS);

    // Read is `any` level — a parent's own tab bar depends on it, so this must NOT throw.
    await expect(requireApiUser(withBearer(token), env)).resolves.toBeTruthy();
    // Write is `admin`: opening a data surface for a whole class of users is an admin decision.
    const err = await caught(() => requireApiAdmin(withBearer(token), env));
    expect(err.status).toBe(403);
  });
});
