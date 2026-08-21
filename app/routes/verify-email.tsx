import { Form, useActionData, useLoaderData } from 'react-router';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { createRawDb } from '../../server/db/internal';
import { cloudflareCtx } from '../../app/load-context';
import { verifyEmail } from '../../server/services/auth';

/**
 * The landing page for a "Xác minh email" link (app/routes/profile.tsx's `send-verify-email`
 * intent). GET only ever shows a confirm button — clicking a link, or a scanner prefetching it,
 * must never consume the token; the POST is what actually calls `verifyEmail`.
 *
 * Unauthenticated on purpose: the visitor may be opening this link on a different device or
 * browser than the one they are signed into, and the token itself is the proof of ownership.
 */

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return { token: url.searchParams.get('token') };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const formData = await request.formData();
  const token = (formData.get('token') as string) ?? '';
  if (!token) return { ok: false };
  const ok = await verifyEmail(createRawDb(env), token);
  return { ok };
}

export default function VerifyEmail() {
  const { token } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { t } = useLang();

  let body;
  if (!token) {
    body = <p className="auth-sub">{t('verify_email_missing')}</p>;
  } else if (actionData?.ok) {
    body = (
      <div className="auth-success">
        <MIcon name="check" size={18} />
        {t('verify_email_done')}
      </div>
    );
  } else {
    body = (
      <Form method="post">
        <input type="hidden" name="token" value={token} />
        <p className="auth-sub">{t('verify_email_confirm')}</p>
        {actionData && !actionData.ok && (
          <div className="auth-error">{t('verify_email_invalid')}</div>
        )}
        <button type="submit" className="mochi-btn is-primary" style={{ width: '100%' }}>
          {t('verify_email_button')}
        </button>
      </Form>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-card__form" style={{ gridColumn: '1 / -1' }}>
          <h2 className="auth-title">{t('verify_email_title')}</h2>
          {body}
        </div>
      </div>
    </div>
  );
}
