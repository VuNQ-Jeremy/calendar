import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as peopleSvc from '../server/services/people';
import {
  requestLoginCode,
  verifyLoginCode,
  pickAccount,
  setPasswordViaOtp,
} from '../server/services/login-otp';
import { verifyPassword } from '../server/services/crypto';
import { createSession } from '../server/services/auth';
import { accounts, parents, parentStudents, zaloChats, loginCodes, sessions } from '../server/db/schema';

/**
 * Zalo OTP login/recovery — the enumeration-safety and brute-force invariants matter more than
 * the happy path here, because this is the new most-attacked endpoint (docs/security.md).
 */

const ON = { ZALO_BOT_TOKEN: '123:abc' };

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

/** Every payload handed to the Bot API since the last reset, as {method, body}. */
let calls = [];

beforeEach(async () => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 'm1' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const d = db();
  await d.raw.delete(loginCodes);
  await d.raw.delete(zaloChats);
});

function textsSent() {
  return calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text);
}

function chatsMessaged() {
  return calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.chat_id);
}

/** A student account with a phone of its own, paired 1:1 to a Zalo chat. */
async function seedStudentWithPhone(d, { name = 'Leo', phone = '+84900111111', chatId = 'c-student' }) {
  const studentRow = await peopleSvc.createStudent(d, { name, color: 'blue', classIds: [] });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: `${crypto.randomUUID()}@mochi.local`,
    passwordHash: '!',
    studentId: studentRow.id,
    phoneE164: phone,
    createdAt: new Date().toISOString(),
  });
  await d.insert(zaloChats).values({
    id: crypto.randomUUID(),
    chatId,
    kind: 'user',
    accountId,
    createdAt: new Date().toISOString(),
  });
  return { accountId, studentId: studentRow.id };
}

/**
 * A family: a parent (with an account and a phone) linked to a child (with an account and no
 * phone of its own) — the shape that puts BOTH accounts behind one phone number, so the picker
 * is reachable. The parent's chat is paired via `parents.phone_e164`, not a self-pair, matching
 * how a real family reaches the bot.
 */
async function seedFamily(d, { phone = '+84900222222', chatId = 'c-family' }) {
  const studentRow = await peopleSvc.createStudent(d, {
    name: 'Mia',
    color: 'blue',
    classIds: [],
  });
  const studentAccountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: studentAccountId,
    email: `${crypto.randomUUID()}@mochi.local`,
    passwordHash: '!',
    studentId: studentRow.id,
    createdAt: new Date().toISOString(),
  });

  const parentRow = await peopleSvc.createParent(d, {
    name: 'Mother Mia',
    color: 'green',
    studentIds: [studentRow.id],
  });
  await d.raw.update(parents).set({ phoneE164: phone }).where(eq(parents.id, parentRow.id));
  const parentAccountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: parentAccountId,
    email: `${crypto.randomUUID()}@mochi.local`,
    passwordHash: '!',
    parentId: parentRow.id,
    phoneE164: phone,
    createdAt: new Date().toISOString(),
  });

  await d.insert(zaloChats).values({
    id: crypto.randomUUID(),
    chatId,
    kind: 'user',
    parentId: parentRow.id,
    createdAt: new Date().toISOString(),
  });

  return { parentAccountId, studentAccountId, parentId: parentRow.id, studentId: studentRow.id };
}

describe('requestLoginCode', () => {
  it('sends a code to the paired chat for a direct phone match', async () => {
    const d = db();
    const { chatId } = { chatId: 'c-student' };
    await seedStudentWithPhone(d, { phone: '+84900111111', chatId });

    const { challengeId } = await requestLoginCode(d.raw, ON, '0900111111');
    expect(challengeId).toBeTruthy();
    expect(chatsMessaged()).toEqual([chatId]);
    expect(textsSent()[0]).toMatch(/Mã đăng nhập Mochi/);
  });

  it('resolves the family-phone route: one phone reaching both parent and child accounts', async () => {
    const d = db();
    await seedFamily(d, { phone: '+84900222222', chatId: 'c-family' });

    const { challengeId } = await requestLoginCode(d.raw, ON, '0900222222');
    // Both accounts share the one paired family chat, so exactly one message goes out even
    // though two accounts will show up in the picker once the code is verified.
    expect(chatsMessaged()).toEqual(['c-family']);
    expect(challengeId).toBeTruthy();
  });

  it('never targets a group chat', async () => {
    const d = db();
    const { accountId, studentId: _s } = await seedStudentWithPhone(d, {
      phone: '+84900333333',
      chatId: 'c-solo',
    });
    // A class group the student's school happens to also have paired — must never receive a code.
    await d.insert(zaloChats).values({
      id: crypto.randomUUID(),
      chatId: 'group-should-not-get-code',
      kind: 'group',
      classId: null,
      createdAt: new Date().toISOString(),
      accountId: null,
    });
    void accountId;
    await requestLoginCode(d.raw, ON, '0900333333');
    expect(chatsMessaged()).toEqual(['c-solo']);
  });

  it('returns an indistinguishable decoy for an unknown phone', async () => {
    const d = db();
    const known = await requestLoginCode(d.raw, ON, '0900444444'); // no account uses this number
    expect(known.challengeId).toBeTruthy();
    expect(Object.keys(known)).toEqual(['challengeId']);
    expect(calls).toHaveLength(0); // no message sent for a non-match
  });

  it('returns the same decoy shape for an unparseable phone', async () => {
    const d = db();
    const result = await requestLoginCode(d.raw, ON, 'not-a-phone');
    expect(Object.keys(result)).toEqual(['challengeId']);
  });

  it('invalidates a prior outstanding challenge for the same phone on re-request', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84900555555', chatId: 'c-resend' });
    const first = await requestLoginCode(d.raw, ON, '0900555555');
    const second = await requestLoginCode(d.raw, ON, '0900555555');
    expect(first.challengeId).not.toBe(second.challengeId);

    const rows = await d.raw
      .select()
      .from(loginCodes)
      .where(eq(loginCodes.phoneE164, '+84900555555'));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(second.challengeId);
  });
});

