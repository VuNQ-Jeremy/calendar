import { eq, and, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import {
  accounts,
  parents,
  parentStudents,
  staff,
  students,
  tenants,
  zaloChats,
  loginCodes,
  sessions,
} from '../db/schema';
import { normalizePhone } from '../../shared/logic/phone';
import { sendText } from './zalo';
import { createSession, DAY_MS } from './auth';
import { hashPassword } from './crypto';
import { attributeAccount, record, setActorTenant } from './audit';

/**
 * Zalo OTP login and recovery — phone number in, a 6-digit code delivered to a paired Zalo
 * chat, code back out. Never a link inside Zalo: the bot only ever sends text.
 *
 * **Enumeration safety is the whole design.** `requestLoginCode` returns the identical
 * `{ challengeId }` shape whether or not the phone matched anything real — the challengeId for a
 * non-match is a fresh, unstored UUID that `verifyLoginCode` recognises as "nothing to check" and
 * answers with the same failure (after the same 1s sleep) as a wrong code against a real
 * challenge. A caller watching the wire cannot tell "this phone isn't registered" from "wrong
 * code" from "code expired" — they are the same response.
 *
 * **The picker only appears after a correct code**, never before. Showing candidate names ahead
 * of proof would let anyone who knows a family's phone number learn who is enrolled at which
 * school; requiring the code first means only someone who already holds the family's Zalo chat
 * (or the phone itself, for a set-password recovery) ever sees them.
 *
 * **Resolution is re-run at every step** (request, verify, pick) rather than cached on the
 * challenge row, because chat pairings and account links can change between requesting a code and
 * using it, and the answer must always reflect the current state.
 *
 * tenant-unscoped by construction, like `login`/`requestReset` in ./auth — the caller has no
 * session yet, and a single phone number may legitimately match accounts in more than one school
 * (the picker's `schoolName` is what disambiguates that for the caller).
 */

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = 'login' | 'set-password';

/** What the picker shows the (code-verified) caller. Deliberately free of internal ids beyond
 * `accountId` — `tenantId` stays server-side on ResolvedAccount; `schoolName` is the
 * user-facing disambiguator. */
export type OtpCandidate = {
  accountId: string;
  name: string;
  kind: 'staff' | 'student' | 'parent';
  schoolName: string;
};

function randomCode(): string {
  // Rejection-sample so every 6-digit code is equally likely — a plain `% 1_000_000` over
  // Uint32's ~4.29 billion values would very slightly favour codes below the remainder.
  const buf = new Uint32Array(1);
  const ceiling = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < ceiling) return String(buf[0] % 1_000_000).padStart(6, '0');
  }
}

