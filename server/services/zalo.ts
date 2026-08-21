import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { accounts, parentStudents, zaloChats, zaloPairCodes } from '../db/schema';
import { TenantDb, type Db } from '../db/index';
import { record, setActorTenant } from './audit';

/**
 * Zalo Bot channel — the conversation registry, the sender, and the pairing flow.
 *
 * Zalo is what this school actually uses. Until now the app only helped with it indirectly, by
 * rendering share images a teacher pasted into a group chat by hand; this makes it a real
 * delivery channel next to Expo push.
 *
 * **Why a bot and not an Official Account.** The OA Open API needs a verified OA, which needs
 * company documents, and ZNS on top of that needs per-template approval and per-message fees.
 * The Bot Platform (bot.zaloplatforms.com) needs a personal Zalo account and nothing else, and
 * — the part that decides it — lets the bot message any conversation that has paired with it,
 * unprompted and with no reply window. Cron notifications are impossible without that.
 *
 * **Transport.** A plain HTTPS POST from the Worker, like Expo and unlike Anthropic: Zalo is a
 * Vietnamese service and has no quarrel with Cloudflare's Hong Kong egress, so this must NOT go
 * through TRANSLATE_DO. Every call funnels through `callBot` so that if it ever does, there is
 * one place to reroute.
 *
 * **Disabled by default.** No ZALO_BOT_TOKEN means every send quietly no-ops. That is what keeps
 * the e2e environment inert while still letting it drive the webhook.
 *
 * **Scoping.** `zalo_chats` and `zalo_pair_codes` both carry a school, and everything a signed-in
 * staff member touches goes through a `TenantDb`. The inbound half cannot: a webhook delivery has
 * no session, and the only identity it carries is Zalo's `chat_id` (or a typed pairing code).
 * Both of those selectors stay globally unique for exactly that reason, so the incoming path
 * takes the unscoped handle, resolves the school FROM the row it finds, and scopes everything
 * downstream of that point.
 */

const API_BASE = 'https://bot-api.zaloplatforms.com';

/** Zalo's documented cap on a caption. Text messages get the same ceiling. */
const MAX_TEXT = 2000;

/** How long a pairing code stays redeemable. Long enough to forward to a parent and be read. */
const CODE_TTL_MS = 24 * 60 * 60 * 1000;

export type ZaloChatKind = 'user' | 'group';

export type ZaloChatRow = {
  id: string;
  chatId: string;
  kind: ZaloChatKind;
  accountId: string | null;
  parentId: string | null;
  studentId: string | null;
  classId: string | null;
  displayName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

/**
 * Who a code (and the chat that redeems it) belongs to. Exactly one field is set.
 *
 * `parentId` and `studentId` are both ways of reaching a family, deliberately kept separate:
 * a parent record can cover several children, while a student link needs no parent record at
 * all — which matters because most students do not have one. See migrations/0028.
 */
export type ZaloTarget = {
  accountId?: string | null;
  parentId?: string | null;
  studentId?: string | null;
  classId?: string | null;
};

// ---- Transport ----

/**
 * The configured token, with surrounding whitespace removed.
 *
 * The trim is not decoration. The token goes into the URL PATH, so a single trailing newline —
 * which is what `echo "$TOKEN" | wrangler secret put` stores, and what a copy-paste out of a Zalo
 * message tends to carry — makes every request 404 with `Not Found`. That is indistinguishable
 * at a glance from a routing problem, and nothing logs the token to compare, so it costs an hour
 * to find. Zalo answers a genuinely wrong token with `Unauthorized` 401 instead, which is the
 * only way to tell the two apart.
 */
function botToken(env: Env): string {
  return (env.ZALO_BOT_TOKEN ?? '').trim();
}

/** The channel is off unless a token is configured. Callers check this before doing any work. */
export function isEnabled(env: Env): boolean {
  return Boolean(botToken(env));
}

interface BotResult {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
}

/**
 * One call to the Bot API.
 *
 * The URL carries the bot token, which is a full credential — anyone holding it controls the
 * bot. It is therefore never logged, and errors are reported by method name only.
 *
 * Never throws: a delivery failure is not worth failing a cron run for, exactly as in push.ts.
 */
export async function callBot(env: Env, method: string, payload: unknown): Promise<BotResult> {
  const token = botToken(env);
  if (!token) return { ok: false, description: 'disabled' };
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json().catch(() => null)) as BotResult | null;
    if (!res.ok || !body?.ok) {
      console.error('[zalo] call failed', {
        method,
        status: res.status,
        error: body?.description ?? null,
        code: body?.error_code ?? null,
      });
      return body ?? { ok: false, description: `http_${res.status}` };
    }
    return body;
  } catch (err) {
    console.error('[zalo] call threw', { method, err: String(err) });
    return { ok: false, description: 'threw' };
  }
}

