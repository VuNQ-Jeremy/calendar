import { asc, desc, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { accounts, activityLog, parents, sessions, staff, students } from '../db/schema';
import type { TenantDb } from '../db/index';

/**
 * Read-only query layer for `/logs/activity` (server/services/audit.ts writes the table; this
 * module only reads it). Kept out of the route file per this repo's services convention.
 *
 * Every read here is fenced to the admin's own school. `activity_log` carries `tenant_id` on
 * every row (audit.ts stamps it, falling back to the original school for rows raised before a
 * session resolved), so one school's admin reading the stream, an entity's history, or the
 * security panel sees only their own — which matters more here than anywhere else, since these
 * rows quote the before/after contents of records the reader may have no other way to see.
 */

/** JSON columns parsed defensively — a malformed or size-capped snapshot must render as a note,
 *  never a 500 on the admin's one diagnostics page. */
function parseSnapshot(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { __truncated: true };
  }
}

export type ActivityRow = {
  id: number;
  occurredAt: string;
  recordedAt: string;
  source: string;
  actorKind: string;
  actorId: string | null;
  actorName: string | null;
  accountId: string | null;
  sessionRef: string | null;
  ip: string | null;
  userAgent: string | null;
  action: string;
  domain: string | null;
  entityType: string | null;
  entityId: string | null;
  route: string | null;
  intent: string | null;
  status: number | null;
  before: unknown;
  after: unknown;
  meta: unknown;
};

function mapRow(r: typeof activityLog.$inferSelect): ActivityRow {
  return {
    id: r.id,
    occurredAt: r.occurredAt,
    recordedAt: r.recordedAt,
    source: r.source,
    actorKind: r.actorKind,
    actorId: r.actorId,
    actorName: r.actorName,
    accountId: r.accountId,
    sessionRef: r.sessionRef,
    ip: r.ip,
    userAgent: r.userAgent,
    action: r.action,
    domain: r.domain,
    entityType: r.entityType,
    entityId: r.entityId,
    route: r.route,
    intent: r.intent,
    status: r.status,
    before: parseSnapshot(r.beforeJson),
    after: parseSnapshot(r.afterJson),
    meta: parseSnapshot(r.metaJson),
  };
}

