import { eq } from 'drizzle-orm';
import type { LoaderFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import { materials } from '../../server/db/schema';

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain; charset=utf-8',
};

function guessMime(fileName: string | null): string | null {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return (ext && EXT_MIME[ext]) || null;
}

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);

  const rows = await db.select().from(materials).where(eq(materials.id, params.id!));
  const row = rows[0];
  if (!row || !row.fileKey) {
    throw new Response(null, { status: 404 });
  }

  const obj = await env.FILES.get(row.fileKey);
  if (!obj) {
    throw new Response(null, { status: 404 });
  }

  const metaType = obj.httpMetadata?.contentType;
  const contentType =
    (metaType && metaType !== 'application/octet-stream' ? metaType : null) ??
    guessMime(row.fileName) ??
    'application/octet-stream';

  const name = row.fileName ?? 'file';
  return new Response(obj.body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `inline; filename="${encodeURIComponent(name)}"`,
      'cache-control': 'private, max-age=300',
    },
  });
}

export default function MaterialView() {
  return null;
}