/** Send text to one conversation. Returns whether Zalo accepted it. */
export async function sendText(env: Env, chatId: string, text: string): Promise<boolean> {
  if (!isEnabled(env) || !text.trim()) return false;
  const res = await callBot(env, 'sendMessage', { chat_id: chatId, text: text.slice(0, MAX_TEXT) });
  return res.ok;
}

/**
 * Send an image by URL.
 *
 * Zalo fetches the URL from its own servers, so it must be publicly reachable over HTTPS — which
 * is why share cards go through the capability-URL media route rather than the authenticated
 * material routes.
 */
export async function sendPhoto(
  env: Env,
  chatId: string,
  photoUrl: string,
  caption?: string,
): Promise<boolean> {
  if (!isEnabled(env)) return false;
  const res = await callBot(env, 'sendPhoto', {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption ? { caption: caption.slice(0, MAX_TEXT) } : {}),
  });
  return res.ok;
}

/**
 * Send the same text to several conversations, one at a time.
 *
 * Sequential on purpose. The platform allows roughly 120 requests a minute and a school-wide
 * send is tens of messages, so there is nothing to gain from concurrency and a burst is the one
 * way to trip a limit that would drop real notifications.
 */
export async function broadcastText(env: Env, chatIds: string[], text: string): Promise<number> {
  let sent = 0;
  for (const chatId of chatIds) if (await sendText(env, chatId, text)) sent++;
  return sent;
}

// ---- The registry ----

function map(r: typeof zaloChats.$inferSelect): ZaloChatRow {
  return {
    id: r.id,
    chatId: r.chatId,
    kind: r.kind === 'group' ? 'group' : 'user',
    accountId: r.accountId,
    parentId: r.parentId,
    studentId: r.studentId,
    classId: r.classId,
    displayName: r.displayName,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
  };
}

/** Every paired conversation. The admin list, and small enough to read whole. */
export async function listLinks(db: TenantDb): Promise<ZaloChatRow[]> {
  const rows = await db.raw.select().from(zaloChats).where(db.own(zaloChats));
  return rows.map(map);
}

export async function unlink(db: TenantDb, id: string): Promise<void> {
  await db.delete(zaloChats, eq(zaloChats.id, id));
}

/**
 * Detach a conversation, addressed the way the bot itself addresses it.
 *
 * tenant-unscoped: inbound webhook has no session; chat_id is the selector. The person typing
 * `/unlink` is the conversation, and `zalo_chats.chat_id` is globally unique — asking which
 * school they belong to before honouring "stop messaging me" would be the wrong way round.
 */
export async function unlinkByChatId(db: Db, chatId: string): Promise<void> {
  const rows = await db.select().from(zaloChats).where(eq(zaloChats.chatId, chatId));
  if (rows[0]) {
    // The row is the only thing that knows which school this conversation belonged to; tell the
    // ambient store before recording, or the audit entry lands on the wrong school's log.
    setActorTenant(rows[0].tenantId);
    record({ action: 'delete', entityType: 'zalo_link', entityId: rows[0].id, before: rows[0] });
  }
  await db.delete(zaloChats).where(eq(zaloChats.chatId, chatId));
}

/** 1:1 chats belonging to the given accounts — the Zalo twin of push.tokensForAccounts. */
export async function chatsForAccounts(db: TenantDb, accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const rows = await db.raw
    .select({ chatId: zaloChats.chatId })
    .from(zaloChats)
    .where(db.own(zaloChats, inArray(zaloChats.accountId, accountIds)));
  return rows.map((r) => r.chatId);
}

