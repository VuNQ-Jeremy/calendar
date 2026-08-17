import { fail, parseBody, withAuth } from '../../server/api/handler';
import { changePassword } from '../../server/services/auth';
import { hashToken } from '../../server/services/crypto';
import { ChangePasswordInput } from '../../shared/schemas';

/**
 * Changing the password signs out every OTHER session for the account — including any
 * browser the user is logged into. The calling device keeps its token.
 */
export const action = withAuth('any', async ({ request, db, user }) => {
  const input = await parseBody(request, ChangePasswordInput);
  const raw = (request.headers.get('Authorization') ?? '').slice(7).trim();
  const currentTokenHash = await hashToken(raw);

  const result = await changePassword(
    // tenant-unscoped: `accounts` is auth-owned and `sessions` carries no tenant_id — the
    // account id from the resolved session is what fences this, not a school predicate.
    db.raw,
    user.account.id,
    input.currentPassword,
    input.newPassword,
    currentTokenHash,
  );
  if (result !== 'ok') throw fail('wrong_current_password', 400);
  return { ok: true };
});
