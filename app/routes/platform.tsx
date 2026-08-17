import { Form, useLoaderData } from 'react-router';
import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { DS } from '../../src/ds/index.js';
import { useLang } from '../../src/lib/i18n.jsx';
// tenant-unscoped by design: this page exists to look ACROSS schools. It is the only surface
// that does, which is why `requirePlatformAdmin` guards every entry point below.
import { createRawDb } from '../../server/db/internal';
import { cloudflareCtx } from '../../app/load-context';
import { requirePlatformAdmin } from '../../server/services/auth';
import { hashToken } from '../../server/services/crypto';
import { sessionCookie } from '../../server/session';
import {
  listTenantsWithCounts,
  setActiveTenant,
  setTenantStatus,
  setTenantVerified,
} from '../../server/services/tenants';

const { Button: PBtn, Tag: PTag } = DS;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requirePlatformAdmin(request, env);
  const db = createRawDb(env);
  return {
    tenants: await listTenantsWithCounts(db),
    activeTenantId: user.tenantId,
    homeTenantId: user.homeTenantId,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requirePlatformAdmin(request, env);
  const db = createRawDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = (formData.get('id') as string) ?? '';

  if (intent === 'enter-tenant' || intent === 'exit-tenant') {
    // The override is written on THIS session row, so entering a school on the laptop leaves
    // the phone where it was. `setActiveTenant` re-checks the platform-admin flag itself.
    const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
    if (typeof rawToken !== 'string') return Response.json({ error: 'forbidden' }, { status: 403 });
    const tokenHash = await hashToken(rawToken);
    const target = intent === 'enter-tenant' ? id : null;
    await setActiveTenant(db, tokenHash, user.account.id, target);
    return Response.json({ ok: true });
  }

  if (intent === 'suspend' || intent === 'unsuspend') {
    await setTenantStatus(db, id, intent === 'suspend' ? 'suspended' : 'active');
    return Response.json({ ok: true });
  }

  if (intent === 'verify' || intent === 'unverify') {
    await setTenantVerified(db, id, intent === 'verify');
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'unknown_intent' }, { status: 400 });
}

export default function Platform() {
  const { tenants, activeTenantId, homeTenantId } = useLoaderData<typeof loader>();
  const { t } = useLang();

  return (
    <div className="platform">
      <header className="platform__head">
        <h1>{t('platform_title')}</h1>
        <p className="platform__sub">{t('platform_sub')}</p>
      </header>

      <div className="platform__table-wrap">
        <table className="platform__table">
          <thead>
            <tr>
              <th>{t('platform_school')}</th>
              <th>{t('platform_created')}</th>
              <th>{t('platform_people')}</th>
              <th>{t('platform_status')}</th>
              {/* Actions column: the buttons name themselves, so a visible header would only
                  repeat them — but screen readers still need the column to have one. */}
              <th>
                <span className="sr-only">{t('platform_enter')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tn) => {
              const suspended = tn.status === 'suspended';
              const inside = tn.id === activeTenantId && tn.id !== homeTenantId;
              return (
                <tr key={tn.id}>
                  <td>
                    <strong>{tn.name}</strong>
                    <div className="platform__meta">{tn.slug}</div>
                  </td>
                  <td>{tn.createdAt.slice(0, 10)}</td>
                  <td>
                    {tn.staffCount + tn.studentCount}
                    <div className="platform__meta">{tn.classCount} lớp</div>
                  </td>
                  <td>
                    {suspended ? (
                      <PTag color="red">{t('platform_suspended')}</PTag>
                    ) : tn.verified ? (
                      <PTag color="green">{t('platform_verified')}</PTag>
                    ) : (
                      <PTag color="orange">{t('platform_unverified')}</PTag>
                    )}
                  </td>
                  <td>
                    <div className="platform__actions">
                      {!inside && tn.id !== homeTenantId && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="enter-tenant" />
                          <input type="hidden" name="id" value={tn.id} />
                          <PBtn type="submit" size="sm">
                            {t('platform_enter')}
                          </PBtn>
                        </Form>
                      )}
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={tn.verified ? 'unverify' : 'verify'}
                        />
                        <input type="hidden" name="id" value={tn.id} />
                        <PBtn type="submit" size="sm" variant="ghost">
                          {tn.verified ? t('platform_unverify') : t('platform_verify')}
                        </PBtn>
                      </Form>
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={suspended ? 'unsuspend' : 'suspend'}
                        />
                        <input type="hidden" name="id" value={tn.id} />
                        <PBtn type="submit" size="sm" variant="ghost">
                          {suspended ? t('platform_unsuspend') : t('platform_suspend')}
                        </PBtn>
                      </Form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