/**
 * Every family chat reachable for these students, by either route.
 *
 * This is the whole reason the channel exists: it reaches people who have no account and no app,
 * which is every parent.
 *
 * Two routes, unioned:
 *   - a `parents` record linked to the student through parent_students
 *   - a chat paired straight to the student (migrations/0028), for the majority who have no
 *     parent record at all
 *
 * Deduped across both, so siblings in one class — and a family that happened to pair both ways —
 * are messaged once rather than twice.
 */
export async function chatsForParentsOfStudents(
  db: TenantDb,
  studentIds: string[],
): Promise<string[]> {
  if (!studentIds.length) return [];
  const [viaParent, viaStudent] = await Promise.all([
    chatsForParentRecordsOf(db, studentIds),
    db.raw
      .select({ chatId: zaloChats.chatId })
      .from(zaloChats)
      .where(db.own(zaloChats, inArray(zaloChats.studentId, studentIds))),
  ]);
  return [...new Set([...viaParent, ...viaStudent.map((r) => r.chatId)])];
}

/**
 * Only the chats belonging to a real `parents` record for these students.
 *
 * The narrow half of the union above, and it exists for money. A student link is whoever
 * redeemed that student's code — which may well be the student. A class reminder reaching a
 * teenager directly is fine; a fee slip is not, so anything about what a family owes addresses
 * a `parents` record or nobody at all.
 *
 * The cost is deliberate: a family paired only through the student target has no parent record,
 * so it receives no slip and the caller answers `not_linked` rather than quietly sending the
 * bill to the child.
 */
export async function chatsForParentRecordsOf(
  db: TenantDb,
  studentIds: string[],
): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db.raw
    .select({ chatId: zaloChats.chatId })
    .from(zaloChats)
    .innerJoin(parentStudents, eq(parentStudents.parentId, zaloChats.parentId))
    .where(db.own(zaloChats, inArray(parentStudents.studentId, studentIds)));
  return [...new Set(rows.map((r) => r.chatId))];
}

/**
 * Whether a student or parent's family already has a reachable 1:1 Zalo chat — by PERSON id, not
 * by account. Used at invite-redeem time (server/services/auth.ts's passwordless path), BEFORE
 * the account being created even exists — unlike every other lookup in this file, so it takes the
 * unscoped `Db` rather than a `TenantDb`, the same way `redeemCode`/`unlinkByChatId` do for the
 * same reason (no session to scope from yet).
 *
 * tenant-unscoped: the person ids come off the invite row, and the invite code already selected
 * the school — a UUID minted by one school cannot name a person in another.
 */
export async function hasFamilyChat(
  rawDb: Db,
  target: { studentId?: string | null; parentId?: string | null },
): Promise<boolean> {
  if (target.parentId) {
    const [byParent, viaChildren] = await Promise.all([
      rawDb
        .select({ id: zaloChats.id })
        .from(zaloChats)
        .where(and(eq(zaloChats.kind, 'user'), eq(zaloChats.parentId, target.parentId)))
        .limit(1),
      rawDb
        .select({ id: zaloChats.id })
        .from(zaloChats)
        .innerJoin(parentStudents, eq(parentStudents.studentId, zaloChats.studentId))
        .where(and(eq(zaloChats.kind, 'user'), eq(parentStudents.parentId, target.parentId)))
        .limit(1),
    ]);
    if (byParent.length || viaChildren.length) return true;
  }
  if (target.studentId) {
    const [byStudent, viaParents] = await Promise.all([
      rawDb
        .select({ id: zaloChats.id })
        .from(zaloChats)
        .where(and(eq(zaloChats.kind, 'user'), eq(zaloChats.studentId, target.studentId)))
        .limit(1),
      rawDb
        .select({ id: zaloChats.id })
        .from(zaloChats)
        .innerJoin(parentStudents, eq(parentStudents.parentId, zaloChats.parentId))
        .where(and(eq(zaloChats.kind, 'user'), eq(parentStudents.studentId, target.studentId)))
        .limit(1),
    ]);
    if (byStudent.length || viaParents.length) return true;
  }
  return false;
}

/** The group chat linked to a class, if one has been. */
export async function chatForClass(db: TenantDb, classId: string): Promise<string | null> {
  const rows = await db.raw
    .select({ chatId: zaloChats.chatId })
    .from(zaloChats)
    .where(db.own(zaloChats, eq(zaloChats.classId, classId)));
  return rows[0]?.chatId ?? null;
}

