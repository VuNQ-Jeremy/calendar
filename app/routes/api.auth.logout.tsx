import { eq } from 'drizzle-orm';
import { withAuth } from '../../server/api/handler';
import { sessions } from '../../server/db/schema';
import { hashToken } from '../../server/services/crypto';

/** Deletes only the calling device's session; other devices stay signed in. */
export const action = withAuth('user', async ({ request, db }) => {
  const raw = (request.headers.get('Authorization') ?? '').slice(7).trim();
  if (raw) await db.delete(sessions).where(eq(sessions.token, await hashToken(raw)));
  return { ok: true };
});
