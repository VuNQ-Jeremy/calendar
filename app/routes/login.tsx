import React from 'react';
import { redirect, useFetcher } from 'react-router';
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { Form, useLoaderData, useActionData } from 'react-router';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import type { IconName } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { tenantDbFor } from '../../server/db';
import { createRawDb } from '../../server/db/internal';
import { cloudflareCtx } from '../../app/load-context';
import * as invitesSvc from '../../server/services/invites';
import { NewPassword } from '../../shared/schemas';
import {
  allow,
  loginKey,
  inviteKey,
  otpRequestKey,
  otpPhoneKey,
  otpVerifyKey,
  LOGIN_POLICY,
  INVITE_POLICY,
  OTP_REQUEST_POLICY,
  OTP_PHONE_POLICY,
  OTP_VERIFY_POLICY,
} from '../../server/services/rate-limit';
import {
  getUser,
  login,
  createSession,
  redeemInvite,
  findOpenInvite,
  homeFor,
  safeNextPath,
  requestReset,
  resetPassword,
} from '../../server/services/auth';
import {
  requestLoginCode,
  verifyLoginCode,
  pickAccount,
  setPasswordViaOtp,
} from '../../server/services/login-otp';
import { normalizePhone } from '../../shared/logic/phone';
import { googleEnabled } from '../../server/services/google-auth';
import { sessionCookie } from '../../server/session';
import { clearCache } from '../../src/lib/cache.js';
import { isAppHost, appUrl } from '../../server/origin';

const { Button: LBtn, Switch: LSw, Tag: LTag } = DS;

// ---- Loader ----

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  // Cookies are host-only: a session minted on the marketing apex would be
  // invisible to the app. Once the split is on (APP_ORIGIN set), auth lives
  // on the app host only — bounce there, preserving the query string.
  if (!isAppHost(request, env)) {
    const url = new URL(request.url);
    return redirect(appUrl(env, url.pathname + url.search));
  }
  const user = await getUser(request, env);
  if (user) return redirect(homeFor(user.kind));
  const url = new URL(request.url);
  // Deliberately says NOTHING about whether an invite is outstanding. This page is
  // unauthenticated, and "a live code exists right now" is exactly the signal that makes
  // brute-forcing the redeem check worth an attacker's time.
  return {
    next: url.searchParams.get('next'),
    mode: url.searchParams.get('mode'),
    resetToken: url.searchParams.get('token'),
    resetDone: url.searchParams.get('reset') === 'done',
    googleEnabled: googleEnabled(env),
    // Only ever a fixed set of known codes from our own /auth/google/callback redirect —
    // rendered through i18n `t()`, never interpolated raw.
    googleError: url.searchParams.get('error'),
  };
}