/** Account ids for a set of staff records. Mirrors push.accountIdsForStaff. */
export async function accountIdsForStaff(db: TenantDb, staffIds: string[]): Promise<string[]> {
  if (!staffIds.length) return [];
  const rows = await db.raw
    .select({ id: accounts.id })
    .from(accounts)
    .where(db.own(accounts, inArray(accounts.staffId, staffIds)));
  return rows.map((r) => r.id);
}

/**
 * Attach a conversation to a person or a class.
 *
 * Upserts on chat_id, so pairing a chat that is already paired MOVES it. Without that, a parent
 * who re-pairs after a mistake would keep receiving the first target's notifications forever,
 * from a row nobody can see they own — the same trap push_tokens avoids.
 *
 * The conflict target stays the bare `chat_id`, which is globally unique: one handset, one
 * conversation with the bot, whichever school it last paired with. `tenant_id` is therefore in
 * the update set as well as the insert — a chat that re-pairs with another school's code moves
 * schools with it, and leaving the old school stamped on it would keep that school's cron
 * fanning out to a family it no longer serves.
 */
async function linkChat(
  db: TenantDb,
  chat: { chatId: string; kind: ZaloChatKind; displayName?: string | null },
  target: ZaloTarget,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(zaloChats)
    .values({
      id: crypto.randomUUID(),
      chatId: chat.chatId,
      kind: chat.kind,
      accountId: target.accountId ?? null,
      parentId: target.parentId ?? null,
      studentId: target.studentId ?? null,
      classId: target.classId ?? null,
      displayName: chat.displayName ?? null,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: zaloChats.chatId,
      set: {
        tenantId: db.tenantId,
        kind: chat.kind,
        accountId: target.accountId ?? null,
        parentId: target.parentId ?? null,
        studentId: target.studentId ?? null,
        classId: target.classId ?? null,
        displayName: chat.displayName ?? null,
        lastSeenAt: now,
      },
    });
}

// ---- Pairing ----

/**
 * Unambiguous alphabet: no O/0 and no I/1.
 *
 * Codes are read off a screen and typed into a phone, often by a parent relaying what a teacher
 * sent them. A code that fails because of a character nobody can tell apart costs a support
 * conversation, which is the entire cost of this feature going wrong.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  // Modulo bias over a 32-letter alphabet and 256 values is exactly zero: 256 % 32 === 0.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export type PairCode = { code: string; expiresAt: string };

/** Issue a single-use code for a person or a class. */
export async function createPairCode(
  db: TenantDb,
  target: ZaloTarget,
  createdBy?: string | null,
): Promise<PairCode> {
  const now = new Date();
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  await db.insert(zaloPairCodes).values({
    code,
    accountId: target.accountId ?? null,
    parentId: target.parentId ?? null,
    studentId: target.studentId ?? null,
    classId: target.classId ?? null,
    createdBy: createdBy ?? null,
    createdAt: now.toISOString(),
    expiresAt,
  });
  return { code, expiresAt };
}

/** Codes a person or class currently has outstanding — so the UI can show one instead of piling up. */
export async function pendingCodes(db: TenantDb): Promise<
  Array<{
    code: string;
    accountId: string | null;
    parentId: string | null;
    studentId: string | null;
    classId: string | null;
    expiresAt: string;
  }>
> {
  const now = new Date().toISOString();
  const rows = await db.raw
    .select({
      code: zaloPairCodes.code,
      accountId: zaloPairCodes.accountId,
      parentId: zaloPairCodes.parentId,
      studentId: zaloPairCodes.studentId,
      classId: zaloPairCodes.classId,
      expiresAt: zaloPairCodes.expiresAt,
    })
    .from(zaloPairCodes)
    .where(db.own(zaloPairCodes, isNull(zaloPairCodes.usedAt), gt(zaloPairCodes.expiresAt, now)));
  return rows;
}

export type RedeemOutcome = 'ok' | 'unknown' | 'expired' | 'used' | 'wrong_context';

