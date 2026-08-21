import React from 'react';
import { eq, and, or, ne, exists } from 'drizzle-orm';
import { useOutletContext, useFetcher, useLoaderData } from 'react-router';
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs,
} from 'react-router';
import { ProfileScreen } from '../../src/screens-extra.jsx';
import type { AppContext } from './_app.js';
import { tenantDbFor } from '../../server/db';
import { accounts, zaloChats } from '../../server/db/schema';
import { cloudflareCtx } from '../../app/load-context';
import {
  requireUser,
  changePassword,
  removePassword,
  requestEmailVerification,
} from '../../server/services/auth';
import { isRealEmail } from '../../server/services/email';
import { googleEnabled } from '../../server/services/google-auth';
import { sessionCookie } from '../../server/session';
import { hashToken, NO_PASSWORD } from '../../server/services/crypto';
import * as peopleSvc from '../../server/services/people';
import { createPairCode } from '../../server/services/zalo';
import { ColorId } from '../../shared/schemas';
import { invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const sessionUser = await requireUser(request, env);
  const db = tenantDbFor(env, sessionUser);
  const [chatRows, accountRows] = await Promise.all([
    db.raw
      .select({ id: zaloChats.id })
      .from(zaloChats)
      .where(db.own(zaloChats, eq(zaloChats.accountId, sessionUser.account.id)))
      .limit(1),
    // tenant-unscoped: `accounts` is auth-owned, same exemption `changePassword` below relies on.
    db.raw
      .select({
        passwordHash: accounts.passwordHash,
        emailVerifiedAt: accounts.emailVerifiedAt,
        googleSub: accounts.googleSub,
      })
      .from(accounts)
      .where(eq(accounts.id, sessionUser.account.id)),
  ]);
  return {
    zaloPaired: chatRows.length > 0,
    hasPassword: accountRows[0]?.passwordHash !== NO_PASSWORD,
    emailVerified: !!accountRows[0]?.emailVerifiedAt,
    hasRealEmail: isRealEmail(sessionUser.account.email),
    googleLinked: !!accountRows[0]?.googleSub,
    googleEnabled: googleEnabled(env),
    googleError: new URL(request.url).searchParams.get('error'),
  };
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const sessionUser = await requireUser(request, env);
  const { user, account } = sessionUser;
  const db = tenantDbFor(env, sessionUser);
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
    } else if (sessionUser.kind === 'parent') {
      await peopleSvc.updateParent(db, user.id, {
        ...(name ? { name } : {}),
        ...(email !== null ? { email: email || null } : {}),
        ...(phone !== null ? { phone: phone || null } : {}),
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
    // currentPassword may be legitimately empty — a passwordless account is setting its FIRST
    // password, and changePassword() itself skips the check for that case (server/services/
    // auth.ts). Any other account submitting blank simply fails as a wrong current password.
    const currentPassword = (formData.get('currentPassword') as string) ?? '';
    const newPassword = (formData.get('newPassword') as string) ?? '';
    if (!newPassword) {
      return Response.json({ intent, error: 'auth_enter_both' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return Response.json({ intent, error: 'auth_pw_short' }, { status: 400 });
    }
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    const currentTokenHash =
      rawToken && typeof rawToken === 'string' ? await hashToken(rawToken) : '';
    const result = await changePassword(
      // tenant-unscoped: `accounts` is auth-owned and `sessions` carries no tenant_id — the
      // account id from the resolved session is what fences this, not a school predicate.
      db.raw,
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

  if (intent === 'send-verify-email') {
    const result = await requestEmailVerification(
      db.raw,
      account.id,
      account.email,
      env,
      new URL(request.url).origin,
    );
    if (!result) {
      return Response.json({ intent, error: 'auth_email_not_real' }, { status: 400 });
    }
    return { intent, sent: true, devUrl: result.devUrl ?? null };
  }

  if (intent === 'remove-password') {
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    const currentTokenHash =
      rawToken && typeof rawToken === 'string' ? await hashToken(rawToken) : '';
    const result = await removePassword(db.raw, account.id, currentTokenHash);
    if (result === 'needs_another_method') {
      return Response.json({ intent, error: 'prof_remove_pw_needs_method' }, { status: 400 });
    }
    return { intent, ok: true };
  }

  if (intent === 'unlink-google') {
    // The last-method guard is IN the UPDATE's WHERE, not a read beforehand — this races with
    // removePassword from another tab, and read-then-write would let both proceed. See
    // removePassword in server/services/auth.ts for the full reasoning; D1 serialising writes
    // is what makes the conditional write sufficient.
    const pairedChat = exists(
      db.raw
        .select({ id: zaloChats.id })
        .from(zaloChats)
        .where(db.own(zaloChats, eq(zaloChats.accountId, account.id))),
    );
    await db.raw
      .update(accounts)
      .set({ googleSub: null })
      .where(
        and(eq(accounts.id, account.id), or(ne(accounts.passwordHash, NO_PASSWORD), pairedChat)),
      );
    const [after] = await db.raw
      .select({ googleSub: accounts.googleSub })
      .from(accounts)
      .where(eq(accounts.id, account.id));
    if (after?.googleSub) {
      return Response.json({ intent, error: 'prof_unlink_needs_method' }, { status: 400 });
    }
    return { intent, ok: true };
  }

  if (intent === 'zalo-pair') {
    // Self-service, any signed-in kind: `createPairCode`'s `self` target is exactly this
    // account's own id, unlike api.zalo.pair.tsx (staff-only — that route also mints codes for
    // OTHER people, who cannot ask for themselves).
    const code = await createPairCode(db, { accountId: account.id });
    return { intent, code: code.code, expiresAt: code.expiresAt };
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
  const {
    zaloPaired,
    hasPassword,
    emailVerified,
    hasRealEmail,
    googleLinked,
    googleEnabled: showGoogleLink,
    googleError,
  } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher();
  const logoutFetcher = useFetcher();
  const pwFetcher = useFetcher<{ intent?: string; ok?: boolean; error?: string }>();
  const removePwFetcher = useFetcher<{ intent?: string; ok?: boolean; error?: string }>();
  const zaloFetcher = useFetcher<{ intent?: string; code?: string; expiresAt?: string }>();
  const googleFetcher = useFetcher<{ intent?: string; ok?: boolean; error?: string }>();
  const verifyEmailFetcher = useFetcher<{
    intent?: string;
    sent?: boolean;
    devUrl?: string | null;
    error?: string;
  }>();
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

  const handleZaloPair = () => {
    const fd = new FormData();
    fd.set('intent', 'zalo-pair');
    zaloFetcher.submit(fd, { method: 'post' });
  };

  const handleVerifyEmail = () => {
    const fd = new FormData();
    fd.set('intent', 'send-verify-email');
    verifyEmailFetcher.submit(fd, { method: 'post' });
  };

  const handleRemovePassword = () => {
    const fd = new FormData();
    fd.set('intent', 'remove-password');
    removePwFetcher.submit(fd, { method: 'post' });
  };

  const handleUnlinkGoogle = () => {
    const fd = new FormData();
    fd.set('intent', 'unlink-google');
    googleFetcher.submit(fd, { method: 'post' });
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
      zaloStatus={{
        paired: zaloPaired,
        hasPassword,
        busy: zaloFetcher.state !== 'idle',
        code: zaloFetcher.data?.code ?? null,
      }}
      onZaloPair={handleZaloPair}
      emailVerifyStatus={{
        hasRealEmail,
        verified: emailVerified,
        busy: verifyEmailFetcher.state !== 'idle',
        sent: verifyEmailFetcher.data?.sent === true,
        devUrl: verifyEmailFetcher.data?.devUrl ?? null,
      }}
      onVerifyEmail={handleVerifyEmail}
      googleStatus={{
        show: showGoogleLink,
        linked: googleLinked,
        busy: googleFetcher.state !== 'idle',
        // googleFetcher.data.error is already an i18n key (from unlink-google's own response);
        // googleError is one of the fixed codes /auth/google/callback redirects with.
        error:
          googleFetcher.data?.error ??
          (googleError === 'google_sub_taken' ? 'prof_google_sub_taken' : null),
      }}
      onUnlinkGoogle={handleUnlinkGoogle}
      onRemovePassword={handleRemovePassword}
      removePwStatus={{
        busy: removePwFetcher.state !== 'idle',
        error: removePwFetcher.data?.error ?? null,
      }}
    />
  );
}
