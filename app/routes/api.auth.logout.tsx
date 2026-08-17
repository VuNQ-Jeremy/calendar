import { eq } from 'drizzle-orm';
import { withAuth } from '../../server/api/handler';
import { sessions } from '../../server/db/schema';
import { hashToken } from '../../server/services/crypto';
import { record } from '../../server/services/audit';

/**
 * Deletes only the calling device's session; other devices stay signed in.
 *
 * Bypasses server/services/auth.ts's `logout()` — that one parses the session COOKIE, and mobile
 * auth is a Bearer header, so it can't be reused as-is. `record()` is called directly instead; the
 * actor is already resolved by the time this handler runs (`withAuth` → `userFromToken` → `setActor`).
 */
export const action = withAuth('any', async ({ request, db }) => {
  const raw = (request.headers.get('Authorization') ?? '').slice(7).trim();
  // tenant-unscoped: `sessions` carries no tenant_id — the hashed token IS the row key, and a
  // token is unguessable, so a school predicate would add nothing.
  if (raw) await db.raw.delete(sessions).where(eq(sessions.token, await hashToken(raw)));
  record({ action: 'logout' });
  return { ok: true };
});
