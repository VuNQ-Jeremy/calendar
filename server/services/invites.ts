import { and, eq, inArray } from 'drizzle-orm';
import { invites, students, staff, parents, accounts } from '../db/schema';
import type { Db } from '../db/index';
import type { InviteInput } from '../../shared/schemas';
import { makeInviteCode } from '../../shared/logic/invite-code';

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

export async function list(db: Db): Promise<InviteRow[]> {
  // Left joins on the three link columns: at most one applies per row, and legacy
  // invites match none of them.
  const rows = await db
    .select({
      invite: invites,
      studentRow: students,
      staffRow: staff,
      parentRow: parents,
    })
    .from(invites)
    .leftJoin(students, eq(students.id, invites.studentId))
    .leftJoin(staff, eq(staff.id, invites.staffId))
    .leftJoin(parents, eq(parents.id, invites.parentId));
  return rows.map((r) =>
    map(r.invite, r.studentRow?.name ?? r.staffRow?.name ?? r.parentRow?.name ?? null),
  );
}

/** Name of the person a single invite links to, or null for a legacy (unlinked) code. */
export async function linkedPersonName(
  db: Db,
  invite: Pick<typeof invites.$inferSelect, 'studentId' | 'staffId' | 'parentId'>,
): Promise<string | null> {
  if (invite.studentId) {
    const row = await db.query.students.findFirst({ where: eq(students.id, invite.studentId) });
    return row?.name ?? null;
  }
  if (invite.staffId) {
    const row = await db.query.staff.findFirst({ where: eq(staff.id, invite.staffId) });
    return row?.name ?? null;
  }
  if (invite.parentId) {
    const row = await db.query.parents.findFirst({ where: eq(parents.id, invite.parentId) });
    return row?.name ?? null;
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
export async function needsInvite(db: Db, target: LinkedTarget): Promise<boolean> {
  const [accountCol, inviteCol, id] =
    target.role === 'Student'
      ? ([accounts.studentId, invites.studentId, target.studentId] as const)
      : target.role === 'Staff'
        ? ([accounts.staffId, invites.staffId, target.staffId] as const)
        : ([accounts.parentId, invites.parentId, target.parentId] as const);
  const [account, open] = await db.batch([
    db.select().from(accounts).where(eq(accountCol, id)),
    db
      .select()
      .from(invites)
      .where(and(eq(inviteCol, id), eq(invites.used, false))),
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
export async function createLinked(db: Db, targets: LinkedTarget[]): Promise<InviteRow[]> {
  if (targets.length === 0) return [];
  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const codes = targets.map(() => makeInviteCode());
    if (new Set(codes).size !== codes.length) continue; // collision within this batch
    const taken = await db.select().from(invites).where(inArray(invites.code, codes));
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
    const rows = await db
      .select()
      .from(invites)
      .where(
        inArray(
          invites.id,
          values.map((v) => v.id),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return values.map((v) => map(byId.get(v.id) ?? (v as typeof invites.$inferSelect)));
  }
  throw new Error('could not generate a unique invite code');
}

/**
 * Legacy unlinked invite: the code carries a free-text name and no person row. Still used
 * by the mobile app's invite panel; redeeming one creates the person. See redeemInvite.
 */
export async function create(db: Db, input: InviteInput): Promise<InviteRow> {
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
  const rows = await db.select().from(invites).where(eq(invites.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(invites).where(eq(invites.id, id));
}

export async function countUnused(db: Db): Promise<number> {
  const rows = await db.select().from(invites).where(eq(invites.used, false));
  return rows.length;
}
