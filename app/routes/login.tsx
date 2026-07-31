import React from 'react';
import { redirect, useFetcher } from 'react-router';
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { Form, useLoaderData, useActionData } from 'react-router';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import type { IconName } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as invitesSvc from '../../server/services/invites';
import type { InviteRow } from '../../server/services/invites';
import { MASKED_INVITE_CODE } from '../../shared/logic/invite-code';
import {
  getUser,
  login,
  createSession,
  redeemInvite,
  requestReset,
  resetPassword,
} from '../../server/services/auth';
import { sessionCookie } from '../../server/session';

const { Button: LBtn, Switch: LSw, Tag: LTag } = DS;

// ---- Loader ----

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await getUser(request, env);
  if (user) return redirect('/dashboard');
  const db = createDb(env);
  const url = new URL(request.url);
  // Only whether a code is waiting, never which one. This page is unauthenticated, so the code
  // itself would be readable by anyone who opened /login — including the staff codes an admin
  // had just generated for named people.
  const hasOpenInvite = (await invitesSvc.countUnused(db)) > 0;
  return {
    next: url.searchParams.get('next'),
    mode: url.searchParams.get('mode'),
    resetToken: url.searchParams.get('token'),
    resetDone: url.searchParams.get('reset') === 'done',
    hasOpenInvite,
  };
}

