import React from 'react';
import { useOutletContext, useFetcher } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';
import { ProfileScreen } from '../../src/screens-extra.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as peopleSvc from '../../server/services/people';
import { ColorId } from '../../shared/schemas';

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { user } = await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent === 'update-profile') {
    const name = formData.get('name') as string | null;
    const email = formData.get('email') as string | null;
    const phone = formData.get('phone') as string | null;
    const colorRaw = formData.get('color') as string | null;
    const colorParsed = ColorId.safeParse(colorRaw);
    await peopleSvc.updateStaff(db, user.id, {
      ...(name ? { name } : {}),
      ...(email !== null ? { email: email || null } : {}),
      ...(phone !== null ? { phone: phone || null } : {}),
      ...(colorParsed.success ? { color: colorParsed.data } : {}),
    });
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Profile() {
  const { user } = useOutletContext<AppContext>();
  const saveFetcher = useFetcher();
  const logoutFetcher = useFetcher();
  const [avatar, setAvatar] = React.useState('');

  const handleSave = (patch: Record<string, unknown>) => {
    if ('avatar' in patch) {
      // Avatar persists to R2 in Phase 5; keep in local state for now.
      setAvatar(patch.avatar as string);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-profile');
    for (const [k, v] of Object.entries(patch)) {
      if (v != null) fd.set(k, String(v));
    }
    saveFetcher.submit(fd, { method: 'post' });
  };

  const handleLogout = () => {
    logoutFetcher.submit({}, { action: '/logout', method: 'post' });
  };

  const displayUser = { ...user, avatar };
  return <ProfileScreen user={displayUser} onSave={handleSave} onLogout={handleLogout} />;
}