async function codeHash(id: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${id}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ResolvedAccount = OtpCandidate & {
  tenantId: string;
  studentId: string | null;
  parentId: string | null;
};

/**
 * Every account this phone number can prove ownership of, right now.
 *
 * Two routes, unioned and deduped by account id:
 *   (a) `accounts.phone_e164 = phone` directly — any kind, including staff.
 *   (b) `parents.phone_e164 = phone` -> `parent_students` -> the child's own account — the
 *       family-phone path, for a student who typed a parent's number and has no phone of their
 *       own on the account.
 * Suspended tenants are excluded, same as `userFromToken`.
 *
 * tenant-unscoped: the caller has no session, so the phone IS the selector — it may legitimately
 * match accounts in several schools, and the school comes off each row it finds (module header).
 */
async function resolveAccounts(rawDb: Db, phone: string): Promise<ResolvedAccount[]> {
  const direct = await rawDb
    .select({
      accountId: accounts.id,
      tenantId: accounts.tenantId,
      tenantStatus: tenants.status,
      tenantName: tenants.name,
      staffId: accounts.staffId,
      studentId: accounts.studentId,
      parentId: accounts.parentId,
      staffName: staff.name,
      studentName: students.name,
      parentName: parents.name,
    })
    .from(accounts)
    .leftJoin(tenants, eq(tenants.id, accounts.tenantId))
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .leftJoin(parents, eq(parents.id, accounts.parentId))
    .where(eq(accounts.phoneE164, phone));

  const viaFamily = await rawDb
    .select({
      accountId: accounts.id,
      tenantId: accounts.tenantId,
      tenantStatus: tenants.status,
      tenantName: tenants.name,
      studentId: accounts.studentId,
      studentName: students.name,
    })
    .from(parents)
    .innerJoin(parentStudents, eq(parentStudents.parentId, parents.id))
    .innerJoin(accounts, eq(accounts.studentId, parentStudents.studentId))
    .leftJoin(tenants, eq(tenants.id, accounts.tenantId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .where(eq(parents.phoneE164, phone));

  const byId = new Map<string, ResolvedAccount>();

  for (const r of direct) {
    if (r.tenantStatus === 'suspended') continue;
    const kind: ResolvedAccount['kind'] | null = r.staffId
      ? 'staff'
      : r.studentId
        ? 'student'
        : r.parentId
          ? 'parent'
          : null;
    if (!kind) continue;
    const name = r.staffName ?? r.studentName ?? r.parentName;
    if (!name) continue;
    byId.set(r.accountId, {
      accountId: r.accountId,
      tenantId: r.tenantId,
      name,
      kind,
      schoolName: r.tenantName ?? '',
      studentId: r.studentId,
      parentId: r.parentId,
    });
  }

  for (const r of viaFamily) {
    if (r.tenantStatus === 'suspended') continue;
    if (!r.studentName) continue;
    if (byId.has(r.accountId)) continue; // already found via the direct route
    byId.set(r.accountId, {
      accountId: r.accountId,
      tenantId: r.tenantId,
      name: r.studentName,
      kind: 'student',
      schoolName: r.tenantName ?? '',
      studentId: r.studentId,
      parentId: null,
    });
  }

  return [...byId.values()];
}

/**
 * Every 1:1 Zalo chat that should receive a code for these accounts — `kind='user'` only, NEVER
 * a class group. Account-level pairing (`zalo_chats.account_id`) is preferred and person-accurate;
 * the family routes (a parent account's own paired chat, or a student's parents' chats, and vice
 * versa) are unioned in because most families pair through one side of it, not both.
 *
 * tenant-unscoped: keyed on account/person ids that `resolveAccounts` just resolved — UUIDs that
 * each already belong to exactly one school, the same reasoning as `needsInvite`.
 */
async function chatsFor(rawDb: Db, resolved: ResolvedAccount[]): Promise<string[]> {
  if (!resolved.length) return [];
  const accountIds = resolved.map((r) => r.accountId);
  const parentIds = resolved.filter((r) => r.kind === 'parent').map((r) => r.parentId!);
  const studentIds = resolved.filter((r) => r.kind === 'student').map((r) => r.studentId!);

  const [byAccount, byParent, viaChildrenOfParents, viaParentsOfStudents, byStudent] =
    await Promise.all([
      rawDb
        .select({ chatId: zaloChats.chatId })
        .from(zaloChats)
        .where(and(eq(zaloChats.kind, 'user'), inArray(zaloChats.accountId, accountIds))),
      parentIds.length
        ? rawDb
            .select({ chatId: zaloChats.chatId })
            .from(zaloChats)
            .where(and(eq(zaloChats.kind, 'user'), inArray(zaloChats.parentId, parentIds)))
        : Promise.resolve([]),
      parentIds.length
        ? rawDb
            .select({ chatId: zaloChats.chatId })
            .from(zaloChats)
            .innerJoin(parentStudents, eq(parentStudents.studentId, zaloChats.studentId))
            .where(and(eq(zaloChats.kind, 'user'), inArray(parentStudents.parentId, parentIds)))
        : Promise.resolve([]),
      studentIds.length
        ? rawDb
            .select({ chatId: zaloChats.chatId })
            .from(zaloChats)
            .innerJoin(parentStudents, eq(parentStudents.parentId, zaloChats.parentId))
            .where(and(eq(zaloChats.kind, 'user'), inArray(parentStudents.studentId, studentIds)))
        : Promise.resolve([]),
      // The student-target pairing — docs/zalo.md's DEFAULT route, since most students have no
      // parents row at all. Dropping this arm strands exactly those families: resolveAccounts
      // finds them, no chat is found, and the request silently answers with the decoy.
      studentIds.length
        ? rawDb
            .select({ chatId: zaloChats.chatId })
            .from(zaloChats)
            .where(and(eq(zaloChats.kind, 'user'), inArray(zaloChats.studentId, studentIds)))
        : Promise.resolve([]),
    ]);

  return [
    ...new Set(
      [byAccount, byParent, viaChildrenOfParents, viaParentsOfStudents, byStudent]
        .flat()
        .map((r) => r.chatId),
    ),
  ];
}

export type RequestLoginCodeResult = { challengeId: string; devCode?: string };

/**
 * @param waitUntil Pass the request's `ctx.waitUntil` so the Zalo sends run after the response.
 *   Two reasons, both about the decoy: a match otherwise awaits N sequential Bot API round
 *   trips that a decoy never makes — a wall-clock tell the identical response shape exists to
 *   prevent — and a family with several paired chats otherwise stares at a spinner for the
 *   duration. Omit it (tests do) and the sends are awaited inline as before.
 */
export async function requestLoginCode(
  rawDb: Db,
  env: Env,
  phoneInput: string,
  purpose: OtpPurpose = 'login',
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<RequestLoginCodeResult> {
  // The decoy: an unstored, freshly-minted id. verifyLoginCode does equivalent work against it
  // and fails with the same shape and timing as a wrong code on a real challenge.
  const decoy = { challengeId: crypto.randomUUID() };

  const phone = normalizePhone(phoneInput);
  if (!phone) return decoy;

  const resolved = await resolveAccounts(rawDb, phone);
  if (!resolved.length) return decoy;

  const chatIds = await chatsFor(rawDb, resolved);
  if (!chatIds.length) return decoy;

  // One live challenge per phone — a re-request invalidates whatever was outstanding, so a stale
  // code lying around cannot be raced against a fresh one.
  await rawDb
    .delete(loginCodes)
    .where(and(eq(loginCodes.phoneE164, phone), isNull(loginCodes.consumedAt)));

  const id = crypto.randomUUID();
  const code = randomCode();
  const now = Date.now();
  await rawDb.insert(loginCodes).values({
    id,
    phoneE164: phone,
    codeHash: await codeHash(id, code),
    purpose,
    chatIds: JSON.stringify(chatIds),
    attempts: 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
  });

  const label = purpose === 'set-password' ? 'đặt lại mật khẩu' : 'đăng nhập';
  const text =
    resolved.length === 1
      ? `Mã ${label} Mochi cho ${resolved[0].name}: ${code} (hiệu lực 5 phút). Không chia sẻ mã này.`
      : `Mã ${label} Mochi: ${code} (hiệu lực 5 phút). Không chia sẻ mã này.`;
  // Sequential like broadcastText — the Bot API's ~120 req/min ceiling punishes bursts.
  const deliver = (async () => {
    for (const chatId of chatIds) await sendText(env, chatId, text);
  })();
  if (waitUntil) waitUntil(deliver);
  else await deliver;

  // Full phone in meta: a deliberate privacy deviation, same as login()'s full email — this row
  // is admin-only, 90-day-purged, and the security view needs it to spot a targeted number.
  record({ action: 'login_code_requested', meta: { phone, purpose, matched: resolved.length } });

  // Test-environment-only escape (see globals.d.ts) — a decoy never reaches this line, so the
  // dev code only ever appears on a real challenge. That is fine for e2e (which drives the
  // happy path with it) precisely because the property under test elsewhere — that a decoy and
  // a real response are otherwise identical — still holds with or without this field.
  return env.AUTH_DEV_CODES ? { challengeId: id, devCode: code } : { challengeId: id };
}

type LoginCodeRow = typeof loginCodes.$inferSelect;

async function loadChallenge(rawDb: Db, challengeId: string): Promise<LoginCodeRow | undefined> {
  const rows = await rawDb.select().from(loginCodes).where(eq(loginCodes.id, challengeId)).limit(1);
  return rows[0];
}

export type VerifyOutcome =
  | { ok: false }
  | { ok: true; session: { token: string; expiresAt: string } }
  | { ok: true; pick: OtpCandidate[] };

/**
 * @param ttlDays Forwarded to `createSession` verbatim — omit for the web default (30 days,
 *   since OTP sessions are always "remembered"), or pass `MOBILE_TTL_DAYS` (90) from the bearer
 *   twins so a phone login gets the same lifetime a password login would.
 */
async function mintSession(
  rawDb: Db,
  row: LoginCodeRow,
  accountId: string,
  tenantId: string,
  ttlDays?: number,
): Promise<{ token: string; expiresAt: string }> {
  await rawDb
    .update(loginCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(eq(loginCodes.id, row.id));
  const days = ttlDays ?? 30;
  const token = await createSession(rawDb, accountId, true, ttlDays);
  const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
  attributeAccount(accountId);
  setActorTenant(tenantId);
  record({ action: 'login', meta: { method: 'zalo_otp' } });
  return { token, expiresAt };
}

function toCandidate(r: ResolvedAccount): OtpCandidate {
  return {
    accountId: r.accountId,
    name: r.name,
    kind: r.kind,
    schoolName: r.schoolName,
  };
}

/**
 * Verify a code against a challenge. Never mints a session for a `purpose: 'set-password'`
 * challenge — that flow's caller (Phase 4's `otp-set-password` intent) consumes it by writing a
 * new password hash instead.
 *
 * @param ttlDays See `mintSession` — pass `MOBILE_TTL_DAYS` from the bearer twin, omit on web.
 */
export async function verifyLoginCode(
  rawDb: Db,
  challengeId: string,
  code: string,
  ttlDays?: number,
): Promise<VerifyOutcome> {
  const fail = async (): Promise<VerifyOutcome> => {
    await sleep(1000);
    return { ok: false };
  };

  const row = await loadChallenge(rawDb, challengeId);
  if (!row) {
    await codeHash(challengeId, code); // decoy path does the same work as the real one
    return fail();
  }
  if (row.consumedAt || row.attempts >= MAX_ATTEMPTS || Date.parse(row.expiresAt) < Date.now()) {
    return fail();
  }

  // Increment BEFORE comparing — a burst of parallel guesses against the same challenge cannot
  // all read `attempts` before any of them writes it back.
  await rawDb
    .update(loginCodes)
    .set({ attempts: row.attempts + 1 })
    .where(eq(loginCodes.id, row.id));

  if ((await codeHash(row.id, code)) !== row.codeHash) return fail();

  await rawDb
    .update(loginCodes)
    .set({ verifiedAt: new Date().toISOString() })
    .where(eq(loginCodes.id, row.id));

  const resolved = await resolveAccounts(rawDb, row.phoneE164); // fresh — membership may have changed
  if (!resolved.length) return fail();

  if (row.purpose === 'set-password') {
    // The set-password flow's own intent (otp-set-password) re-resolves and re-validates before
    // writing anything; this call just proves the code was right.
    return { ok: true, pick: resolved.map(toCandidate) };
  }
  if (resolved.length === 1) {
    const session = await mintSession(
      rawDb,
      row,
      resolved[0].accountId,
      resolved[0].tenantId,
      ttlDays,
    );
    return { ok: true, session };
  }
  return { ok: true, pick: resolved.map(toCandidate) };
}

/** @param ttlDays See `mintSession`. */
export async function pickAccount(
  rawDb: Db,
  challengeId: string,
  accountId: string,
  ttlDays?: number,
): Promise<{ ok: false } | { ok: true; session: { token: string; expiresAt: string } }> {
  const row = await loadChallenge(rawDb, challengeId);
  if (
    !row ||
    row.purpose !== 'login' ||
    !row.verifiedAt ||
    row.consumedAt ||
    Date.parse(row.expiresAt) < Date.now()
  ) {
    return { ok: false };
  }
  const resolved = await resolveAccounts(rawDb, row.phoneE164);
  const match = resolved.find((r) => r.accountId === accountId);
  if (!match) return { ok: false };
  const session = await mintSession(rawDb, row, match.accountId, match.tenantId, ttlDays);
  return { ok: true, session };
}

/**
 * Finish the Zalo forgot-password flow: a `purpose: 'set-password'` challenge that has already
 * been verified (see `verifyLoginCode` — it never mints a session for this purpose, only ever a
 * `pick` list) is spent here by writing a new password hash instead. Purges EVERY session for the
 * account, same as `resetPassword` — the visitor proved they hold the family's Zalo, not that
 * they hold any particular device's session.
 */
export async function setPasswordViaOtp(
  rawDb: Db,
  challengeId: string,
  accountId: string,
  newPassword: string,
): Promise<'ok' | 'invalid'> {
  const row = await loadChallenge(rawDb, challengeId);
  if (
    !row ||
    row.purpose !== 'set-password' ||
    !row.verifiedAt ||
    row.consumedAt ||
    Date.parse(row.expiresAt) < Date.now()
  ) {
    return 'invalid';
  }
  const resolved = await resolveAccounts(rawDb, row.phoneE164);
  const match = resolved.find((r) => r.accountId === accountId);
  if (!match) return 'invalid';

  const passwordHash = await hashPassword(newPassword);
  await rawDb.batch([
    rawDb.update(accounts).set({ passwordHash }).where(eq(accounts.id, accountId)),
    rawDb
      .update(loginCodes)
      .set({ consumedAt: new Date().toISOString() })
      .where(eq(loginCodes.id, row.id)),
    rawDb.delete(sessions).where(eq(sessions.accountId, accountId)),
  ]);
  attributeAccount(accountId);
  setActorTenant(match.tenantId);
  record({ action: 'password_reset', meta: { stage: 'completed', method: 'zalo_otp' } });
  return 'ok';
}
