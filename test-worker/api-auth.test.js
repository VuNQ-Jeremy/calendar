import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createDb } from '../server/db/index';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import { hashPassword, hashToken } from '../server/services/crypto';
import { accounts, sessions } from '../server/db/schema';
import {
  requireApiUser,
  requireApiStaff,
  requireApiAdmin,
  MOBILE_TTL_DAYS,
} from '../server/api/auth';

/**
 * Bearer-token auth for the JSON API.
 *
 * The single most important property under test: these guards must throw a JSON Response,
 * never a redirect. A native client cannot follow a 302 to an HTML login page.
 */

function db() {
  return createDb(env);
}

async function seedStaff(d, { email, password = 'pw', role = 'Teacher' }) {
  const staffRow = await peopleSvc.createStaff(d, { name: 'API Staff', email, role, color: 'orange' });
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
  const studentRow = await peopleSvc.createStudent(d, { name: 'API Student', email, color: 'blue', classIds: [] });
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
    const token = await authSvc.createSession(d, accountId, true);

    const user = await authSvc.userFromToken(d, token);
    expect(user).not.toBeNull();
    expect(user.account.id).toBe(accountId);
    expect(user.kind).toBe('staff');
  });

  it('stores the HASH, never the raw token', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'hash@test.com' });
    const token = await authSvc.createSession(d, accountId, true);

    const raw = await d.select().from(sessions).where(eq(sessions.token, token));
    expect(raw).toHaveLength(0);

    const hashed = await d.select().from(sessions).where(eq(sessions.token, await hashToken(token)));
    expect(hashed).toHaveLength(1);
  });

  it('returns null for an unknown token', async () => {
    expect(await authSvc.userFromToken(db(), 'not-a-real-token')).toBeNull();
  });

  it('deletes and rejects an expired session', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'expired@test.com' });
    const token = await authSvc.createSession(d, accountId, true);
    const tokenHash = await hashToken(token);

    await d
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.token, tokenHash));

    expect(await authSvc.userFromToken(d, token)).toBeNull();
    const rows = await d.select().from(sessions).where(eq(sessions.token, tokenHash));
    expect(rows).toHaveLength(0);
  });
});

describe('createSession ttlDays', () => {
  it('defaults to 1 day without remember, 30 with', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'ttl1@test.com' });

    const short = await authSvc.createSession(d, accountId, false);
    const long = await authSvc.createSession(d, accountId, true);

    const at = async (t) =>
      (await d.select().from(sessions).where(eq(sessions.token, await hashToken(t))))[0].expiresAt;

    const shortDays = (new Date(await at(short)) - Date.now()) / authSvc.DAY_MS;
    const longDays = (new Date(await at(long)) - Date.now()) / authSvc.DAY_MS;
    expect(Math.round(shortDays)).toBe(1);
    expect(Math.round(longDays)).toBe(30);
  });

  it('honours an explicit ttlDays for mobile', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'ttl90@test.com' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const row = (
      await d.select().from(sessions).where(eq(sessions.token, await hashToken(token)))
    )[0];
    const days = (new Date(row.expiresAt) - Date.now()) / authSvc.DAY_MS;
    expect(Math.round(days)).toBe(MOBILE_TTL_DAYS);
  });
});

describe('API guards reject with JSON, never a redirect', () => {
  it('401s with no Authorization header', async () => {
    const err = await caught(() => requireApiUser(new Request('http://localhost/api/bootstrap'), env));
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
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiUser(withBearer(token), env);
    expect(user.account.id).toBe(accountId);
  });
});

describe('role enforcement', () => {
  it('403s a student against a staff endpoint — not a redirect to /flashcards', async () => {
    const d = db();
    const { accountId } = await seedStudent(d, { email: 'student@test.com' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const err = await caught(() => requireApiStaff(withBearer(token), env));
    expect(err).toBeInstanceOf(Response);
    expect(err.status).toBe(403);
    expect(err.status).not.toBe(302);
    expect(await err.json()).toEqual({ error: 'forbidden' });
  });

  it('lets a student through a user-level endpoint', async () => {
    const d = db();
    const { accountId } = await seedStudent(d, { email: 'student2@test.com' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiUser(withBearer(token), env);
    expect(user.kind).toBe('student');
  });

  it('403s a Teacher against an admin endpoint', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'teacher@test.com', role: 'Teacher' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const err = await caught(() => requireApiAdmin(withBearer(token), env));
    expect(err.status).toBe(403);
  });

  it('lets an Admin through', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'admin@test.com', role: 'Admin' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireApiAdmin(withBearer(token), env);
    expect(user.user.role).toBe('Admin');
  });
});

describe('changePassword and multi-device sessions', () => {
  it('keeps the calling session and kills the others', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'multi@test.com', password: 'old-pw' });

    const phone = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);
    const browser = await authSvc.createSession(d, accountId, true);

    const result = await authSvc.changePassword(d, accountId, 'old-pw', 'new-pw', await hashToken(phone));
    expect(result).toBe('ok');

    // The device that made the change stays signed in; every other one is evicted.
    expect(await authSvc.userFromToken(d, phone)).not.toBeNull();
    expect(await authSvc.userFromToken(d, browser)).toBeNull();
  });

  it('rejects a wrong current password without touching sessions', async () => {
    const d = db();
    const { accountId } = await seedStaff(d, { email: 'wrongpw@test.com', password: 'right' });
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const result = await authSvc.changePassword(d, accountId, 'wrong', 'new-pw', await hashToken(token));
    expect(result).toBe('wrong_current_password');
    expect(await authSvc.userFromToken(d, token)).not.toBeNull();
  });
});
