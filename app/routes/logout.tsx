import { redirect } from 'react-router';
import type { ActionFunctionArgs, ClientActionFunctionArgs } from 'react-router';
import { createRawDb } from '../../server/db/internal';
import { cloudflareCtx } from '../../app/load-context';
import { getUser, logout } from '../../server/services/auth';
import { sessionCookie } from '../../server/session';
import { clearCache } from '../../src/lib/cache.js';

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  // tenant-unscoped: all this does is delete the caller's `sessions` row, and `sessions` carries
  // no tenant_id — the hashed cookie token is the row key. Signing out must also work for a
  // session whose school could not be resolved.
  const db = createRawDb(env);
  // logout() never resolves who is signing out — resolve it first (memoized, cheap) so the
  // activity log's logout row is attributed to the right actor.
  await getUser(request, env);
  await logout(db, request);
  const expiredCookie = await sessionCookie.serialize('', { maxAge: 0 });
  return redirect('/login', { headers: { 'Set-Cookie': expiredCookie } });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  clearCache();
  return serverAction();
}

// Redirect GET requests to home (no UI for this route).
export function loader() {
  return redirect('/');
}
