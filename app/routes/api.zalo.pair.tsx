import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as zalo from '../../server/services/zalo';
import { ZaloPairInput } from '../../shared/schemas';

/**
 * Pairing codes and the link registry. **Staff only.**
 *
 *   GET    /api/zalo/pair        — every linked conversation, plus outstanding codes
 *   POST   /api/zalo/pair        — issue a code for yourself, a parent, or a class group
 *   DELETE /api/zalo/pair?id=    — unlink a conversation
 *
 * Issuing is staff-gated rather than self-service because two of the three targets are people
 * who cannot log in: a parent has no session (see server/services/auth.ts), and a class group has
 * no identity at all. A teacher generating the code and passing it on IS the flow, not a
 * workaround for one.
 */
export const loader = withAuth('staff', async ({ db }) => {
  const [links, codes] = await Promise.all([zalo.listLinks(db), zalo.pendingCodes(db)]);
  return { links, codes };
});

export const action = withAuth('staff', async (ctx) => {
  const { request, db, user } = ctx;

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw fail('missing_id', 400);
    await zalo.unlink(db, id);
    return { ok: true };
  }

  if (request.method !== 'POST') throw fail('method_not_allowed', 405);

  const input = await parseBody(request, ZaloPairInput);
  const target =
    input.target === 'self'
      ? { accountId: user.account.id }
      : input.target === 'parent'
        ? { parentId: input.parentId }
        : input.target === 'student'
          ? { studentId: input.studentId }
          : { classId: input.classId };

  // The schema guarantees the matching id is present for parent/class, so an empty target here
  // would be a programming error rather than bad input.
  const code = await zalo.createPairCode(db, target, user.kind === 'staff' ? user.user.id : null);
  return code;
});