/**
 * Redeem a code for a conversation.
 *
 * `wrong_context` is the interesting one: a class code typed into a 1:1 chat would link a
 * person's private chat as if it were the class group, and a personal code typed into a group
 * would send that person's fee slips to everyone in it. Both are silent privacy failures, so the
 * kind of code and the kind of chat must agree.
 *
 * tenant-unscoped lookup: the person typing the code has no session, and `zalo_pair_codes.code`
 * is globally unique for that reason (same as `invites.code`). The code IS the credential, and
 * the school is whatever the row it matched says — read off the row and used to scope the link
 * that follows, so a code minted by school A can only ever produce a chat belonging to A.
 */
export async function redeemCode(
  db: Db,
  code: string,
  chat: { chatId: string; kind: ZaloChatKind; displayName?: string | null },
): Promise<RedeemOutcome> {
  const normalized = code.trim().toUpperCase();
  const rows = await db.select().from(zaloPairCodes).where(eq(zaloPairCodes.code, normalized));
  const row = rows[0];
  if (!row) return 'unknown';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= new Date().toISOString()) return 'expired';

  const wantsGroup = Boolean(row.classId);
  if (wantsGroup !== (chat.kind === 'group')) return 'wrong_context';

  // The code has now selected a school. Everything after this line — the link, the audit row —
  // belongs to it.
  setActorTenant(row.tenantId);
  await linkChat(new TenantDb(db, row.tenantId), chat, {
    accountId: row.accountId,
    parentId: row.parentId,
    studentId: row.studentId,
    classId: row.classId,
  });
  await db
    .update(zaloPairCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(zaloPairCodes.code, normalized));
  record({
    action: 'create',
    entityType: 'zalo_link',
    entityId: chat.chatId,
    after: {
      ...chat,
      accountId: row.accountId,
      parentId: row.parentId,
      studentId: row.studentId,
      classId: row.classId,
    },
  });
  return 'ok';
}

/** Drop spent and expired codes. Rides the daily job, like push.pruneLedger. */
export async function pruneCodes(db: TenantDb): Promise<void> {
  await db.delete(
    zaloPairCodes,
    or(lt(zaloPairCodes.expiresAt, new Date().toISOString()), isNotNull(zaloPairCodes.usedAt)),
  );
}

/**
 * Delete share-card images older than `days`.
 *
 * These are capability URLs: unguessable, but permanent if nothing removes them. Pruning is what
 * turns "hard to find" into "stops working", and it also keeps the bucket from accumulating a
 * PNG per card per week forever. Rides the daily job rather than taking a cron of its own, like
 * push.pruneLedger.
 */
