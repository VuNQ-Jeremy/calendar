import { asc, eq, inArray, lt } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { BatchItem } from 'drizzle-orm/batch';
import { AsyncLocalStorage } from 'node:async_hooks';
import { activityLog, sessions } from '../db/schema';
import { chunk, rowsPerStatement, type Db } from '../db/index';
import type { SessionUser } from './auth';

// Requires "compatibility_flags": ["nodejs_als"] in wrangler.jsonc (top level AND env.test) and
// in wrangler.test.jsonc — it enables ONLY AsyncLocalStorage, not the full nodejs_compat surface.
//
// Why ALS at all: services are the one place the before-image and the assembled domain shape both
// exist, and they're shared by web + mobile + cron + Zalo — instrumenting them once covers every
// actor. But services have no Request in scope (and cron/Zalo have no Request at all), so the
// repo's existing per-request memo idiom (a WeakMap<Request, …>, see auth.ts's userByRequest)
// cannot reach them. ALS lets `record()` push into an ambient buffer without a logger threaded
// through every function signature; workers/app.ts creates the store and flushes it on
// `ctx.waitUntil`, which keeps the write off the request's hot path.
//
// Deliberately NOT atomic with the mutation it describes. `garden.ts`'s `writeTransition` inserts
// its own audit rows in the same `db.batch` as the state change — a real atomic-audit precedent
// this feature could have followed. It doesn't, on purpose: an audit log outage must never break
// or slow a user action, so this is fail-open, end-of-request, batched-on-waitUntil instead. The
// cost is a small window where a mutation could commit and the log write could still fail (caught
// and console.error'd, never thrown) — accepted, because the alternative risks the opposite.

export type AuditActor = {
  kind: 'staff' | 'student' | 'parent' | 'system' | 'anon';
  id: string | null;
  name: string | null;
  accountId: string | null;
  sessionRef: string | null;
};

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'mutation'
  | 'view'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'password_change'
  | 'password_reset'
  | 'invite_redeem';

export type AuditEntry = {
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  /** Client timestamp, for mobile-outbox / beacon events. Never trusted for anything but display. */
  occurredAt?: string;
  /** Overrides the store's request route — the beacon reports the path it was called for. */
  route?: string;
  meta?: Record<string, unknown>;
};

export type AuditStore = {
  source: 'web' | 'api' | 'beacon' | 'cron' | 'zalo';
  ip: string | null;
  userAgent: string | null;
  route: string;
  method: string;
  intent: string | null;
  domain: string | null;
  status: number | null;
  actor: AuditActor | null;
  entries: AuditEntry[];
};

export const auditALS = new AsyncLocalStorage<AuditStore>();
export const RETENTION_DAYS = 90;
const SNAPSHOT_CAP = 8 * 1024;
const UA_CAP = 256;
/** 21 columns on activity_log (see migrations/0035_activity_log.sql) ⇒ 4 rows/statement. */
const ACTIVITY_LOG_COLUMNS = 21;

export function newRequestStore(request: Request): AuditStore {
  const url = new URL(request.url);
  return {
    // Refined by the /track route itself, which overwrites this to 'beacon' before recording.
    source: url.pathname.startsWith('/api/') ? 'api' : 'web',
    ip: request.headers.get('CF-Connecting-IP'),
    userAgent: (request.headers.get('User-Agent') ?? '').slice(0, UA_CAP) || null,
    route: url.pathname,
    method: request.method,
    intent: null,
    domain: null,
    status: null,
    actor: null,
    entries: [],
  };
}

export function newSystemStore(source: 'cron' | 'zalo', label: string): AuditStore {
  return {
    source,
    ip: null,
    userAgent: null,
    route: label,
    method: 'SYSTEM',
    intent: null,
    domain: null,
    status: null,
    actor: {
      kind: 'system',
      id: label,
      name: source === 'cron' ? `cron ${label}` : 'Zalo',
      accountId: null,
      sessionRef: null,
    },
    entries: [],
  };
}

/**
 * Push an entry into the ambient store. Silent no-op when there is no store — logging must never
 * be a reason a code path can throw, so every call site is safe to make unconditionally, including
 * from tests or scripts that never entered `auditALS.run`.
 */
