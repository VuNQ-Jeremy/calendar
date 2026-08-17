import React from 'react';
import { redirect } from 'react-router';
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { Form, useActionData } from 'react-router';
import { DS } from '../../src/ds/index.js';
import { MIcon } from '../../src/icons.jsx';
import type { IconName } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
// tenant-unscoped by necessity: this route CREATES the school, so there is nothing to scope to
// until it has. It is one of the few modules the no-restricted-imports rule lets near this.
import { createRawDb } from '../../server/db/internal';
import { cloudflareCtx } from '../../app/load-context';
import { accounts } from '../../server/db/schema';
import { eq } from 'drizzle-orm';
import { NewPassword } from '../../shared/schemas';
import {
  allow,
  signupKey,
  SIGNUP_POLICY,
  SIGNUP_GLOBAL_KEY,
  SIGNUP_GLOBAL_POLICY,
} from '../../server/services/rate-limit';
import { getUser, createSession, homeFor } from '../../server/services/auth';
import { createTenant } from '../../server/services/tenants';
import { sessionCookie } from '../../server/session';
import { clearCache } from '../../src/lib/cache.js';

const { Button: LBtn, Tag: LTag } = DS;

// ---- Loader ----

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await getUser(request, env);
  if (user) return redirect(homeFor(user.kind));
  return {};
}

// ---- Action ----

/**
 * Create a school and sign its first admin straight in.
 *
 * Unlike /login this endpoint may confirm that an email is taken. Login must not — "does this
 * account exist" is the thing an enumeration attack wants — but a signup form that silently
 * refuses a duplicate email is unusable, and the same fact is already obtainable from the reset
 * form's behaviour. The honest error is worth more than the pretence.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const db = createRawDb(env);
  const formData = await request.formData();

  // Hidden field no human ever sees. A bot that fills every input announces itself, and this
  // costs nothing and shows nothing.
  if (formData.get('website')) return redirect('/');

  const schoolName = ((formData.get('schoolName') as string) ?? '').trim();
  const adminName = ((formData.get('name') as string) ?? '').trim();
  const email = ((formData.get('email') as string) ?? '').trim().toLowerCase();
  const password = (formData.get('password') as string) ?? '';

  if (!schoolName || !adminName || !email || !password) {
    return Response.json({ error: 'signup_missing' }, { status: 400 });
  }
  if (!NewPassword.safeParse(password).success) {
    return Response.json({ error: 'signup_password_too_short' }, { status: 400 });
  }

  // Both limits before the PBKDF2 hash, for the same reason login throttles first: a
  // 100k-iteration derivation is the expensive part, and turning it into CPU burn is half of
  // what an unauthenticated endpoint is worth to an attacker. Per-IP stops a script; the global
  // key is the only thing that stops a botnet spreading itself across addresses.
  if (!(await allow(env, signupKey(), SIGNUP_POLICY))) {
    return Response.json({ error: 'signup_rate_limited' }, { status: 429 });
  }
  if (!(await allow(env, SIGNUP_GLOBAL_KEY, SIGNUP_GLOBAL_POLICY))) {
    return Response.json({ error: 'signup_rate_limited' }, { status: 429 });
  }

  // tenant-unscoped: `accounts.email` is globally unique by design — one person, one account,
  // one school — so the "is this taken" question spans the whole platform and cannot be fenced.
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1);
  if (existing.length) {
    return Response.json({ error: 'signup_email_taken' }, { status: 400 });
  }

  let created: { accountId: string };
  try {
    created = await createTenant(db, { schoolName, adminName, email, password });
  } catch (err) {
    console.error('[signup] createTenant.threw', {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'signup_missing' }, { status: 500 });
  }

  // Signed in immediately: there is no email to verify against yet, and a "check your inbox"
  // screen that never resolves would be worse than none.
  const token = await createSession(db, created.accountId, true);
  const cookieHeader = await sessionCookie.serialize(token, { maxAge: 30 * 24 * 3600 });
  return redirect('/dashboard?welcome=1', { headers: { 'Set-Cookie': cookieHeader } });
}

/** Same reason as /login: a new school must not inherit the previous account's cached routes. */
export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  clearCache();
  return serverAction();
}

// ---- View ----

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

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const { t } = useLang();
  const [showPw, setShowPw] = React.useState(false);

  const error =
    actionData && typeof actionData === 'object' && 'error' in actionData
      ? t((actionData as { error: string }).error)
      : null;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-card__brand">
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
        </div>
        <div className="auth-card__form">
          <Form method="post">
            <h2 className="auth-title">{t('signup_title')}</h2>
            <p className="auth-sub">{t('signup_sub')}</p>

            <AuthField
              icon="grad"
              type="text"
              name="schoolName"
              placeholder={t('signup_school_name')}
              autoComplete="organization"
            />
            <AuthField
              icon="users"
              type="text"
              name="name"
              placeholder={t('signup_your_name')}
              autoComplete="name"
            />
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
                autoComplete="new-password"
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

            {/* Honeypot: off-screen rather than display:none, which some bots skip. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
            />

            {error && <div className="auth-error">{error}</div>}

            <LBtn type="submit" variant="primary" block={true}>
              {t('signup_submit')}
            </LBtn>

            <p className="auth-foot">
              {t('signup_have_account')}{' '}
              <a className="auth-link" href="/login">
                {t('signup_sign_in')}
              </a>
            </p>
          </Form>
        </div>
      </div>
    </div>
  );
}
