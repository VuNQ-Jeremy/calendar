import { eq, inArray } from 'drizzle-orm';
import { invites, students, staff, parents, accounts } from '../db/schema';
import type { TenantDb } from '../db';
import type { InviteInput } from '../../shared/schemas';
import { makeInviteCode } from '../../shared/logic/invite-code';
import { record, recordCreate, recordDelete } from './audit';

export type InviteRow = {
  id: string;
  code: string;
  role: string;
  name: string | null;
  classId: string | null;
  createdAt: string | null;
  used: boolean;
  studentId: string | null;
  staffId: string | null;
  parentId: string | null;
  /** Name of the linked person, resolved by `list`. Null for legacy (unlinked) invites. */
  personName: string | null;
};

function map(r: typeof invites.$inferSelect, personName: string | null = null): InviteRow {
  return {
    id: r.id,
    code: r.code,
    role: r.role,
    name: r.name,
    classId: r.classId,
    createdAt: r.createdAt,
    used: Boolean(r.used),
    studentId: r.studentId,
    staffId: r.staffId,
    parentId: r.parentId,
    personName,
  };
}

export async function list(db: TenantDb): Promise<InviteRow[]> {
  // Left joins on the three link columns: at most one applies per row, and legacy
  // invites match none of them. Scoping the driving table is enough — a linked person always
  // belongs to the same school as the code that names them.
  const rows = await db.raw
    .select({
      invite: invites,
      studentRow: students,
      staffRow: staff,
      parentRow: parents,
    })
    .from(invites)
    .leftJoin(students, eq(students.id, invites.studentId))
    .leftJoin(staff, eq(staff.id, invites.staffId))
    .leftJoin(parents, eq(parents.id, invites.parentId))
    .where(db.own(invites));
  return rows.map((r) =>
    map(r.invite, r.studentRow?.name ?? r.staffRow?.name ?? r.parentRow?.name ?? null),
  );
}

/**
 * Name of the person a single invite links to, or null for a legacy (unlinked) code.
 *
 * NOTE: called from the anonymous `redeem-check` path with a `TenantDb` built from the invite's
 * OWN school, not from a session — so the scope here is the code's school, by construction.
 */
export async function linkedPersonName(
  db: TenantDb,
  invite: Pick<typeof invites.$inferSelect, 'studentId' | 'staffId' | 'parentId'>,
): Promise<string | null> {
  if (invite.studentId) {
    const rows = await db.raw
      .select({ name: students.name })
      .from(students)
      .where(db.own(students, eq(students.id, invite.studentId)))
      .limit(1);
    return rows[0]?.name ?? null;
  }
  if (invite.staffId) {
    const rows = await db.raw
      .select({ name: staff.name })
      .from(staff)
      .where(db.own(staff, eq(staff.id, invite.staffId)))
      .limit(1);
    return rows[0]?.name ?? null;
  }
  if (invite.parentId) {
    const rows = await db.raw
      .select({ name: parents.name })
      .from(parents)
      .where(db.own(parents, eq(parents.id, invite.parentId)))
      .limit(1);
    return rows[0]?.name ?? null;
  }
  return null;
}

export type LinkedTarget =
  | { role: 'Student'; studentId: string }
  | { role: 'Staff'; staffId: string }
  | { role: 'Parent'; parentId: string };

/**
 * Whether a code would actually be worth minting for this person.
 *
 * False once somebody has signed in as them, or while a code they were already given is
 * still waiting — a second code in either case is one that redeem will refuse (see the
 * has-account guard in redeemInvite), so handing it to staff would be handing them a dud.
 *
 * Used when linking an EXISTING parent to a new student: a parent added last term already
 * has their code, but one carried over from before invites were linked has none.
 */
export async function needsInvite(db: TenantDb, target: LinkedTarget): Promise<boolean> {
  const [accountCol, inviteCol, id] =
    target.role === 'Student'
      ? ([accounts.studentId, invites.studentId, target.studentId] as const)
      : target.role === 'Staff'
        ? ([accounts.staffId, invites.staffId, target.staffId] as const)
        : ([accounts.parentId, invites.parentId, target.parentId] as const);
  const [account, open] = await db.batch([
    // tenant-unscoped: `accounts` is auth-owned, and the person id this matches on is a UUID
    // that already belongs to one school — an account in another school cannot carry it.
    db.raw.select().from(accounts).where(eq(accountCol, id)),
    db.raw
      .select()
      .from(invites)
      .where(db.own(invites, eq(inviteCol, id), eq(invites.used, false))),
  ]);
  return account.length === 0 && open.length === 0;
}

const MAX_CODE_ATTEMPTS = 5;

/**
 * Mint one code per target, linked to a person who already exists.
 *
 * Codes are generated here rather than in the browser so a collision can be retried and
 * the codes can come back in the same response the creation modal is already awaiting.
 * The unique index on `code` is the real guarantee; the pre-check just avoids burning a
 * failed insert. Returned in the same order as `targets`.
 */