export function record(entry: AuditEntry): void {
  auditALS.getStore()?.entries.push(entry);
}

/**
 * Attach the resolved session to the ambient store, once per request (called from
 * `userFromToken`, which `getUser`/`requireApiUser` memoize per Request). A no-op when the store's
 * actor is already `system` — a cron or Zalo handler that happens to resolve a user mid-flow must
 * not have its system attribution overwritten.
 */
export function setActor(user: SessionUser, sessionRef: string | null): void {
  const s = auditALS.getStore();
  if (!s || s.actor?.kind === 'system') return;
  s.actor = {
    kind: user.kind,
    id: user.user.id,
    name: user.user.name,
    accountId: user.account.id,
    sessionRef,
  };
}

/**
 * Attribute the ambient store to an account without a full SessionUser — for `login`/
 * `login_failed`, where the identity isn't resolved via `userFromToken` until the *next* request.
 * Deliberate deviation from a literal read of the spec: without this, the security view's new-IP
 * detection (last login per `(account_id, ip)`) has nothing to key on. Stays `kind: 'anon'` rather
 * than impersonating a resolved session — this says "we know which account", not "who is signed
 * in right now". No-op when the store's actor is already `system`, same guard as `setActor`.
 */
export function attributeAccount(accountId: string | null): void {
  const s = auditALS.getStore();
  if (!s || s.actor?.kind === 'system') return;
  s.actor = { kind: 'anon', id: null, name: null, accountId, sessionRef: null };
}

export function noteAction(intent: string | null, domain: string | null, status: number): void {
  const s = auditALS.getStore();
  if (!s) return;
  if (intent) s.intent = intent;
  if (domain) s.domain = domain;
  s.status = status;
}

/** Did the current request already record a precise CRUD entry? (coarse-wrapper dedupe) */
export function hasCrudEntry(): boolean {
  return !!auditALS
    .getStore()
    ?.entries.some((e) => e.action === 'create' || e.action === 'update' || e.action === 'delete');
}

export function requestMeta(): { ip: string | null; userAgent: string | null } {
  const s = auditALS.getStore();
  return { ip: s?.ip ?? null, userAgent: s?.userAgent ?? null };
}

const REDACT_RE = /password|token|secret|hash/i;

/** Recursively replace any key matching REDACT_RE with a fixed marker. Mandatory — see A.7. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_RE.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * JSON-stringify with redaction and an 8 KB cap. Never throws: a circular object (or anything
 * else JSON.stringify chokes on) becomes the `{__truncated: true}` stub rather than losing the
 * whole flush. Over-cap objects drop their longest string values first — the fields most likely
 * to be a large blob rather than the fact that matters — before falling back to the same stub.
 */
export function snapshotJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const redacted = redact(value);
    let json = JSON.stringify(redacted);
    if (json.length <= SNAPSHOT_CAP) return json;

    if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
      const obj: Record<string, unknown> = { ...(redacted as Record<string, unknown>) };
      const stringKeys = Object.keys(obj)
        .filter((k) => typeof obj[k] === 'string')
        .sort((a, b) => (obj[b] as string).length - (obj[a] as string).length);
      for (const k of stringKeys) {
        obj[k] = '[truncated]';
        json = JSON.stringify(obj);
        if (json.length <= SNAPSHOT_CAP) return json;
      }
    }
    return JSON.stringify({
      __truncated: true,
      keys: redacted && typeof redacted === 'object' ? Object.keys(redacted) : [],
    });
  } catch {
    return JSON.stringify({ __truncated: true });
  }
}

/**
 * One chunked multi-row insert per flush, run inside `ctx.waitUntil` by the caller. Catches and
 * logs its own failures — a broken/full/slow log must never surface as a user-facing error.
 */
