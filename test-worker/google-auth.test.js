import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as peopleSvc from '../server/services/people';
import { accounts } from '../server/db/schema';
import { eq } from 'drizzle-orm';
import {
  googleEnabled,
  exchangeAndValidate,
  matchGoogleAccount,
} from '../server/services/google-auth';

/**
 * Google sign-in: the id_token validation (hand-rolled, no JWKS — see google-auth.ts's header
 * comment) and the account-matching rule are both security-sensitive and easy to get subtly
 * wrong, so every branch of each is covered directly rather than through the OAuth dance (which
 * needs a real IdP and cannot be driven from a unit test at all).
 */

const CLIENT = { GOOGLE_CLIENT_ID: 'client-123', GOOGLE_CLIENT_SECRET: 'secret-abc' };

function b64url(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned JWT with the given payload — signature verification is deliberately not part of
 * this flow (see google-auth.ts), so any third segment is fine for these tests. */
function fakeIdToken(payload) {
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

function stubTokenEndpoint(idToken) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 })),
  );
}

const VALID_PAYLOAD = {
  iss: 'https://accounts.google.com',
  aud: 'client-123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  nonce: 'the-nonce',
  sub: 'google-sub-1',
  email: 'teacher@school.edu',
  email_verified: true,
};

const exchangeOpts = { code: 'x', verifier: 'v', nonce: 'the-nonce', redirectUri: 'https://x/y' };

describe('googleEnabled', () => {
  it('requires both secrets', () => {
    expect(googleEnabled(CLIENT)).toBe(true);
    expect(googleEnabled({ GOOGLE_CLIENT_ID: 'x' })).toBe(false);
    expect(googleEnabled({})).toBe(false);
  });
});

describe('exchangeAndValidate', () => {
  it('accepts a well-formed, matching id_token', async () => {
    stubTokenEndpoint(fakeIdToken(VALID_PAYLOAD));
    const identity = await exchangeAndValidate(CLIENT, exchangeOpts);
    expect(identity).toEqual({
      sub: 'google-sub-1',
      email: 'teacher@school.edu',
      emailVerified: true,
    });
  });

  it('rejects a wrong issuer', async () => {
    stubTokenEndpoint(fakeIdToken({ ...VALID_PAYLOAD, iss: 'https://evil.example' }));
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });

  it('rejects a token minted for a different client (wrong aud)', async () => {
    stubTokenEndpoint(fakeIdToken({ ...VALID_PAYLOAD, aud: 'someone-elses-client' }));
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });

  it('rejects an expired token', async () => {
    stubTokenEndpoint(fakeIdToken({ ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });

  it('rejects a token whose nonce does not match what we sent', async () => {
    stubTokenEndpoint(fakeIdToken({ ...VALID_PAYLOAD, nonce: 'a-different-nonce' }));
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });

  it('rejects a response with no id_token at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });

  it('degrades to null rather than throwing on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await exchangeAndValidate(CLIENT, exchangeOpts)).toBeNull();
  });
});

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seedStaffAccount(d, { email, googleSub = null, emailVerifiedAt = null }) {
  const staffRow = await peopleSvc.createStaff(d, { name: 'G Teacher', color: 'orange' });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email,
    passwordHash: '!',
    staffId: staffRow.id,
    googleSub,
    emailVerifiedAt,
    createdAt: new Date().toISOString(),
  });
  return accountId;
}

describe('matchGoogleAccount', () => {
  it('matches directly on an already-pinned google_sub', async () => {
    const d = db();
    const accountId = await seedStaffAccount(d, {
      email: `${crypto.randomUUID()}@school.edu`,
      googleSub: 'sub-pinned',
    });
    const result = await matchGoogleAccount(d.raw, {
      sub: 'sub-pinned',
      email: 'irrelevant@example.com',
      emailVerified: false,
    });
    expect(result.accountId).toBe(accountId);
  });

  it('matches and pins the sub when Google AND we have both verified the email', async () => {
    const d = db();
    const email = `${crypto.randomUUID()}@school.edu`;
    const accountId = await seedStaffAccount(d, {
      email,
      emailVerifiedAt: new Date().toISOString(),
    });
    const result = await matchGoogleAccount(d.raw, { sub: 'sub-new', email, emailVerified: true });
    expect(result.accountId).toBe(accountId);
    const [row] = await d.raw.select().from(accounts).where(eq(accounts.id, accountId));
    expect(row.googleSub).toBe('sub-new');
  });

  it('refuses when Google has not verified the email, even if it matches', async () => {
    const d = db();
    const email = `${crypto.randomUUID()}@school.edu`;
    await seedStaffAccount(d, { email, emailVerifiedAt: new Date().toISOString() });
    const result = await matchGoogleAccount(d.raw, { sub: 'sub-x', email, emailVerified: false });
    expect(result.error).toBe('no_account');
  });

  it('refuses when WE have not verified the email, even if Google has', async () => {
    const d = db();
    const email = `${crypto.randomUUID()}@school.edu`;
    await seedStaffAccount(d, { email, emailVerifiedAt: null });
    const result = await matchGoogleAccount(d.raw, { sub: 'sub-y', email, emailVerified: true });
    expect(result.error).toBe('no_account');
  });

  it('refuses a synthetic invite-redeem address even if both sides claim verified', async () => {
    const d = db();
    const email = `invite-${crypto.randomUUID()}@mochi.local`;
    await seedStaffAccount(d, { email, emailVerifiedAt: new Date().toISOString() });
    const result = await matchGoogleAccount(d.raw, { sub: 'sub-z', email, emailVerified: true });
    expect(result.error).toBe('no_account');
  });

  it('refuses when no account matches the email at all', async () => {
    const d = db();
    const result = await matchGoogleAccount(d.raw, {
      sub: 'sub-nowhere',
      email: `${crypto.randomUUID()}@nowhere.example`,
      emailVerified: true,
    });
    expect(result.error).toBe('no_account');
  });
});