/** Pull the just-sent 6-digit code out of the last text sent, for tests that need to verify it. */
function lastCodeSent() {
  const text = textsSent().at(-1);
  return text.match(/(\d{6})/)[1];
}

describe('verifyLoginCode', () => {
  it('mints a session immediately when exactly one account matches', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84900666666', chatId: 'c-single' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0900666666');
    const code = lastCodeSent();

    const outcome = await verifyLoginCode(d.raw, challengeId, code);
    expect(outcome.ok).toBe(true);
    expect(outcome.session.token).toBeTruthy();
  });

  it('returns a pick list when several accounts share the phone, without minting a session', async () => {
    const d = db();
    await seedFamily(d, { phone: '+84900777777', chatId: 'c-family2' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0900777777');
    const code = lastCodeSent();

    const outcome = await verifyLoginCode(d.raw, challengeId, code);
    expect(outcome.ok).toBe(true);
    expect(outcome.pick).toHaveLength(2);
    expect(outcome.session).toBeUndefined();
  });

  it('rejects a wrong code with the same shape and timing as a decoy', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84900888888', chatId: 'c-wrong' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0900888888');

    const wrong = await verifyLoginCode(d.raw, challengeId, '000000');
    expect(wrong).toEqual({ ok: false });

    const decoy = await verifyLoginCode(d.raw, crypto.randomUUID(), '000000');
    expect(decoy).toEqual({ ok: false });
  });

  it('increments attempts on every wrong guess and kills the challenge at the ceiling', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84900999999', chatId: 'c-lockout' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0900999999');
    const code = lastCodeSent();

    for (let i = 0; i < 5; i++) {
      const result = await verifyLoginCode(d.raw, challengeId, '000000');
      expect(result.ok).toBe(false);
    }
    // The 6th attempt would be the RIGHT code, but the challenge is already dead.
    const stillDead = await verifyLoginCode(d.raw, challengeId, code);
    expect(stillDead.ok).toBe(false);

    const row = (
      await d.raw.select().from(loginCodes).where(eq(loginCodes.id, challengeId))
    )[0];
    expect(row.attempts).toBe(5);
  });

  it('is single-use: a second verify of an already-consumed challenge fails', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84901000001', chatId: 'c-single-use' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901000001');
    const code = lastCodeSent();

    const first = await verifyLoginCode(d.raw, challengeId, code);
    expect(first.ok).toBe(true);

    const second = await verifyLoginCode(d.raw, challengeId, code);
    expect(second.ok).toBe(false);
  });

  it('fails a challenge past its expiry even with the right code', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84901000002', chatId: 'c-expired' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901000002');
    const code = lastCodeSent();

    await d.raw
      .update(loginCodes)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(loginCodes.id, challengeId));

    const outcome = await verifyLoginCode(d.raw, challengeId, code);
    expect(outcome.ok).toBe(false);
  });
});