export type ActivityFilter = {
  actorKind?: string;
  accountId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** ISO date/time bounds on recorded_at, inclusive. */
  from?: string;
  to?: string;
  /** Cursor pagination: strictly-less-than this id, descending. */
  beforeId?: number;
  /** Default 50, capped at 200. */
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function buildConditions(f: ActivityFilter): SQL[] {
  return [
    f.actorKind ? eq(activityLog.actorKind, f.actorKind) : undefined,
    f.accountId ? eq(activityLog.accountId, f.accountId) : undefined,
    f.action ? eq(activityLog.action, f.action) : undefined,
    f.entityType ? eq(activityLog.entityType, f.entityType) : undefined,
    f.entityId ? eq(activityLog.entityId, f.entityId) : undefined,
    f.from ? gte(activityLog.recordedAt, f.from) : undefined,
    f.to ? lte(activityLog.recordedAt, f.to) : undefined,
    f.beforeId != null ? lt(activityLog.id, f.beforeId) : undefined,
  ].filter((c): c is SQL => c !== undefined);
}

/**
 * Reverse-chronological page, server-`LIMIT`ed. Pops the (limit+1)th row into `nextCursor` rather
 * than issuing a separate COUNT — one query either way, and the caller never needs an exact total,
 * just "is there more".
 */
export async function listActivity(
  db: TenantDb,
  f: ActivityFilter = {},
): Promise<{ rows: ActivityRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(1, f.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const conditions = buildConditions(f);
  const rows = await db.raw
    .select()
    .from(activityLog)
    .where(db.own(activityLog, ...conditions))
    .orderBy(desc(activityLog.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    rows: page.map(mapRow),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/**
 * One account's whole trail, most recent first — the UI groups it into session cards by
 * `session_ref`, treating login/logout rows as the boundaries.
 */
export async function sessionTimeline(
  db: TenantDb,
  accountId: string,
  beforeId?: number,
): Promise<{ rows: ActivityRow[]; nextCursor: number | null }> {
  return listActivity(db, { accountId, beforeId, limit: MAX_LIMIT });
}

/** Every row touching one record, oldest mutation first is NOT what admins want here — most
 *  recent first, matching the stream. Capped at MAX_LIMIT; a single record's history realistically
 *  never approaches that. */
export async function entityHistory(
  db: TenantDb,
  entityType: string,
  entityId: string,
): Promise<ActivityRow[]> {
  const rows = await db.raw
    .select()
    .from(activityLog)
    .where(
      db.own(
        activityLog,
        eq(activityLog.entityType, entityType),
        eq(activityLog.entityId, entityId),
      ),
    )
    .orderBy(desc(activityLog.id))
    .limit(MAX_LIMIT);
  return rows.map(mapRow);
}

/**
 * One row per ACCOUNT, not per session row.
 *
 * `sessions` is append-only in practice — logout deletes the one token it holds, and an expired
 * row is only cleared when someone happens to present it again — so a single account accumulates
 * a live row per login for the length of its TTL (30 days "remember me", 90 on mobile). Listing
 * them raw meant 337 rows across four accounts, 292 of them one test login repeated. Aggregated,
 * the panel answers the question it is actually for: who is signed in, from where, since when.
 */
export type ActiveSessionRow = {
  accountEmail: string;
  /** Live (unexpired) session rows for this account. */
  sessions: number;
  /** Newest session carrying telemetry — null on rows predating the ip/user_agent columns. */
  ip: string | null;
  userAgent: string | null;
  createdAt: string | null;
  /** Furthest-out expiry across this account's live sessions. */
  expiresAt: string;
  /** Live sessions from two or more distinct known IPs. Nulls never trigger it. */
  concurrent: boolean;
};

export type NewIpRow = {
  accountId: string;
  email: string | null;
  ip: string;
  firstSeenAt: string;
};

export type SecurityOverview = {
  authEvents: ActivityRow[];
  activeSessions: ActiveSessionRow[];
  newIps: NewIpRow[];
};

const NEW_IP_WINDOW_DAYS = 14;

/**
 * Three panels: recent auth events, who is currently signed in (flagging >1 concurrent session
 * per account), and logins from an (account, ip) pair never seen before in the last 14 days.
 */
export async function securityOverview(db: TenantDb, now: Date): Promise<SecurityOverview> {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - NEW_IP_WINDOW_DAYS * 86_400_000).toISOString();

  const [authEventRows, sessionRows, recentLogins] = await Promise.all([
    db.raw
      .select()
      .from(activityLog)
      .where(db.own(activityLog, inArray(activityLog.action, ['login', 'login_failed', 'logout'])))
      .orderBy(desc(activityLog.id))
      .limit(200),
    // `sessions` carries no `tenant_id` of its own — a session is a credential for an account,
    // and the account is what belongs to a school. The join is therefore also the fence.
    db.raw
      .select({
        accountId: sessions.accountId,
        email: accounts.email,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(accounts, eq(accounts.id, sessions.accountId))
      .where(db.own(accounts, gt(sessions.expiresAt, nowIso))),
    db.raw
      .select({
        id: activityLog.id,
        accountId: activityLog.accountId,
        ip: activityLog.ip,
        recordedAt: activityLog.recordedAt,
        metaJson: activityLog.metaJson,
      })
      .from(activityLog)
      .where(
        db.own(activityLog, eq(activityLog.action, 'login'), gte(activityLog.recordedAt, cutoff)),
      )
      .orderBy(asc(activityLog.id)),
  ]);

  const byAccount = new Map<string, { row: ActiveSessionRow; ips: Set<string> }>();
  for (const s of sessionRows) {
    const seen = byAccount.get(s.accountId);
    if (!seen) {
      byAccount.set(s.accountId, {
        row: {
          accountEmail: s.email,
          sessions: 1,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          concurrent: false,
        },
        ips: s.ip ? new Set([s.ip]) : new Set(),
      });
      continue;
    }
    seen.row.sessions += 1;
    if (s.ip) seen.ips.add(s.ip);
    if (s.expiresAt > seen.row.expiresAt) seen.row.expiresAt = s.expiresAt;
    // Newest telemetry wins; a legacy null must never overwrite a known device.
    if (s.createdAt && (!seen.row.createdAt || s.createdAt > seen.row.createdAt)) {
      seen.row.createdAt = s.createdAt;
      seen.row.ip = s.ip;
      seen.row.userAgent = s.userAgent;
    }
  }
  const activeSessions: ActiveSessionRow[] = [...byAccount.values()]
    .map(({ row, ips }) => ({ ...row, concurrent: ips.size > 1 }))
    .sort((a, b) => b.sessions - a.sessions);

  // First occurrence of each (accountId, ip) pair within the window...
  const firstInWindow = new Map<string, (typeof recentLogins)[number]>();
  for (const r of recentLogins) {
    if (!r.accountId || !r.ip) continue;
    const key = `${r.accountId} ${r.ip}`;
    if (!firstInWindow.has(key)) firstInWindow.set(key, r);
  }
  // ...then confirmed against the WHOLE table: a pair first seen in the window only counts as
  // "new" if there is truly no earlier login row for it, not just none in the last 14 days.
  const newIps: NewIpRow[] = [];
  for (const first of firstInWindow.values()) {
    const earlier = await db.raw
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        db.own(
          activityLog,
          eq(activityLog.action, 'login'),
          eq(activityLog.accountId, first.accountId as string),
          eq(activityLog.ip, first.ip as string),
          lt(activityLog.id, first.id),
        ),
      )
      .limit(1);
    if (earlier.length) continue;
    const meta = parseSnapshot(first.metaJson) as { email?: string } | null;
    newIps.push({
      accountId: first.accountId as string,
      email: meta?.email ?? null,
      ip: first.ip as string,
      firstSeenAt: first.recordedAt,
    });
  }

  return { authEvents: authEventRows.map(mapRow), activeSessions, newIps };
}

/** id + display label for the stream/session views' account filter dropdown. */
export async function listAccountsForFilter(
  db: TenantDb,
): Promise<{ id: string; label: string }[]> {
  const rows = await db.raw
    .select({
      id: accounts.id,
      email: accounts.email,
      staffName: staff.name,
      studentName: students.name,
      parentName: parents.name,
    })
    .from(accounts)
    .leftJoin(staff, eq(staff.id, accounts.staffId))
    .leftJoin(students, eq(students.id, accounts.studentId))
    .leftJoin(parents, eq(parents.id, accounts.parentId))
    .where(db.own(accounts));
  return rows
    .map((r) => {
      const name = r.staffName ?? r.studentName ?? r.parentName ?? r.email;
      return { id: r.id, label: name === r.email ? r.email : `${name} · ${r.email}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
