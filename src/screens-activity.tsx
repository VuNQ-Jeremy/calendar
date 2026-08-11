import React from 'react';
import { useLoaderData, useSearchParams, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import type { IconName } from './icons.jsx';
import { PageHeader, Empty, MSelect } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { fmtStamp } from './lib/core.js';
import { locale } from '../shared/i18n/strings.js';
import { LogsTabs } from './screens-logs.jsx';
import { diffKeys } from '../shared/logic/audit-diff.js';
import type { ActivityRow, SecurityOverview } from '../server/services/audit-views.js';

/** Mirrors the union in app/routes/logs.activity.tsx — screens type their own loader data
 *  locally rather than importing from a route module (see screens-logs.tsx's LoaderData). */
type ActivityView = 'stream' | 'sessions' | 'entity' | 'security';

/**
 * /logs → Activity: the append-only mutation/view/auth log. Strictly view-only — no revert, no
 * restore, no action anywhere on this screen (see the route file's header comment).
 *
 * Four views, one loader shape per view (see logs.activity.tsx). Filters are `useSearchParams`
 * navigation rather than local state, same idiom as `src/tuition/fee-slip.tsx` — safe here
 * specifically because this route is never cached, unlike the rest of the app's filtered pages.
 */

const { Card: LCard, Badge, Tag, Button: ABtn } = DS;

/** Deep-linkable palette hexes so a diff/tag reads the same regardless of theme. */
const DANGER = colorOf('rose');

const ALL = 'all';

type LoaderData =
  | { view: 'stream'; accounts: AccountOption[]; filter: StreamFilter; stream: ActivityPage }
  | {
      view: 'sessions';
      accounts: AccountOption[];
      accountId: string;
      session: ActivityPage;
    }
  | {
      view: 'entity';
      accounts: AccountOption[];
      entityType: string;
      entityId: string;
      history: ActivityRow[];
    }
  | { view: 'security'; accounts: AccountOption[]; security: SecurityOverview };

type AccountOption = { id: string; label: string };
type ActivityPage = { rows: ActivityRow[]; nextCursor: number | null };
type StreamFilter = {
  actorKind?: string;
  accountId?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  beforeId?: number;
  limit?: number;
};

/** Icon + colour per action, same shape/idiom as MAT_TYPES (src/lib/mat-types.ts). */
const ACTION_META: Record<string, { icon: IconName; tk: string; color: string }> = {
  create: { icon: 'plus', tk: 'act_create', color: 'green' },
  update: { icon: 'edit', tk: 'act_update', color: 'blue' },
  delete: { icon: 'trash', tk: 'act_delete', color: 'rose' },
  mutation: { icon: 'settings', tk: 'act_mutation', color: 'cocoa' },
  view: { icon: 'eye', tk: 'act_view', color: 'violet' },
  login: { icon: 'key', tk: 'act_login', color: 'green' },
  login_failed: { icon: 'lock', tk: 'act_login_failed', color: 'rose' },
  logout: { icon: 'logout', tk: 'act_logout', color: 'cocoa' },
  password_change: { icon: 'lock', tk: 'act_password_change', color: 'orange' },
  password_reset: { icon: 'lock', tk: 'act_password_reset', color: 'orange' },
  invite_redeem: { icon: 'mail', tk: 'act_invite_redeem', color: 'green' },
};
function actionMeta(action: string) {
  return ACTION_META[action] ?? ACTION_META.mutation;
}

const ACTOR_KINDS = ['staff', 'student', 'parent', 'system', 'anon'] as const;
const ENTITY_TYPES = [
  'student',
  'staff',
  'parent',
  'invite',
  'event',
  'class',
  'material',
  'assessment',
  'test',
  'question',
  'flashcard',
  'garden',
  'tuition',
  'setting',
  'feedback',
  'zalo_link',
  'subject',
  'grade_level',
  'class_level',
  'assessment_type',
  'remark_criterion',
] as const;

/** Renders browser-local time zone — ICT for this school's users, since nobody has a reason to
 *  view this from abroad, but worth naming: this is the one clock in the app that is NOT the
 *  server's. */
function Stamp({ value }: { value: string }) {
  const { lang } = useLang();
  return <span>{fmtStamp(value, locale(lang))}</span>;
}

function ActorCell({ row }: { row: Pick<ActivityRow, 'actorKind' | 'actorName' | 'actorId'> }) {
  const { t } = useLang();
  const color =
    row.actorKind === 'staff'
      ? 'blue'
      : row.actorKind === 'student'
        ? 'green'
        : row.actorKind === 'parent'
          ? 'violet'
          : row.actorKind === 'system'
            ? 'cocoa'
            : null;
  return (
    <span className="m-row" style={{ gap: 6, alignItems: 'center', minWidth: 160 }}>
      <Tag color={color} dot={false}>
        {t(`logs_activity_kind_${row.actorKind}`)}
      </Tag>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {row.actorName ?? row.actorId ?? '—'}
      </span>
    </span>
  );
}

function ActionTag({ action }: { action: string }) {
  const meta = actionMeta(action);
  const { t } = useLang();
  return (
    <Tag color={meta.color} dot={false}>
      <span className="m-row" style={{ gap: 4, alignItems: 'center' }}>
        <MIcon name={meta.icon} size={12} />
        {t(meta.tk)}
      </span>
    </Tag>
  );
}

/** `{key,before,after,changed}` rows as a two-column grid; unchanged rows dimmed. */
function DiffTable({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useLang();
  if (isTruncated(before) || isTruncated(after)) {
    return (
      <p className="m-muted" style={{ margin: 0 }}>
        {t('logs_activity_truncated_note')}
      </p>
    );
  }
  const rows = diffKeys(before, after);
  if (!rows.length)
    return (
      <p className="m-muted" style={{ margin: 0 }}>
        {t('logs_activity_no_snapshot')}
      </p>
    );
  return (
    <div className="m-grid cols-2" style={{ gap: '2px 16px', fontSize: 'var(--text-sm)' }}>
      {rows.map((r) => (
        <React.Fragment key={r.key}>
          <div style={{ opacity: r.changed ? 1 : 0.55 }}>
            <span className="m-mono" style={{ fontWeight: 600 }}>
              {r.key}
            </span>
            {': '}
            <span
              style={{
                textDecoration: r.changed && r.before !== undefined ? 'line-through' : 'none',
              }}
            >
              {stringify(r.before)}
            </span>
          </div>
          <div style={{ opacity: r.changed ? 1 : 0.55, fontWeight: r.changed ? 600 : 400 }}>
            {stringify(r.after)}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function isTruncated(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as Record<string, unknown>).__truncated === true;
}
function stringify(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** One activity row, expandable to its raw JSON (before/after/meta) via a native <details>. */
function ActivityRowView({
  row,
  onOpenEntity,
}: {
  row: ActivityRow;
  onOpenEntity?: (entityType: string, entityId: string) => void;
}) {
  const { t } = useLang();
  const hasDetail = row.before != null || row.after != null || row.meta != null;
  return (
    <details style={{ borderBottom: '1px solid var(--line, #e7e0d6)' }}>
      <summary
        className="m-row"
        style={{
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '8px 0',
          cursor: 'pointer',
          listStyle: 'none',
        }}
      >
        <span style={{ minWidth: 150, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <Stamp value={row.recordedAt} />
        </span>
        <ActorCell row={row} />
        <ActionTag action={row.action} />
        {row.entityType && (
          <button
            type="button"
            style={{
              minWidth: 140,
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--brand)',
              padding: 0,
              font: 'inherit',
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenEntity?.(row.entityType!, row.entityId ?? '');
            }}
          >
            {row.entityType}
            {row.entityId ? `:${row.entityId.slice(0, 8)}` : ''}
          </button>
        )}
        <span className="m-muted" style={{ flex: 1, minWidth: 120, fontSize: 12 }}>
          {row.route}
          {row.intent ? ` · ${row.intent}` : ''}
        </span>
        {row.status != null && row.status >= 400 && (
          <span style={{ color: DANGER.ink, fontSize: 12, fontWeight: 600 }}>{row.status}</span>
        )}
      </summary>
      {hasDetail && (
        <div style={{ padding: '4px 0 12px 24px' }}>
          {(row.before != null || row.after != null) && (
            <DiffTable before={row.before} after={row.after} />
          )}
          {row.meta != null && (
            <p
              className="m-mono m-muted"
              style={{ margin: '6px 0 0', fontSize: 12, wordBreak: 'break-word' }}
            >
              {t('logs_activity_meta')}: {stringify(row.meta)}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

function ViewSwitcher({ current }: { current: ActivityView }) {
  const [, setSearchParams] = useSearchParams();
  const { t } = useLang();
  const go = (view: ActivityView) => {
    setSearchParams({ view }, { replace: true, preventScrollReset: true });
  };
  const items: { id: ActivityView; tk: string; icon: IconName }[] = [
    { id: 'stream', tk: 'logs_activity_view_stream', icon: 'list' },
    { id: 'sessions', tk: 'logs_activity_view_sessions', icon: 'clock' },
    { id: 'entity', tk: 'logs_activity_view_entity', icon: 'search' },
    { id: 'security', tk: 'logs_activity_view_security', icon: 'lock' },
  ];
  return (
    <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {items.map((it) => (
        <ABtn
          key={it.id}
          type="button"
          variant={it.id === current ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => go(it.id)}
          iconLeft={<MIcon name={it.icon} size={14} />}
        >
          {t(it.tk)}
        </ABtn>
      ))}
    </div>
  );
}

export function ActivityScreen() {
  const data = useLoaderData() as LoaderData;
  const { t } = useLang();
  const navigate = useNavigate();

  const openEntity = (entityType: string, entityId: string) => {
    navigate(
      `/logs/activity?view=entity&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    );
  };

  return (
    <div className="content">
      <PageHeader title={t('logs_activity_title')} subtitle={t('logs_activity_subtitle')} />
      <LogsTabs value="activity" />
      <ViewSwitcher current={data.view} />

      {data.view === 'stream' && <StreamView data={data} onOpenEntity={openEntity} />}
      {data.view === 'sessions' && <SessionsView data={data} />}
      {data.view === 'entity' && <EntityView data={data} />}
      {data.view === 'security' && <SecurityView data={data} />}
    </div>
  );
}

function StreamView({
  data,
  onOpenEntity,
}: {
  data: Extract<LoaderData, { view: 'stream' }>;
  onOpenEntity: (entityType: string, entityId: string) => void;
}) {
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', 'stream');
    if (value === ALL || !value) params.delete(key);
    else params.set(key, value);
    params.delete('before'); // any filter change resets pagination
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  const loadMore = () => {
    if (data.stream.nextCursor == null) return;
    const params = new URLSearchParams(searchParams);
    params.set('view', 'stream');
    params.set('before', String(data.stream.nextCursor));
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  return (
    <LCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <MIcon name="list" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_activity_view_stream')}</strong>
        <Badge>{data.stream.rows.length}</Badge>
        <span style={{ flex: 1 }} />
        <div style={{ minWidth: 160 }}>
          <MSelect
            value={data.filter.actorKind ?? ALL}
            onChange={(v) => setFilter('actorKind', v)}
            options={[
              { value: ALL, label: t('logs_activity_all_kinds') },
              ...ACTOR_KINDS.map((k) => ({ value: k, label: t(`logs_activity_kind_${k}`) })),
            ]}
          />
        </div>
        <div style={{ minWidth: 160 }}>
          <MSelect
            value={data.filter.action ?? ALL}
            onChange={(v) => setFilter('action', v)}
            options={[
              { value: ALL, label: t('logs_activity_all_actions') },
              ...Object.keys(ACTION_META).map((a) => ({ value: a, label: t(ACTION_META[a].tk) })),
            ]}
          />
        </div>
        <div style={{ minWidth: 180 }}>
          <MSelect
            value={data.filter.entityType ?? ALL}
            onChange={(v) => setFilter('entityType', v)}
            options={[
              { value: ALL, label: t('logs_activity_all_entities') },
              ...ENTITY_TYPES.map((e) => ({ value: e, label: e })),
            ]}
          />
        </div>
        <div style={{ minWidth: 220 }}>
          <MSelect
            value={data.filter.accountId ?? ALL}
            onChange={(v) => setFilter('accountId', v)}
            options={[
              { value: ALL, label: t('logs_activity_all_accounts') },
              ...data.accounts.map((a) => ({ value: a.id, label: a.label })),
            ]}
          />
        </div>
      </div>

      {data.stream.rows.length ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            {data.stream.rows.map((row) => (
              <ActivityRowView key={row.id} row={row} onOpenEntity={onOpenEntity} />
            ))}
          </div>
          {data.stream.nextCursor != null && (
            <ABtn
              type="button"
              variant="secondary"
              onClick={loadMore}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('logs_activity_load_more')}
            </ABtn>
          )}
        </>
      ) : (
        <Empty icon="list" title={t('logs_activity_empty')} sub={t('logs_activity_empty_sub')} />
      )}
    </LCard>
  );
}

function SessionsView({ data }: { data: Extract<LoaderData, { view: 'sessions' }> }) {
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();

  const pick = (accountId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('view', 'sessions');
    if (accountId) params.set('accountId', accountId);
    else params.delete('accountId');
    params.delete('before');
    setSearchParams(params, { replace: true, preventScrollReset: true });
  };

  // Group rows into session cards: a login row (or the very start of the trail) opens a new
  // card; everything after belongs to it until the next login.
  const groups: ActivityRow[][] = [];
  for (const row of data.session.rows) {
    if (row.action === 'login' || !groups.length) groups.push([row]);
    else groups[groups.length - 1].push(row);
  }

  return (
    <LCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <MIcon name="clock" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_activity_view_sessions')}</strong>
        <span style={{ flex: 1 }} />
        <div style={{ minWidth: 260 }}>
          <MSelect
            value={data.accountId || ALL}
            onChange={(v) => pick(v === ALL ? '' : v)}
            options={[
              { value: ALL, label: t('logs_activity_sessions_pick_account') },
              ...data.accounts.map((a) => ({ value: a.id, label: a.label })),
            ]}
          />
        </div>
      </div>

      {!data.accountId ? (
        <Empty icon="clock" title={t('logs_activity_sessions_pick_account')} />
      ) : groups.length ? (
        <div className="m-stack" style={{ gap: 10 }}>
          {groups.map((group, i) => (
            <LCard key={group[0].id ?? i} style={{ padding: 12 }}>
              <div style={{ overflowX: 'auto' }}>
                {group.map((row) => (
                  <ActivityRowView key={row.id} row={row} />
                ))}
              </div>
            </LCard>
          ))}
        </div>
      ) : (
        <Empty icon="clock" title={t('logs_activity_sessions_empty')} />
      )}
    </LCard>
  );
}

function EntityView({ data }: { data: Extract<LoaderData, { view: 'entity' }> }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [entityType, setEntityType] = React.useState(data.entityType);
  const [entityId, setEntityId] = React.useState(data.entityId);

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      `/logs/activity?view=entity&entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    );
  };

  return (
    <LCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
        <MIcon name="search" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_activity_view_entity')}</strong>
      </div>
      <form onSubmit={lookup} className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <input
          className="mochi-input"
          placeholder={t('logs_activity_entity_type_input')}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <input
          className="mochi-input"
          placeholder={t('logs_activity_entity_id_input')}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <ABtn type="submit" variant="primary">
          {t('logs_activity_lookup')}
        </ABtn>
      </form>

      {!data.entityType || !data.entityId ? (
        <Empty icon="search" title={t('logs_activity_entity_lookup_hint')} />
      ) : data.history.length ? (
        <div style={{ overflowX: 'auto' }}>
          {data.history.map((row) => (
            <ActivityRowView key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <Empty icon="search" title={t('logs_activity_entity_empty')} />
      )}
    </LCard>
  );
}

function SecurityView({ data }: { data: Extract<LoaderData, { view: 'security' }> }) {
  const { t } = useLang();
  const { security } = data;
  return (
    <div className="m-stack" style={{ gap: 16 }}>
      <LCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <MIcon name="key" size={20} />
          <strong style={{ fontSize: 'var(--text-lg)' }}>
            {t('logs_activity_security_auth_events')}
          </strong>
          <Badge>{security.authEvents.length}</Badge>
        </div>
        {security.authEvents.length ? (
          <div style={{ overflowX: 'auto' }}>
            {security.authEvents.map((row) => (
              <ActivityRowView key={row.id} row={row} />
            ))}
          </div>
        ) : (
          <Empty icon="key" title={t('logs_activity_empty')} />
        )}
      </LCard>

      <LCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <MIcon name="lock" size={20} />
          <strong style={{ fontSize: 'var(--text-lg)' }}>
            {t('logs_activity_security_active_sessions')}
          </strong>
          <Badge>{security.activeSessions.length}</Badge>
        </div>
        {security.activeSessions.length ? (
          <div className="m-stack" style={{ gap: 6 }}>
            {security.activeSessions.map((s, i) => (
              <div
                key={`${s.accountEmail}:${i}`}
                className="m-row"
                style={{
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--line, #e7e0d6)',
                }}
              >
                <span style={{ minWidth: 200 }}>{s.accountEmail}</span>
                {s.concurrent && (
                  <Tag color="orange" dot={false}>
                    {t('logs_activity_security_concurrent')}
                  </Tag>
                )}
                <span className="m-muted" style={{ minWidth: 120, fontFamily: 'var(--font-mono)' }}>
                  {s.ip ?? t('logs_activity_unknown')}
                </span>
                <span className="m-muted" style={{ flex: 1, minWidth: 160, fontSize: 12 }}>
                  {s.userAgent ?? t('logs_activity_unknown')}
                </span>
                <span className="m-muted" style={{ fontSize: 12 }}>
                  {s.createdAt ? <Stamp value={s.createdAt} /> : t('logs_activity_unknown')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="lock" title={t('logs_activity_security_no_sessions')} />
        )}
      </LCard>

      <LCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <MIcon name="mapPin" size={20} />
          <strong style={{ fontSize: 'var(--text-lg)' }}>
            {t('logs_activity_security_new_ips')}
          </strong>
          <Badge>{security.newIps.length}</Badge>
        </div>
        {security.newIps.length ? (
          <div className="m-stack" style={{ gap: 6 }}>
            {security.newIps.map((r, i) => (
              <div
                key={`${r.accountId}:${r.ip}:${i}`}
                className="m-row"
                style={{
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--line, #e7e0d6)',
                }}
              >
                <span style={{ minWidth: 200 }}>{r.email ?? r.accountId}</span>
                <span className="m-muted" style={{ minWidth: 120, fontFamily: 'var(--font-mono)' }}>
                  {r.ip}
                </span>
                <span className="m-muted" style={{ fontSize: 12 }}>
                  <Stamp value={r.firstSeenAt} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="mapPin" title={t('logs_activity_security_no_new_ips')} />
        )}
      </LCard>
    </div>
  );
}
