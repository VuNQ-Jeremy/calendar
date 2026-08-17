import { eq } from 'drizzle-orm';
import type { LoaderFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { materials } from '../../server/db/schema';

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaffCookieOrBearer(request, env);
  const db = tenantDbFor(env, user);

  // `db.own`, not a bare id match: material ids are the only thing standing between a signed-in
  // teacher and another school's files, and an id is guessable in a way a fence is not.
  const rows = await db.raw
    .select()
    .from(materials)
    .where(db.own(materials, eq(materials.id, params.id!)));
  const row = rows[0];
  if (!row || !row.fileKey) {
    throw new Response(null, { status: 404 });
  }

  const obj = await env.FILES.get(row.fileKey);
  if (!obj) {
    throw new Response(null, { status: 404 });
  }

  const name = row.fileName ?? 'download';
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    },
  });
}

// No default export: this must stay a resource route. With a component export
// React Router treats GETs as document requests and serves the SSR HTML shell
// instead of the loader's binary Response.