export async function flush(db: Db, store: AuditStore): Promise<void> {
  if (!store.entries.length) return;
  try {
    const recordedAt = new Date().toISOString();
    const actor: AuditActor = store.actor ?? {
      kind: 'anon',
      id: null,
      name: null,
      accountId: null,
      sessionRef: null,
    };
    const rows = store.entries.map((e) => ({
      occurredAt: e.occurredAt ?? recordedAt,
      recordedAt,
      source: store.source,
      actorKind: actor.kind,
      actorId: actor.id,
      actorName: actor.name,
      accountId: actor.accountId,
      sessionRef: actor.sessionRef,
      ip: store.ip,
      userAgent: store.userAgent,
      action: e.action,
      domain: store.domain,
      entityType: e.entityType ?? null,
      entityId: e.entityId ?? null,
      route: e.route ?? store.route,
      intent: store.intent,
      status: store.status,
      beforeJson: snapshotJson(e.before),
      afterJson: snapshotJson(e.after),
      metaJson: snapshotJson(e.meta),
    }));
    const parts = chunk(rows, rowsPerStatement(ACTIVITY_LOG_COLUMNS));
    const inserts: BatchItem<'sqlite'>[] = parts.map((part) => db.insert(activityLog).values(part));
    await db.batch(inserts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  } catch (err) {
    console.error('[audit] flush failed', { err: String(err) });
  }
}

/**
 * Delete rows older than RETENTION_DAYS, 500 ids at a time, max 20 batches per run (≤10k
 * deletes/run) — bounded so one purge tick can never itself become the slow thing, and
 * self-healing across a missed day since it just picks up where the last run left off.
 */
export async function purgeOldLogs(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const old = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(lt(activityLog.recordedAt, cutoff))
      .orderBy(asc(activityLog.id))
      .limit(500);
    if (!old.length) break;
    await db.delete(activityLog).where(
      inArray(
        activityLog.id,
        old.map((r) => r.id),
      ),
    );
    total += old.length;
    if (old.length < 500) break;
  }
  console.log('[audit] purged', { count: total });
  return total;
}

/**
 * Delete session rows whose expiry has passed.
 *
 * Nothing else ever does: `logout` deletes the one token it holds and `userFromToken` clears a
 * row only if someone presents that exact expired token again, so abandoned sessions — script
 * logins, e2e sign-ins, a reinstalled app — sit in the table until something asks for them, which
 * for an abandoned token is never. They are dead credentials either way (every read checks
 * `expires_at`); this just stops the table, and the security panel reading it, from filling up
 * with them.
 */
export async function purgeExpiredSessions(db: Db, now: Date): Promise<number> {
  const res = await db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString()));
  const count = res.meta?.changes ?? 0;
  console.log('[audit] sessions purged', { count });
  return count;
}

// ---- Precise-capture helpers (services, and crud()'s generic entity path) ----

/** Any Drizzle SQLite table with a text `id` primary key — every table this module reads by id. */
export type TableWithId = SQLiteTable & { id: AnySQLiteColumn };

/**
 * Call BEFORE the delete. Reads the row (letting the caller fold cascade-deleted join data, e.g.
 * classIds/parentIds, into `extra` so it survives into `before_json`) and records `action:'delete'`.
 * A missing row (already gone) is a silent no-op rather than a thrown error.
 */
export async function recordDelete(
  db: Db,
  entityType: string,
  table: TableWithId,
  id: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const rows = await db.select().from(table).where(eq(table.id, id)).limit(1);
  const before = rows[0] as Record<string, unknown> | undefined;
  if (!before) return;
  record({
    action: 'delete',
    entityType,
    entityId: id,
    before: extra ? { ...before, ...extra } : before,
  });
}

export function recordCreate(entityType: string, id: string, row: unknown): void {
  record({ action: 'create', entityType, entityId: id, after: row });
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * before-read → mutate() → after-read → record 'update' — skipped when before and after are
 * identical (a real no-op update, e.g. a patch that changed nothing, must not be logged). The
 * extra reads are D1 *reads* (5M/day free), negligible next to the write budget this exists to
 * protect.
 */
export async function auditedUpdate(
  db: Db,
  entityType: string,
  table: TableWithId,
  id: string,
  mutate: () => Promise<void>,
): Promise<void> {
  const beforeRows = await db.select().from(table).where(eq(table.id, id)).limit(1);
  const before = beforeRows[0] as Record<string, unknown> | undefined;
  await mutate();
  const afterRows = await db.select().from(table).where(eq(table.id, id)).limit(1);
  const after = afterRows[0] as Record<string, unknown> | undefined;
  if (deepEqualJson(before, after)) return;
  record({ action: 'update', entityType, entityId: id, before, after });
}
