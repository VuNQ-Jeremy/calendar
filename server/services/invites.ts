import { eq } from 'drizzle-orm';
import { invites } from '../db/schema';
import type { Db } from '../db/index';
import type { InviteInput } from '../../shared/schemas';

export type InviteRow = {
  id: string;
  code: string;
  role: string;
  name: string | null;
  classId: string | null;
  createdAt: string | null;
  used: boolean;
};

function map(r: typeof invites.$inferSelect): InviteRow {
  return {
    id: r.id,
    code: r.code,
    role: r.role,
    name: r.name,
    classId: r.classId,
    createdAt: r.createdAt,
    used: Boolean(r.used),
  };
}

export async function list(db: Db): Promise<InviteRow[]> {
  const rows = await db.select().from(invites);
  return rows.map(map);
}

export async function create(db: Db, input: InviteInput): Promise<InviteRow> {
  const id = crypto.randomUUID();
  await db.insert(invites).values({
    id,
    code: input.code,
    role: input.role,
    name: input.name ?? null,
    classId: input.classId ?? null,
    createdAt: input.createdAt ?? null,
    used: input.used ? 1 : (0 as unknown as boolean),
  });
  const rows = await db.select().from(invites).where(eq(invites.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(invites).where(eq(invites.id, id));
}

export async function countUnused(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.used, false as unknown as boolean));
  return rows.length;
}