export async function createLinked(db: TenantDb, targets: LinkedTarget[]): Promise<InviteRow[]> {
  if (targets.length === 0) return [];
  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const codes = targets.map(() => makeInviteCode());
    if (new Set(codes).size !== codes.length) continue; // collision within this batch
    // tenant-unscoped on purpose: `invites.code` is globally unique (redemption has no session,
    // so the code is the school selector). A scoped pre-check would miss a neighbouring school's
    // code and turn the collision into the UNIQUE violation this loop exists to avoid.
    const taken = await db.raw.select().from(invites).where(inArray(invites.code, codes));
    if (taken.length > 0) continue;

    const values = targets.map((t, i) => ({
      id: crypto.randomUUID(),
      code: codes[i],
      role: t.role,
      name: null,
      classId: null,
      createdAt,
      used: false,
      studentId: 'studentId' in t ? t.studentId : null,
      staffId: 'staffId' in t ? t.staffId : null,
      parentId: 'parentId' in t ? t.parentId : null,
    }));
    try {
      await db.insert(invites).values(values);
    } catch (err) {
      // UNIQUE violation between the pre-check and the insert — regenerate and retry.
      if (attempt === MAX_CODE_ATTEMPTS - 1) throw err;
      continue;
    }
    const rows = await db.raw
      .select()
      .from(invites)
      .where(
        db.own(
          invites,
          inArray(
            invites.id,
            values.map((v) => v.id),
          ),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const created = values.map((v) => map(byId.get(v.id) ?? (v as typeof invites.$inferSelect)));
    for (const row of created) recordCreate('invite', row.id, row);
    return created;
  }
  throw new Error('could not generate a unique invite code');
}

/**
 * Admin escape hatch: the everyday recovery when a family has neither the old password nor a
 * working Zalo/Google login. Deletes the person's account entirely — not just its password —
 * and mints a fresh linked invite in its place, exactly as if this were their first one.
 *
 * The delete matters, not just resets the hash: `redeemInvite`'s linked path refuses to attach a
 * SECOND account to a person who already has one (server/services/auth.ts), by design — one
 * login per person. Deleting the old account first is what lets the fresh code above redeem
 * normally, and it cascades cleanly: `sessions`, `login_codes.account_id`, `zalo_chats.account_id`
 * (the person's own self-pair) and the rest all reference `accounts.id` `ON DELETE CASCADE`. A
 * family-level Zalo pairing (`zalo_chats.parentId`/`studentId`) is untouched, so passwordless
 * redeem is still reachable on the new account if it was before.
 *
 * Returns null when the person is not in the caller's school, or has no account yet — the two
 * cases deliberately answer identically, so this cannot be used to probe whether a guessed
 * person id exists elsewhere.
 */
export async function resetLogin(
  db: TenantDb,
  target: LinkedTarget,
): Promise<{ code: string } | null> {
  const [personTable, accountCol, personId] =
    target.role === 'Student'
      ? ([students, accounts.studentId, target.studentId] as const)
      : target.role === 'Staff'
        ? ([staff, accounts.staffId, target.staffId] as const)
        : ([parents, accounts.parentId, target.parentId] as const);

  // The tenant fence, and it is load-bearing: `personId` arrives straight from a form, and
  // everything below runs on the raw handle (`accounts` carries no usable scope of its own
  // here). Without this check, an Admin of ANY school could delete another school's account by
  // posting a foreign person id — the exact cross-tenant hole the TenantDb wrappers exist to
  // make impossible. NOTE the tenant-scope tripwire cannot see the delete below (it only
  // inspects `.from(...)` reads), so this read IS the enforcement; do not remove it as
  // "redundant".
  const [person] = await db.raw
    .select({ id: personTable.id })
    .from(personTable)
    .where(db.own(personTable, eq(personTable.id, personId)));
  if (!person) return null;

  // tenant-unscoped: `accounts` is auth-owned, the same exemption `needsInvite` above relies
  // on — safe here only because the person row was fenced to the caller's school just above.
  const [account] = await db.raw.select().from(accounts).where(eq(accountCol, personId));
  if (!account) return null;

  await db.raw.delete(accounts).where(eq(accounts.id, account.id));
  record({ action: 'delete', entityType: 'account', entityId: account.id });

  const [invite] = await createLinked(db, [target]);
  return { code: invite.code };
}

/**
 * Legacy unlinked invite: the code carries a free-text name and no person row. Still used
 * by the mobile app's invite panel; redeeming one creates the person. See redeemInvite.
 */
export async function create(db: TenantDb, input: InviteInput): Promise<InviteRow> {
  const id = crypto.randomUUID();
  await db.insert(invites).values({
    id,
    code: input.code,
    role: input.role,
    name: input.name ?? null,
    classId: input.classId ?? null,
    createdAt: input.createdAt ?? null,
    used: input.used,
  });
  const rows = await db.raw
    .select()
    .from(invites)
    .where(db.own(invites, eq(invites.id, id)));
  const row = map(rows[0]);
  recordCreate('invite', id, row);
  return row;
}

export async function remove(db: TenantDb, id: string): Promise<void> {
  await recordDelete(db, 'invite', invites, id);
  await db.delete(invites, eq(invites.id, id));
}

export async function countUnused(db: TenantDb): Promise<number> {
  const rows = await db.raw
    .select()
    .from(invites)
    .where(db.own(invites, eq(invites.used, false)));
  return rows.length;
}
