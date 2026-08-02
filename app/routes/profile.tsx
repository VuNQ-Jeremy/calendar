import React from 'react';
import { useOutletContext, useFetcher } from 'react-router';
import type { ActionFunctionArgs, ClientActionFunctionArgs } from 'react-router';
import { ProfileScreen } from '../../src/screens-extra.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser, changePassword } from '../../server/services/auth';
import { sessionCookie } from '../../server/session';
import { hashToken } from '../../server/services/crypto';
import * as peopleSvc from '../../server/services/people';
import { ColorId } from '../../shared/schemas';
import { invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const sessionUser = await requireUser(request, env);
  const { user, account } = sessionUser;
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent === 'update-profile') {
    const name = formData.get('name') as string | null;
    const email = formData.get('email') as string | null;
    const phone = formData.get('phone') as string | null;
    const colorRaw = formData.get('color') as string | null;
    const colorParsed = ColorId.safeParse(colorRaw);
    if (sessionUser.kind === 'student') {
      await peopleSvc.updateStudent(db, user.id, {
        ...(name ? { name } : {}),
        ...(email !== null ? { email: email || null } : {}),
        ...(colorParsed.success ? { color: colorParsed.data } : {}),
      });
    } else {
      await peopleSvc.updateStaff(db, user.id, {
        ...(name ? { name } : {}),
        ...(email !== null ? { email: email || null } : {}),
        ...(phone !== null ? { phone: phone || null } : {}),
        ...(colorParsed.success ? { color: colorParsed.data } : {}),
      });
    }
    return { ok: true };
  }

  if (intent === 'change-password') {
    const currentPassword = (formData.get('currentPassword') as string) ?? '';
    const newPassword = (formData.get('newPassword') as string) ?? '';
    if (!currentPassword || !newPassword) {
      return Response.json({ intent, error: 'auth_enter_both' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return Response.json({ intent, error: 'auth_pw_short' }, { status: 400 });
    }
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    const currentTokenHash =
      rawToken && typeof rawToken === 'string' ? await hashToken(rawToken) : '';
    const result = await changePassword(
      db,
      account.id,
      currentPassword,
      newPassword,
      currentTokenHash,
    );
    if (result === 'wrong_current_password') {
      return Response.json({ intent, error: 'auth_wrong_current_pw' }, { status: 400 });
    }
    return { intent, ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('profile', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('profile');
  }
}

export default function Profile() {
  const { user } = useOutletContext<AppContext>();
  const saveFetcher = useFetcher();
  const logoutFetcher = useFetcher();
  const pwFetcher = useFetcher<{ intent?: string; ok?: boolean; error?: string }>();
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

  const handleChangePassword = (currentPassword: string, newPassword: string) => {
    const fd = new FormData();
    fd.set('intent', 'change-password');
    fd.set('currentPassword', currentPassword);
    fd.set('newPassword', newPassword);
    pwFetcher.submit(fd, { method: 'post' });
  };

  const handleLogout = () => {
    logoutFetcher.submit({}, { action: '/logout', method: 'post' });
  };

  const displayUser = { ...user, avatar };
  return (
    <ProfileScreen
      user={displayUser}
      onSave={handleSave}
      onLogout={handleLogout}
      onChangePassword={handleChangePassword}
      pwStatus={{
        busy: pwFetcher.state !== 'idle',
        ok: pwFetcher.data?.ok === true,
        error: pwFetcher.data?.error ?? null,
      }}
    />
  );
}