export async function pruneMedia(files: R2Bucket, days = 7): Promise<number> {
  const cutoff = Date.now() - days * 86_400_000;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await files.list({ prefix: 'zalo/', cursor });
    const stale = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
    if (stale.length) {
      await files.delete(stale);
      deleted += stale.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

// ---- Incoming ----

export type ZaloUpdate = {
  event_name?: string;
  message?: {
    text?: string;
    message_id?: string;
    chat?: { id?: string; chat_type?: string };
    from?: { id?: string; display_name?: string; is_bot?: boolean };
  };
};

/**
 * Pull an update out of whichever envelope it arrived in.
 *
 * **The webhook and `getUpdates` do NOT agree**, and finding that out cost a day. `getUpdates`
 * answers with the API's usual `{ ok, result: <update> }` envelope; the webhook POSTs the update
 * BARE:
 *
 *   webhook     {"event_name":"message.text.received","message":{...}}
 *   getUpdates  {"ok":true,"result":{"event_name":"...","message":{...}}}
 *
 * Written against the polled shape alone, the route found no `result` key on every real
 * delivery, answered 200, and did nothing. That is indistinguishable from Zalo not delivering at
 * all — a webhook that silently succeeds leaves no trace on either side — and it sent the
 * investigation looking at DNS, domains and Zalo's own reliability before the payload.
 *
 * Both shapes are accepted: bare is what Zalo sends, wrapped is what scripts/zalo-poll.mjs
 * replays when developing against a local server.
 */
export function unwrapUpdate(payload: unknown): ZaloUpdate | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { result?: unknown; message?: unknown; event_name?: unknown };
  if (body.message || body.event_name) return body as ZaloUpdate;
  if (body.result && typeof body.result === 'object') return body.result as ZaloUpdate;
  return null;
}

const REPLIES: Record<RedeemOutcome, string> = {
  ok: 'Đã kết nối với Mochi ✅ Từ giờ bạn sẽ nhận thông báo lớp học tại đây.',
  unknown: 'Mã không đúng. Bạn kiểm tra lại giúp mình nhé.',
  expired: 'Mã đã hết hạn. Nhờ giáo viên tạo mã mới giúp bạn nhé.',
  used: 'Mã này đã được dùng rồi. Nhờ giáo viên tạo mã mới nhé.',
  wrong_context:
    'Mã này không dùng được ở đây. Mã lớp chỉ dùng trong nhóm chat, mã cá nhân chỉ dùng khi nhắn riêng.',
};

/** A pairing code: exactly the alphabet above, 6 characters, as a whole word. */
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

const LINK_CMDS = new Set(['/link', '/start', '/ketnoi']);
const UNLINK_CMDS = new Set(['/unlink', '/huy']);

/**
 * Handle one incoming update — the whole conversational surface of the bot.
 *
 * Deliberately tiny. This is not a chatbot: it exists so a person can attach their conversation
 * to the school's notifications and detach it again.
 *
 * **Commands are found anywhere in the message, not at the start.** In a group, Zalo only
 * delivers messages that @mention the bot, and it delivers them with the mention still in the
 * text — `"@Bot Mochi dev /link ABC234"`. Anchoring on `/link` would therefore match in a private
 * chat and never once in a group, which is the only place `/link` is ever used.
 *
 * **The two chats have different rules, on purpose.** In private, a bare code works, because
 * that is what a parent forwarded a code will paste. In a group, only an explicit `/link` or
 * `/unlink` does anything at all: a class group is full of ordinary conversation, and a bot that
 * pipes up because somebody typed six capital letters — or answers every message it is mentioned
 * in — is a bot that gets removed from the class group.
 *
 * Never throws. A malformed update must not become a webhook retry storm.
 *
 * Takes the UNSCOPED handle, and is the reason the route that calls it does too. Nothing about an
 * inbound delivery says which school it concerns until a row has been found: `/unlink` is
 * answered from the chat itself, and a code lookup is what selects a school in the first place.
 * Both selectors are globally unique, and both callees below resolve the school from the row.
 */
export async function handleUpdate(db: Db, env: Env, update: ZaloUpdate): Promise<void> {
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg?.from?.is_bot) return;

  const kind: ZaloChatKind = msg.chat?.chat_type === 'GROUP' ? 'group' : 'user';
  const displayName = msg.from?.display_name ?? null;
  const text = (msg.text ?? '').trim();
  if (!text) return;

  const chat = { chatId, kind, displayName };
  const words = text.split(/\s+/);
  const cmdIndex = words.findIndex((w) => LINK_CMDS.has(w.toLowerCase()));

  if (words.some((w) => UNLINK_CMDS.has(w.toLowerCase()))) {
    await unlinkByChatId(db, chatId);
    await sendText(env, chatId, 'Đã ngắt kết nối với Mochi. Nhắn mã mới để kết nối lại.');
    return;
  }

  // The word after the command, or — in a private chat only — any bare code in the message.
  const explicit = cmdIndex >= 0 ? words[cmdIndex + 1] : undefined;
  const candidate =
    explicit ?? (kind === 'user' ? words.find((w) => CODE_RE.test(w.toUpperCase())) : undefined);
  const code = (candidate ?? '').toUpperCase();

  if (CODE_RE.test(code)) {
    const outcome = await redeemCode(db, code, chat);
    await sendText(env, chatId, REPLIES[outcome]);
    return;
  }

  // A `/link` with nothing usable after it was still a request, so it deserves an answer even in
  // a group. Anything else in a group is somebody's conversation, and gets silence.
  if (cmdIndex >= 0) {
    await sendText(env, chatId, REPLIES.unknown);
    return;
  }
  if (kind === 'user') {
    await sendText(
      env,
      chatId,
      'Xin chào! Đây là bot thông báo của Mochi. Gửi mã kết nối (6 ký tự) mà giáo viên cung cấp để bắt đầu nhận thông báo.',
    );
  }
}