// ---- Action ----

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.get(cloudflareCtx);
  // tenant-unscoped, deliberately: nobody on this route has a session yet. Signing in resolves a
  // school from the account, and redeeming resolves one from the invite code — which is why
  // `invites.code` is globally unique. A scoped handle here would have nothing to scope to.
  const db = createRawDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const url = new URL(request.url);
  const next = url.searchParams.get('next');
  const dest = safeNextPath(next) ?? '/dashboard';

  if (intent === 'login') {
    const email = (formData.get('email') as string) ?? '';
    const password = (formData.get('password') as string) ?? '';
    const remember = formData.get('remember') === 'on';
    if (!email || !password) {
      return Response.json({ intent, error: 'auth_enter_both' }, { status: 400 });
    }
    // Before the PBKDF2 verify, not after: a 100k-iteration derivation is the expensive part,
    // and an unthrottled attacker turning that into CPU burn is half of this endpoint's risk.
    if (!(await allow(env, loginKey(email), LOGIN_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
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

  if (intent === 'otp-request') {
    const phone = (formData.get('phone') as string) ?? '';
    const purpose = formData.get('purpose') === 'set-password' ? 'set-password' : 'login';
    if (!(await allow(env, otpRequestKey(), OTP_REQUEST_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const normalized = normalizePhone(phone);
    // A phone that fails to normalize still burns the per-IP limiter above but has no per-phone
    // key to check — requestLoginCode already answers it with the same decoy shape either way.
    if (normalized && !(await allow(env, otpPhoneKey(normalized), OTP_PHONE_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const result = await requestLoginCode(db, env, phone, purpose, (p) => ctx.waitUntil(p));
    return Response.json({
      intent,
      challengeId: result.challengeId,
      devCode: result.devCode ?? null,
    });
  }

  if (intent === 'otp-verify') {
    const challengeId = (formData.get('challengeId') as string) ?? '';
    const code = (formData.get('code') as string) ?? '';
    if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const outcome = await verifyLoginCode(db, challengeId, code);
    if (!outcome.ok) {
      return Response.json({ intent, error: 'auth_otp_invalid' }, { status: 400 });
    }
    if ('pick' in outcome) {
      return Response.json({ intent, pick: outcome.pick });
    }
    const cookieHeader = await sessionCookie.serialize(outcome.session.token, {
      maxAge: 30 * 24 * 3600,
    });
    return redirect(dest, { headers: { 'Set-Cookie': cookieHeader } });
  }

  if (intent === 'otp-pick') {
    const challengeId = (formData.get('challengeId') as string) ?? '';
    const accountId = (formData.get('accountId') as string) ?? '';
    if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const outcome = await pickAccount(db, challengeId, accountId);
    if (!outcome.ok) {
      return Response.json({ intent, error: 'auth_otp_invalid' }, { status: 400 });
    }
    const cookieHeader = await sessionCookie.serialize(outcome.session.token, {
      maxAge: 30 * 24 * 3600,
    });
    return redirect(dest, { headers: { 'Set-Cookie': cookieHeader } });
  }

  if (intent === 'otp-set-password') {
    const challengeId = (formData.get('challengeId') as string) ?? '';
    const accountId = (formData.get('accountId') as string) ?? '';
    const newPassword = (formData.get('newPassword') as string) ?? '';
    if (!(await allow(env, otpVerifyKey(), OTP_VERIFY_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    if (!NewPassword.safeParse(newPassword).success) {
      return Response.json({ intent, error: 'auth_password_too_short' }, { status: 400 });
    }
    const outcome = await setPasswordViaOtp(db, challengeId, accountId, newPassword);
    if (outcome !== 'ok') {
      return Response.json({ intent, error: 'auth_otp_invalid' }, { status: 400 });
    }
    return Response.json({ intent, ok: true });
  }

  if (intent === 'redeem-check') {
    const code = (formData.get('code') as string) ?? '';
    if (!(await allow(env, inviteKey(), INVITE_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const invite = await findOpenInvite(db, code);
    if (!invite) {
      return Response.json({ intent, error: 'auth_invite_invalid' }, { status: 400 });
    }
    // Only the three fields the form renders. This response goes to an anonymous visitor,
    // so the invite row itself — ids, the class it links to — stays on the server.
    const linkedId = invite.studentId ?? invite.staffId ?? invite.parentId;
    // The code has now selected a school, so the name lookup runs scoped to THAT school rather
    // than against the whole table.
    const personName = await invitesSvc.linkedPersonName(tenantDbFor(env, invite), invite);
    return Response.json({
      intent,
      invite: { role: invite.role, name: personName ?? invite.name ?? null, linked: !!linkedId },
    });
  }

  if (intent === 'redeem') {
    const code = (formData.get('code') as string) ?? '';
    const name = (formData.get('name') as string) ?? '';
    const email = (formData.get('email') as string) ?? '';
    const password = (formData.get('password') as string) || undefined;
    const phone = (formData.get('phone') as string) || undefined;
    if (!(await allow(env, inviteKey(), INVITE_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    if (!name || (!password && !phone)) {
      return Response.json({ intent, error: 'auth_add_name_pw' }, { status: 400 });
    }
    // The browser path used to skip RedeemInviteInput entirely, so a one-character password
    // was accepted here while the mobile API refused it. Same rule, both clients.
    if (password && !NewPassword.safeParse(password).success) {
      return Response.json({ intent, error: 'auth_password_too_short' }, { status: 400 });
    }
    const result = await redeemInvite(db, code, { name, email, password, phone });
    if (result === 'no_login_method') {
      return Response.json({ intent, error: 'auth_no_login_method' }, { status: 400 });
    }
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
    // Unauthenticated and it INSERTS a password_resets row per call — throttled for the D1
    // write as much as for the enumeration.
    if (!(await allow(env, loginKey(email), LOGIN_POLICY))) {
      return Response.json({ intent, error: 'auth_rate_limited' }, { status: 429 });
    }
    const result = await requestReset(db, email, env, url.origin);
    return Response.json({ intent, sent: true, email, devUrl: result.devUrl ?? null });
  }

  if (intent === 'reset') {
    const token = (formData.get('token') as string) ?? '';
    const password = (formData.get('password') as string) ?? '';
    if (!password) {
      return Response.json({ intent, error: 'auth_add_name_pw' }, { status: 400 });
    }
    if (!NewPassword.safeParse(password).success) {
      return Response.json({ intent, error: 'auth_password_too_short' }, { status: 400 });
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

/**
 * Signing in starts from an empty client cache.
 *
 * `src/lib/cache.ts` is module state, so it survives a client-side navigation — and /login is
 * reachable WITHOUT a logout: an expired session bounced here, or the invite "Join Mochi" form
 * further down this same route. Since the calendar theme and the UI prefs became per account
 * (migration 0043), a surviving `route:calendar` entry would paint the previous account's
 * colours until something happened to invalidate it.
 *
 * Exactly the shape logout.tsx already uses, including returning `serverAction()` verbatim so
 * the redirect and its Set-Cookie header pass straight through.
 */
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  clearCache();
  return serverAction();
}

// ---- Default export ----

/** One account an OTP phone number resolved to — the picker's own choice list. */
type OtpCandidateLite = {
  accountId: string;
  name: string;
  kind: string;
  schoolName: string;
};

type OtpFetcherData =
  | { intent: 'otp-request'; challengeId: string; devCode: string | null }
  | { intent: 'otp-verify'; pick: OtpCandidateLite[] }
  | { intent: 'otp-set-password'; ok: true }
  | { intent: 'otp-request' | 'otp-verify' | 'otp-pick' | 'otp-set-password'; error: string };

export default function Login() {
  const {
    next,
    mode: urlMode,
    resetToken,
    resetDone,
    googleEnabled: showGoogle,
    googleError,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useLang();
  const checkFetcher = useFetcher<typeof action>();
  const otpFetcher = useFetcher<typeof action>();

  // Zalo (phone + code) is the default landing screen — the audience this app serves most is
  // Zalo-native. A reset link from an email always lands on the Email tab, since that is the
  // flow the visitor was already in.
  const initialMode =
    urlMode === 'reset' && resetToken ? 'reset' : resetDone ? 'login' : 'otp-phone';
  const [mode, setMode] = React.useState<string>(initialMode);
  const [remember, setRemember] = React.useState(true);
  const [showPw, setShowPw] = React.useState(false);
  const [codeValue, setCodeValue] = React.useState('');
  const [passwordless, setPasswordless] = React.useState(false);
  const [otpPhone, setOtpPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [otpChallengeId, setOtpChallengeId] = React.useState<string | null>(null);
  const [otpDevCode, setOtpDevCode] = React.useState<string | null>(null);
  const [otpPick, setOtpPick] = React.useState<OtpCandidateLite[]>([]);
  const [resendSeconds, setResendSeconds] = React.useState(0);
  // 'set-password' is the Zalo forgot-password path off the 'forgot' screen — it reuses every
  // otp-phone/otp-code/otp-pick screen above, and only the picker's action and the final step
  // (setting a new password instead of signing in) differ.
  const [otpPurpose, setOtpPurpose] = React.useState<'login' | 'set-password'>('login');
  const [otpPickedAccountId, setOtpPickedAccountId] = React.useState<string | null>(null);
  const [otpNewPassword, setOtpNewPassword] = React.useState('');
  const [otpNewPasswordConfirm, setOtpNewPasswordConfirm] = React.useState('');
  const [otpPasswordSet, setOtpPasswordSet] = React.useState(false);

  // Fetcher submissions carry `next` explicitly: unlike a real <Form>, they do not automatically
  // resubmit to the current URL's query string, and otp-verify/otp-pick need it to redirect
  // correctly on success.
  const loginAction = '/login' + (next ? `?next=${encodeURIComponent(next)}` : '');

  const otpData = otpFetcher.data as OtpFetcherData | undefined;
  const otpError = otpData && 'error' in otpData ? t(otpData.error) : null;

  React.useEffect(() => {
    if (!otpData) return;
    if (otpData.intent === 'otp-request' && 'challengeId' in otpData) {
      setOtpChallengeId(otpData.challengeId);
      setOtpDevCode(otpData.devCode ?? null);
      setOtpCode('');
      setMode('otp-code');
      setResendSeconds(60);
    } else if (otpData.intent === 'otp-verify' && 'pick' in otpData) {
      setOtpPick(otpData.pick);
      setMode('otp-pick');
    } else if (otpData.intent === 'otp-set-password' && 'ok' in otpData) {
      setOtpPasswordSet(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpData]);

  React.useEffect(() => {
    if (resendSeconds <= 0) return;
    const id = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendSeconds]);

  const requestOtp = (phone: string) => {
    const fd = new FormData();
    fd.set('intent', 'otp-request');
    fd.set('phone', phone);
    fd.set('purpose', otpPurpose);
    otpFetcher.submit(fd, { method: 'post', action: loginAction });
  };

  const verifyOtp = () => {
    const fd = new FormData();
    fd.set('intent', 'otp-verify');
    fd.set('challengeId', otpChallengeId ?? '');
    fd.set('code', otpCode);
    otpFetcher.submit(fd, { method: 'post', action: loginAction });
  };

  const pickOtpAccount = (accountId: string) => {
    if (otpPurpose === 'set-password') {
      // Setting a password never signs anyone in — collect it on the next screen instead of
      // spending the challenge here.
      setOtpPickedAccountId(accountId);
      setMode('otp-new-password');
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'otp-pick');
    fd.set('challengeId', otpChallengeId ?? '');
    fd.set('accountId', accountId);
    otpFetcher.submit(fd, { method: 'post', action: loginAction });
  };

  const submitSetPassword = () => {
    const fd = new FormData();
    fd.set('intent', 'otp-set-password');
    fd.set('challengeId', otpChallengeId ?? '');
    fd.set('accountId', otpPickedAccountId ?? '');
    fd.set('newPassword', otpNewPassword);
    otpFetcher.submit(fd, { method: 'post', action: loginAction });
  };

  const zaloTabActive =
    mode === 'otp-phone' ||
    mode === 'otp-code' ||
    mode === 'otp-pick' ||
    mode === 'otp-new-password';
  // Hidden mid-flow for a Zalo password reset — it's off the 'forgot' screen, and the tabs would
  // otherwise offer to abandon it back to a plain sign-in.
  const showTabs = otpPurpose === 'login' && (zaloTabActive || mode === 'login');

  // When redeem-check fetcher succeeds, advance to onboarding form.
  type CheckedInvite = { role: string; name: string | null; linked: boolean };
  const checkData = checkFetcher.data as
    { intent?: string; invite?: CheckedInvite; error?: string } | undefined;
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

  // A fixed, known set of codes from our own /auth/google/callback redirect — never raw text
  // from the query string.
  const googleErrorMsg =
    googleError === 'google_no_account'
      ? t('auth_google_no_account')
      : googleError
        ? t('auth_google_failed')
        : null;

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
        {showGoogle && (
          <>
            {googleErrorMsg && <div className="auth-error">{googleErrorMsg}</div>}
            <a className="mochi-btn is-secondary" style={{ width: '100%' }} href="/auth/google">
              {t('auth_google_signin')}
            </a>
          </>
        )}
        {/*
          The only way into /signup. Deliberately the quietest thing on the page: almost everyone
          arriving here belongs to a school that already exists, and creating a second one by
          mistake is a mess only a platform admin can clean up.
        */}
        <p className="auth-foot">
          <a className="auth-link" href="/signup">
            {t('signup_link')}
          </a>
        </p>
      </Form>
    );
  } else if (mode === 'otp-phone') {
    form = (
      <>
        <h2 className="auth-title">
          {otpPurpose === 'set-password' ? t('auth_reset_title') : t('auth_welcome')}
        </h2>
        <p className="auth-sub">{t('auth_otp_phone_sub')}</p>
        <AuthField
          icon="message"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0901 234 567"
          value={otpPhone}
          onChange={(e) => setOtpPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && otpPhone.trim()) {
              e.preventDefault();
              requestOtp(otpPhone);
            }
          }}
        />
        {otpError && <div className="auth-error">{otpError}</div>}
        <LBtn
          type="button"
          variant="primary"
          block={true}
          disabled={otpFetcher.state !== 'idle' || !otpPhone.trim()}
          onClick={() => requestOtp(otpPhone)}
        >
          {t('auth_otp_send_code')}
        </LBtn>
      </>
    );
  } else if (mode === 'otp-code') {
    form = (
      <>
        <h2 className="auth-title">{t('auth_otp_enter_code')}</h2>
        <p className="auth-sub">{t('auth_otp_code_sent_generic')}</p>
        {otpDevCode && (
          <div className="auth-hint-code" data-testid="otp-dev-code" style={{ marginBottom: 12 }}>
            <strong>[dev]</strong> {otpDevCode}
          </div>
        )}
        <AuthField
          icon="key"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && otpCode.length === 6) {
              e.preventDefault();
              verifyOtp();
            }
          }}
        />
        {otpError && <div className="auth-error">{otpError}</div>}
        <LBtn
          type="button"
          variant="primary"
          block={true}
          disabled={otpFetcher.state !== 'idle' || otpCode.length !== 6}
          onClick={verifyOtp}
        >
          {t('auth_otp_verify')}
        </LBtn>
        <p className="auth-foot">
          <button
            type="button"
            className="auth-link"
            disabled={resendSeconds > 0 || otpFetcher.state !== 'idle'}
            onClick={() => requestOtp(otpPhone)}
          >
            {resendSeconds > 0
              ? t('auth_otp_resend_in', { n: resendSeconds })
              : t('auth_otp_resend')}
          </button>
        </p>
        <p className="auth-foot">
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setMode('otp-phone');
              setOtpCode('');
              setOtpChallengeId(null);
              setOtpDevCode(null);
            }}
          >
            {t('auth_otp_change_number')}
          </button>
        </p>
      </>
    );
  } else if (mode === 'otp-pick') {
    form = (
      <>
        <h2 className="auth-title">{t('auth_otp_pick_title')}</h2>
        {otpError && <div className="auth-error">{otpError}</div>}
        <div className="auth-pick-list">
          {otpPick.map((c) => (
            <button
              key={c.accountId}
              type="button"
              className="auth-pick-item"
              disabled={otpFetcher.state !== 'idle'}
              onClick={() => pickOtpAccount(c.accountId)}
            >
              <MIcon name="users" size={18} />
              <span>
                <strong>{c.name}</strong>
                <br />
                {roleLabel(c.kind)} · {c.schoolName}
              </span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (mode === 'otp-new-password') {
    form = otpPasswordSet ? (
      <>
        <h2 className="auth-title">{t('auth_reset_title')}</h2>
        <div className="auth-success">
          <MIcon name="check" size={18} />
          {t('prof_pw_changed')}
        </div>
        <p className="auth-foot">
          <button
            type="button"
            className="auth-link"
            onClick={() => {
              setOtpPurpose('login');
              setMode('login');
            }}
          >
            {t('auth_back_signin')}
          </button>
        </p>
      </>
    ) : (
      <>
        <h2 className="auth-title">{t('auth_reset_title')}</h2>
        <p className="auth-sub">{t('auth_choose_pw')}</p>
        <AuthField
          icon="lock"
          type="password"
          placeholder={t('auth_choose_pw')}
          autoComplete="new-password"
          value={otpNewPassword}
          onChange={(e) => setOtpNewPassword(e.target.value)}
        />
        <AuthField
          icon="lock"
          type="password"
          placeholder={t('auth_confirm_pw')}
          autoComplete="new-password"
          value={otpNewPasswordConfirm}
          onChange={(e) => setOtpNewPasswordConfirm(e.target.value)}
        />
        {otpNewPassword && otpNewPasswordConfirm && otpNewPassword !== otpNewPasswordConfirm && (
          <div className="auth-error">{t('auth_pw_nomatch')}</div>
        )}
        {otpError && <div className="auth-error">{otpError}</div>}
        <LBtn
          type="button"
          variant="primary"
          block={true}
          disabled={
            otpFetcher.state !== 'idle' ||
            otpNewPassword.length < 8 ||
            otpNewPassword !== otpNewPasswordConfirm
          }
          onClick={submitSetPassword}
        >
          {t('auth_send_reset')}
        </LBtn>
      </>
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
    // Staff never goes passwordless — a teaching/admin account has no OTP entry point.
    const canGoPasswordless = checkedInvite.role !== 'Staff';
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
        {/* A linked code already knows who it belongs to — the school entered the name.
            It still posts (the action requires one) but the server ignores it. */}
        <AuthField
          icon="users"
          name="name"
          placeholder={t('auth_your_name')}
          defaultValue={checkedInvite.name ?? ''}
          readOnly={checkedInvite.linked && !!checkedInvite.name}
        />
        <AuthField icon="mail" type="email" name="email" placeholder={t('auth_email_optional')} />
        {passwordless ? (
          <>
            <AuthField
              icon="message"
              type="tel"
              inputMode="tel"
              name="phone"
              placeholder="0901 234 567"
            />
            <p className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 12 }}>
              {t('auth_redeem_passwordless_hint')}
            </p>
          </>
        ) : (
          <AuthField
            icon="lock"
            type="password"
            name="password"
            placeholder={t('auth_choose_pw')}
          />
        )}
        {canGoPasswordless && (
          <p className="auth-foot" style={{ margin: '0 0 12px' }}>
            <button type="button" className="auth-link" onClick={() => setPasswordless((v) => !v)}>
              {passwordless ? t('auth_redeem_use_password') : t('auth_redeem_use_zalo')}
            </button>
          </p>
        )}
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
            <button
              className="auth-link"
              type="button"
              onClick={() => {
                setOtpPurpose('set-password');
                setOtpPasswordSet(false);
                setMode('otp-phone');
              }}
            >
              {t('auth_reset_via_zalo')}
            </button>
          </p>
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
        <div className="auth-card__form">
          {showTabs && (
            <div className="auth-tabs-wrap">
              <div className="mochi-tabs">
                <button
                  type="button"
                  className={'mochi-tabs__tab' + (zaloTabActive ? ' is-active' : '')}
                  onClick={() => setMode('otp-phone')}
                >
                  {t('auth_tab_zalo')}
                </button>
                <button
                  type="button"
                  className={'mochi-tabs__tab' + (mode === 'login' ? ' is-active' : '')}
                  onClick={() => setMode('login')}
                >
                  {t('auth_tab_email')}
                </button>
              </div>
            </div>
          )}
          {form}
        </div>
      </div>
    </div>
  );
}
