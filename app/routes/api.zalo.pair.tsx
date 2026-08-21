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
 * Issuing is staff-gated rather than self-service because the `parent` and `class` targets name
 * somebody OTHER than the caller: a parent's own family (who may have no account yet at all, or
 * be signed in on a different device) and a class group have no way to ask for their own code. A
 * teacher generating the code and passing it on IS the flow. A signed-in account pairing ITSELF
 * uses the `self` target here, or the equivalent self-service intent on Profile — see
 * app/routes/profile.tsx's `zalo-pair` intent, added once login-methods gave every kind of
 * account (parent included) a session to call it from.
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