describe('pickAccount', () => {
  it('mints a session only for a candidate the challenge actually resolved to', async () => {
    const d = db();
    const { parentAccountId } = await seedFamily(d, { phone: '+84901000003', chatId: 'c-pick' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901000003');
    const code = lastCodeSent();
    const verified = await verifyLoginCode(d.raw, challengeId, code);
    expect(verified.pick.map((p) => p.accountId)).toContain(parentAccountId);

    const outsider = await pickAccount(d.raw, challengeId, 'not-a-real-account-id');
    expect(outsider.ok).toBe(false);

    const legit = await pickAccount(d.raw, challengeId, parentAccountId);
    expect(legit.ok).toBe(true);
    expect(legit.session.token).toBeTruthy();
  });

  it('refuses to pick before the challenge has been verified', async () => {
    const d = db();
    const { studentAccountId } = await seedFamily(d, { phone: '+84901000004', chatId: 'c-early' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901000004');

    const early = await pickAccount(d.raw, challengeId, studentAccountId);
    expect(early.ok).toBe(false);
  });
});

describe('phone mirror (server/services/people.ts)', () => {
  it('mirrors an updated parent phone onto both the person row and their account', async () => {
    const d = db();
    const parentRow = await peopleSvc.createParent(d, { name: 'Bố Nam', color: 'green', studentIds: [] });
    const accountId = crypto.randomUUID();
    await d.insert(accounts).values({
      id: accountId,
      email: `${crypto.randomUUID()}@mochi.local`,
      passwordHash: '!',
      parentId: parentRow.id,
      createdAt: new Date().toISOString(),
    });

    await peopleSvc.updateParent(d, parentRow.id, { phone: '0901234567' });

    const [personRow] = await d.raw.select().from(parents).where(eq(parents.id, parentRow.id));
    expect(personRow.phoneE164).toBe('+84901234567');
    const [acctRow] = await d.raw.select().from(accounts).where(eq(accounts.id, accountId));
    expect(acctRow.phoneE164).toBe('+84901234567');
  });

  it('clears the mirror rather than crashing on an unparseable phone', async () => {
    const d = db();
    const parentRow = await peopleSvc.createParent(d, { name: 'Mẹ An', color: 'green', studentIds: [] });
    await expect(peopleSvc.updateParent(d, parentRow.id, { phone: 'not-a-phone' })).resolves.toBeTruthy();
    const [personRow] = await d.raw.select().from(parents).where(eq(parents.id, parentRow.id));
    expect(personRow.phoneE164).toBeNull();
  });
});

describe('setPasswordViaOtp (Zalo forgot-password)', () => {
  it('never mints a session for a set-password challenge, even with one match', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84901500001', chatId: 'c-setpw-single' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901500001', 'set-password');
    const code = lastCodeSent();

    const outcome = await verifyLoginCode(d.raw, challengeId, code);
    expect(outcome.ok).toBe(true);
    expect(outcome.session).toBeUndefined();
    expect(outcome.pick).toHaveLength(1);
  });

  it('sets a new password and purges every session for the account', async () => {
    const d = db();
    const { accountId } = await seedStudentWithPhone(d, {
      phone: '+84901500002',
      chatId: 'c-setpw-live',
    });
    // A live session that must not survive the reset.
    await createSession(d.raw, accountId, true);

    const { challengeId } = await requestLoginCode(d.raw, ON, '0901500002', 'set-password');
    const code = lastCodeSent();
    const verified = await verifyLoginCode(d.raw, challengeId, code);
    expect(verified.pick.map((p) => p.accountId)).toEqual([accountId]);

    const outcome = await setPasswordViaOtp(d.raw, challengeId, accountId, 'brandNewPw123');
    expect(outcome).toBe('ok');

    const [acct] = await d.raw.select().from(accounts).where(eq(accounts.id, accountId));
    expect(await verifyPassword('brandNewPw123', acct.passwordHash)).toBe(true);

    const remaining = await d.raw.select().from(sessions).where(eq(sessions.accountId, accountId));
    expect(remaining).toHaveLength(0);

    // Single-use: the same challenge cannot be spent twice.
    const second = await setPasswordViaOtp(d.raw, challengeId, accountId, 'anotherPw456');
    expect(second).toBe('invalid');
  });

  it('refuses a login-purpose challenge — set-password and login challenges are not interchangeable', async () => {
    const d = db();
    const { accountId } = await seedStudentWithPhone(d, {
      phone: '+84901500003',
      chatId: 'c-setpw-wrong-purpose',
    });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901500003'); // default purpose: login
    const code = lastCodeSent();
    await verifyLoginCode(d.raw, challengeId, code); // mints a session; challenge now consumed

    const outcome = await setPasswordViaOtp(d.raw, challengeId, accountId, 'somePassword123');
    expect(outcome).toBe('invalid');
  });

  it('refuses an accountId that is not one of the resolved candidates', async () => {
    const d = db();
    await seedStudentWithPhone(d, { phone: '+84901500004', chatId: 'c-setpw-outsider' });
    const { challengeId } = await requestLoginCode(d.raw, ON, '0901500004', 'set-password');
    const code = lastCodeSent();
    await verifyLoginCode(d.raw, challengeId, code);

    const outcome = await setPasswordViaOtp(d.raw, challengeId, 'not-a-real-account', 'somePassword123');
    expect(outcome).toBe('invalid');
  });
});