// ---- Action ----

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const url = new URL(request.url);
  const next = url.searchParams.get('next');
  const dest = next && next.startsWith('/') && !next.endsWith('.data') ? next : '/dashboard';

  if (intent === 'login') {
    const email = (formData.get('email') as string) ?? '';
    const password = (formData.get('password') as string) ?? '';
    const remember = formData.get('remember') === 'on';
    if (!email || !password) {
      return Response.json({ intent, error: 'auth_enter_both' }, { status: 400 });
    }
    let result: { accountId: string } | null;
    try {
      result = await login(db, email, password);
    } catch (err) {
      console.error('[auth] login.threw', {
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      return Response.json({ intent, error: 'auth_wrong_creds' }, { status: 400 });
    }
    if (!result) {
      return Response.json({ intent, error: 'auth_wrong_creds' }, { status: 400 });
    }
    const token = await createSession(db, result.accountId, remember);
    const cookieOpts = remember ? { maxAge: 30 * 24 * 3600 } : undefined;
    const cookieHeader = await sessionCookie.serialize(token, cookieOpts);
    return redirect(dest, { headers: { 'Set-Cookie': cookieHeader } });
  }

  if (intent === 'redeem-check') {
    const code = (formData.get('code') as string) ?? '';
    const norm = code.trim().toUpperCase().replace(/[-\s]/g, '');
    const allInvites = await invitesSvc.list(db);
    const invite = allInvites.find(
      (i) => i.code.replace('-', '').toUpperCase() === norm && !i.used,
    );
    if (!invite) {
      return Response.json({ intent, error: 'auth_invite_invalid' }, { status: 400 });
    }
    return Response.json({ intent, invite });
  }

  if (intent === 'redeem') {
    const code = (formData.get('code') as string) ?? '';
    const name = (formData.get('name') as string) ?? '';
    const email = (formData.get('email') as string) ?? '';
    const password = (formData.get('password') as string) ?? '';
    if (!name || !password) {
      return Response.json({ intent, error: 'auth_add_name_pw' }, { status: 400 });
    }
    const result = await redeemInvite(db, code, { name, email, password });
    if (!result) {
      return Response.json({ intent, error: 'auth_invite_invalid' }, { status: 400 });
    }
    const token = await createSession(db, result.accountId, true);
    const cookieHeader = await sessionCookie.serialize(token, { maxAge: 30 * 24 * 3600 });
    return redirect(dest, { headers: { 'Set-Cookie': cookieHeader } });
  }

  if (intent === 'request-reset') {
    const email = (formData.get('email') as string) ?? '';
    if (!email) {
      return Response.json({ intent, error: 'auth_enter_email' }, { status: 400 });
    }
    const result = await requestReset(db, email);
    return Response.json({ intent, sent: true, email, devUrl: result.devUrl ?? null });
  }

  if (intent === 'reset') {
    const token = (formData.get('token') as string) ?? '';
    const password = (formData.get('password') as string) ?? '';
    if (!password) {
      return Response.json({ intent, error: 'auth_add_name_pw' }, { status: 400 });
    }
    const ok = await resetPassword(db, token, password);
    if (!ok) {
      return Response.json({ intent, error: 'auth_invite_invalid' }, { status: 400 });
    }
    return redirect('/login?reset=done');
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

// ---- UI helpers ----

function AuthField({
  icon,
  ...props
}: { icon: IconName } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="auth-field">
      <MIcon name={icon} size={18} className="auth-field__icon" />
      <input className="mochi-input auth-input" {...props} />
    </div>
  );
}

// ---- Default export ----

export default function Login() {
  const {
    next,
    mode: urlMode,
    resetToken,
    resetDone,
    hasOpenInvite,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useLang();
  const checkFetcher = useFetcher<typeof action>();

  const initialMode = urlMode === 'reset' && resetToken ? 'reset' : 'login';
  const [mode, setMode] = React.useState<string>(initialMode);
  const [remember, setRemember] = React.useState(true);
  const [showPw, setShowPw] = React.useState(false);
  const [codeValue, setCodeValue] = React.useState('');

  // When redeem-check fetcher succeeds, advance to onboarding form.
  const checkData = checkFetcher.data as
    { intent?: string; invite?: InviteRow; error?: string } | undefined;
  const checkedInvite =
    checkData?.intent === 'redeem-check' && checkData?.invite ? checkData.invite : null;

  React.useEffect(() => {
    if (checkedInvite) setMode('code-check');
  }, [checkedInvite]);

  const roleLabel = (r: string) => t('role_' + String(r || '').toLowerCase());

  const navError =
    actionData && typeof actionData === 'object' && 'error' in actionData
      ? t((actionData as { error: string }).error)
      : null;
  const checkError = checkData?.error ? t(checkData.error) : null;

  const sentData =
    actionData &&
    typeof actionData === 'object' &&
    'sent' in actionData &&
    (actionData as { sent: boolean }).sent
      ? (actionData as { sent: boolean; email: string; devUrl: string | null })
      : null;

  const nextInput = next ? <input type="hidden" name="next" value={next} /> : null;

  const Brand = (
    <div className="auth-brand">
      <div className="auth-brand__mark">
        <MIcon name="paw" size={30} />
      </div>
      <div className="auth-brand__name">Mochi</div>
      <p className="auth-brand__tag">{t('auth_tagline')}</p>
      <div className="auth-brand__chips">
        <LTag color="green">{t('chip_classes')}</LTag>
        <LTag color="blue">{t('chip_calendar')}</LTag>
        <LTag color="violet">{t('chip_materials')}</LTag>
        <LTag color="orange">{t('chip_tests')}</LTag>
      </div>
      <div className="auth-brand__paws">
        <MIcon name="paw" size={16} />
        <MIcon name="paw" size={22} />
        <MIcon name="paw" size={16} />
      </div>
    </div>
  );

  let form: React.ReactNode;

  if (mode === 'login') {
    form = (
      <Form method="post">
        {nextInput}
        <input type="hidden" name="intent" value="login" />
        <h2 className="auth-title">{t('auth_welcome')}</h2>
        <p className="auth-sub">{t('auth_welcome_sub')}</p>
        {resetDone && (
          <div className="auth-hint-code" style={{ marginBottom: 12 }}>
            {t('auth_reset_sub_sent')}
          </div>
        )}
        <AuthField
          icon="mail"
          type="email"
          name="email"
          placeholder="you@school.edu"
          autoComplete="email"
        />
        <div className="auth-field">
          <MIcon name="lock" size={18} className="auth-field__icon" />
          <input
            className="mochi-input auth-input"
            type={showPw ? 'text' : 'password'}
            name="password"
            placeholder={t('auth_password')}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="auth-field__eye"
            onClick={() => setShowPw((s) => !s)}
            aria-label="Toggle password"
          >
            <MIcon name={showPw ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
        {navError && <div className="auth-error">{navError}</div>}
        <div className="auth-row">
          <LSw
            checked={remember}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemember(e.target.checked)}
            label={t('auth_remember')}
            name="remember"
            value="on"
          />
        </div>
        <LBtn type="submit" variant="primary" block={true}>
          {t('auth_signin')}
        </LBtn>
        <p className="auth-foot">
          <button type="button" className="auth-link" onClick={() => setMode('forgot')}>
            {t('auth_forgot')}
          </button>
        </p>
        <div className="auth-divider">
          <span>{t('auth_or')}</span>
        </div>
        <LBtn
          type="button"
          variant="secondary"
          block={true}
          onClick={() => setMode('code')}
          iconLeft={<MIcon name="key" size={18} />}
        >
          {t('auth_have_code')}
        </LBtn>
      </Form>
    );
  } else if (mode === 'code') {
    form = (
      <>
        <h2 className="auth-title">{t('auth_invite_title')}</h2>
        <p className="auth-sub">{t('auth_invite_sub')}</p>
        <input
          className="mochi-input auth-code"
          placeholder="ABC-123"
          value={codeValue}
          maxLength={7}
          onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const fd = new FormData();
              fd.set('intent', 'redeem-check');
              fd.set('code', codeValue);
              checkFetcher.submit(fd, { method: 'post' });
            }
          }}
        />
        {checkError && <div className="auth-error">{checkError}</div>}
        {hasOpenInvite && (
          <div className="auth-hint-code">
            {t('auth_demo_code')} <span className="m-mono">{MASKED_INVITE_CODE}</span>
          </div>
        )}
        <LBtn
          variant="primary"
          block={true}
          onClick={() => {
            const fd = new FormData();
            fd.set('intent', 'redeem-check');
            fd.set('code', codeValue);
            checkFetcher.submit(fd, { method: 'post' });
          }}
        >
          {t('auth_continue')}
        </LBtn>
        <p className="auth-foot">
          <button
            className="auth-link"
            type="button"
            onClick={() => {
              setMode('login');
              setCodeValue('');
            }}
          >
            {t('auth_back_signin')}
          </button>
        </p>
      </>
    );
  } else if (mode === 'code-check' && checkedInvite) {
    form = (
      <Form method="post">
        {nextInput}
        <input type="hidden" name="intent" value="redeem" />
        <input type="hidden" name="code" value={codeValue} />
        <h2 className="auth-title">{t('auth_invited_title')}</h2>
        <p className="auth-sub">
          {t('auth_joining_as')} <strong>{roleLabel(checkedInvite.role).toLowerCase()}</strong>
          {checkedInvite.name ? ` · ${checkedInvite.name}` : ''}
        </p>
        <AuthField icon="users" name="name" placeholder={t('auth_your_name')} />
        <AuthField icon="mail" type="email" name="email" placeholder={t('auth_email_optional')} />
        <AuthField icon="lock" type="password" name="password" placeholder={t('auth_choose_pw')} />
        {navError && <div className="auth-error">{navError}</div>}
        <LBtn type="submit" variant="primary" block={true}>
          {t('auth_join')}
        </LBtn>
      </Form>
    );
  } else if (mode === 'forgot') {
    if (sentData) {
      form = (
        <>
          <h2 className="auth-title">{t('auth_reset_title')}</h2>
          <p className="auth-sub">{t('auth_reset_sub_sent')}</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {t('auth_sent_to')} <strong>{sentData.email}</strong>
          </p>
          {sentData.devUrl && (
            <p
              style={{
                fontSize: 'var(--text-sm)',
                background: 'var(--surface-subtle)',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                wordBreak: 'break-all',
              }}
            >
              <strong>[dev]</strong>{' '}
              <a href={sentData.devUrl} style={{ color: 'var(--brand)' }}>
                {sentData.devUrl}
              </a>
            </p>
          )}
          <p className="auth-foot">
            <button className="auth-link" type="button" onClick={() => setMode('login')}>
              {t('auth_back_signin')}
            </button>
          </p>
        </>
      );
    } else {
      form = (
        <Form method="post">
          <input type="hidden" name="intent" value="request-reset" />
          <h2 className="auth-title">{t('auth_reset_title')}</h2>
          <p className="auth-sub">{t('auth_reset_sub')}</p>
          <AuthField
            icon="mail"
            type="email"
            name="email"
            placeholder="you@school.edu"
            autoComplete="email"
          />
          {navError && <div className="auth-error">{navError}</div>}
          <LBtn type="submit" variant="primary" block={true}>
            {t('auth_send_reset')}
          </LBtn>
          <p className="auth-foot">
            <button className="auth-link" type="button" onClick={() => setMode('login')}>
              {t('auth_back_signin')}
            </button>
          </p>
        </Form>
      );
    }
  } else if (mode === 'reset') {
    form = (
      <Form method="post">
        <input type="hidden" name="intent" value="reset" />
        <input type="hidden" name="token" value={resetToken ?? ''} />
        <h2 className="auth-title">{t('auth_reset_title')}</h2>
        <p className="auth-sub">{t('auth_choose_pw')}</p>
        <AuthField
          icon="lock"
          type="password"
          name="password"
          placeholder={t('auth_choose_pw')}
          autoComplete="new-password"
        />
        {navError && <div className="auth-error">{navError}</div>}
        <LBtn type="submit" variant="primary" block={true}>
          {t('auth_send_reset')}
        </LBtn>
      </Form>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-card__brand">{Brand}</div>
        <div className="auth-card__form">{form}</div>
      </div>
    </div>
  );
}
