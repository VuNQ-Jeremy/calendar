import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, useConfirm } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { formatDmy } from '../shared/logic/tuition.js';
import { LogsTabs } from './screens-logs.jsx';
import type {
  NotificationsPlan,
  PlannedNotification,
  SentEntry,
} from '../server/services/notify-plan.js';

/**
 * /logs → Notifications: every message the cron is going to send, and what it recently sent.
 *
 * Grouped per job rather than merged into one timeline, because two of the four jobs have exact fire
 * times (an occurrence's clock) and two are predictions re-evaluated at 08:00. Mixing "will be sent
 * at 19:00 Thursday" with "will be sent tomorrow morning if this is still true" in one sorted list
 * invites reading the second as the first.
 *
 * Everything shown is the loader's — this screen does no scheduling arithmetic of its own. The only
 * writes are the run-now buttons, which fire the real job (idempotent through the ledger).
 */

const { Card: NCard, Button: NBtn, Badge, Tag } = DS;

/** Overdue / undeliverable ink. A literal palette hex, so it reads the same in both themes. */
const DANGER = colorOf('rose');

type LoaderData = { plan: NotificationsPlan; recent: SentEntry[] };

type JobId = 'class' | 'digest' | 'preview' | 'garden';

/** The four cards, in cron order: the 15-minute sweep, then the two 08:00 jobs, then 19:00. */
const JOBS: {
  id: JobId;
  tk: string;
  icon: 'bell' | 'sparkle' | 'calendar' | 'sprout';
  /** Which planner rows belong to this card. */
  kinds: PlannedNotification['jobKind'][];
  /** False for the two state-driven jobs: their rows are a prediction, not a schedule. */
  exact: boolean;
}[] = [
  { id: 'class', tk: 'logs_notif_job_class', icon: 'bell', kinds: ['class'], exact: true },
  {
    id: 'preview',
    tk: 'logs_notif_job_preview',
    icon: 'calendar',
    kinds: ['preview', 'preview-staff'],
    exact: true,
  },
  { id: 'digest', tk: 'logs_notif_job_digest', icon: 'sparkle', kinds: ['digest'], exact: false },
  {
    id: 'garden',
    tk: 'logs_notif_job_garden',
    icon: 'sprout',
    kinds: ['garden-penalty', 'garden-wilt', 'garden-drop'],
    exact: false,
  },
];

/** Which pref flag gates each job — an empty card is usually a switched-off job, not a bug. */
const JOB_PREF: Record<JobId, keyof NotificationsPlan['prefs']> = {
  class: 'classReminders',
  preview: 'previewEvening',
  digest: 'studyNudges',
  garden: 'gardenAlerts',
};

/** 'YYYY-MM-DDTHH:mm' → '11/08 19:00', in the school's own day format. */
function fmtStamp(stamp: string): string {
  const [day, time] = stamp.split('T');
  return `${formatDmy(day)} ${time ?? ''}`.trim();
}

export function LogsNotificationsScreen() {
  const { plan, recent } = useLoaderData() as LoaderData;
  const { t } = useLang();

  return (
    <div className="content">
      <PageHeader title={t('logs_title')} subtitle={t('logs_subtitle')} />
      <LogsTabs value="notifications" />

      <StatusStrip plan={plan} />

      {JOBS.map((job) => (
        <JobCard key={job.id} job={job} plan={plan} />
      ))}

      <SentLog recent={recent} />
    </div>
  );
}

/** Why a card is empty: the flags that gate each job, and whether either channel can deliver. */
function StatusStrip({ plan }: { plan: NotificationsPlan }) {
  const { t } = useLang();
  const { prefs, channels } = plan;

  const flag = (on: boolean, label: string) => (
    <Tag key={label} color={on ? 'green' : null} dot={false}>
      {label}
    </Tag>
  );

  return (
    <NCard style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <MIcon name="bell" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_notif_strip_title')}</strong>
        <span className="m-muted" style={{ fontSize: 13 }}>
          {t('logs_notif_horizon', { n: plan.horizonDays })}
        </span>
      </div>
      <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {flag(
          prefs.classReminders,
          `${t('logs_notif_job_class')} · ${t('logs_notif_lead', { n: prefs.classLeadMinutes })}`,
        )}
        {flag(prefs.previewEvening, t('logs_notif_job_preview'))}
        {flag(prefs.studyNudges, t('logs_notif_job_digest'))}
        {flag(prefs.gardenAlerts, t('logs_notif_job_garden'))}
      </div>
      <div className="m-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Tag color={channels.zaloEnabled ? 'green' : null} dot={false}>
          {channels.zaloEnabled ? t('logs_notif_zalo_on') : t('logs_notif_zalo_off')}
        </Tag>
        <Tag color="blue" dot={false}>
          {t('logs_notif_push_tokens', { n: channels.pushTokens, a: channels.pushAccounts })}
        </Tag>
        <Tag color="violet" dot={false}>
          {t('logs_notif_zalo_links', {
            n: channels.zaloLinks,
            g: channels.zaloByKind.group,
            d: channels.zaloByKind.direct,
          })}
        </Tag>
      </div>
      <p className="m-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
        {t('logs_notif_prefs_mobile_note')}
      </p>
      {plan.truncated && (
        <p style={{ margin: 0, color: DANGER.ink, fontSize: 'var(--text-sm)' }}>
          {t('logs_notif_truncated', { n: plan.planned.length })}
        </p>
      )}
    </NCard>
  );
}

function JobCard({ job, plan }: { job: (typeof JOBS)[number]; plan: NotificationsPlan }) {
  const { t } = useLang();
  const rows = plan.planned.filter((p) => job.kinds.includes(p.jobKind));
  const enabled = plan.prefs[JOB_PREF[job.id]] !== false;
  const nextRun = plan.nextRuns[job.id];

  return (
    <NCard style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <MIcon name={job.icon} size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t(job.tk)}</strong>
        <Badge>{rows.length}</Badge>
        <span className="m-muted" style={{ fontSize: 13 }}>
          {t('logs_notif_next_run', { t: fmtStamp(nextRun) })}
        </span>
        <span style={{ flex: 1 }} />
        <RunNowButton job={job.id} />
      </div>

      {!job.exact && (
        <p className="m-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
          {t('logs_notif_next_run_note')}
          {job.id === 'garden' ? ` ${t('logs_notif_garden_note')}` : ''}
        </p>
      )}

      {!enabled ? (
        <Empty
          icon="bell"
          title={t('logs_notif_disabled')}
          sub={t('logs_notif_prefs_mobile_note')}
        />
      ) : rows.length ? (
        <div className="m-stack" style={{ gap: 8 }}>
          {rows.map((row) => (
            <PlannedRow key={`${row.key}:${row.channel}`} row={row} showTime={job.exact} />
          ))}
        </div>
      ) : (
        <Empty
          icon="bell"
          title={t('logs_notif_none_due', { n: plan.horizonDays })}
          sub={t('logs_notif_none_due_sub')}
        />
      )}
    </NCard>
  );
}

/** Fire the real job. Idempotent through the ledger, which is why this is a button and not a form. */
function RunNowButton({ job }: { job: JobId }) {
  const fetcher = useFetcher<{ job?: string; sent?: number; error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();

  const run = async () => {
    // The garden job does more than send: it charges missed assignment deadlines, persists overdue
    // decay and writes the month-end album. Worth a confirm — the other three only send.
    if (job === 'garden') {
      const ok = await confirm({
        title: t('logs_notif_run_now'),
        message: t('logs_notif_run_garden_warning'),
        confirmLabel: t('logs_notif_run_now'),
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'run-job');
    fd.set('job', job);
    fetcher.submit(fd, { method: 'post' });
  };

  const busy = fetcher.state !== 'idle';
  return (
    <span className="m-row" style={{ gap: 10, alignItems: 'center' }}>
      {fetcher.data?.sent != null && !busy && (
        <span className="m-muted" style={{ fontSize: 13 }}>
          {t('logs_notif_run_result', { n: fetcher.data.sent })}
        </span>
      )}
      <NBtn variant="secondary" disabled={busy} onClick={run}>
        {busy ? t('logs_notif_running') : t('logs_notif_run_now')}
      </NBtn>
      {confirmNode}
    </span>
  );
}

function PlannedRow({ row, showTime }: { row: PlannedNotification; showTime: boolean }) {
  const { t } = useLang();
  // Fire time already past and the ledger still empty: the cron did not run when it should have.
  const missed = showTime && !row.alreadySent && row.fireAtIct < nowStampGuess();

  return (
    <div
      className="m-row"
      style={{
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '8px 0',
        borderBottom: '1px solid var(--line, #e7e0d6)',
        opacity: row.alreadySent ? 0.6 : 1,
      }}
    >
      {showTime && (
        <span style={{ minWidth: 104, fontWeight: 600, color: 'var(--text-strong)' }}>
          {fmtStamp(row.fireAtIct)}
        </span>
      )}
      <Tag color={row.channel === 'zalo' ? 'violet' : 'blue'} dot={false}>
        {t(row.channel === 'zalo' ? 'logs_notif_channel_zalo' : 'logs_notif_channel_push')}
      </Tag>
      <span style={{ minWidth: 150 }}>
        {row.subject.className ?? row.subject.studentName ?? formatDmy(row.subject.date)}
        {row.subject.start ? ` · ${row.subject.start}` : ''}
      </span>
      <span
        className="m-muted"
        title={row.body}
        style={{
          flex: 1,
          minWidth: 180,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {row.body.replace(/\n/g, ' · ')}
      </span>
      <TargetCell target={row.target} />
      <span style={{ minWidth: 118, textAlign: 'right' }}>
        {row.alreadySent ? (
          <Tag color="green" dot={false}>
            {t('logs_notif_sent')}
          </Tag>
        ) : !row.deliverable ? (
          <span style={{ color: DANGER.ink, fontWeight: 600, fontSize: 'var(--text-sm)' }}>
            {t('logs_notif_no_recipients')}
          </span>
        ) : missed ? (
          <span style={{ color: DANGER.ink, fontWeight: 600, fontSize: 'var(--text-sm)' }}>
            {t('logs_notif_overdue')}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * "3 students · 4 devices" / "class group chat" / "5 parent chats" / "all staff".
 *
 * The device count matters separately from the people count: a student with an account but no app
 * installed is a person the push cannot reach, and that is the single most common reason a
 * notification silently goes nowhere.
 */
function TargetCell({ target }: { target: PlannedNotification['target'] }) {
  const { t } = useLang();
  const label =
    target.kind === 'group-chat'
      ? t('logs_notif_target_group')
      : target.kind === 'parents'
        ? t('logs_notif_target_parents', { n: target.count })
        : target.kind === 'staff'
          ? t('logs_notif_target_staff', { n: target.count, d: target.devices ?? 0 })
          : t('logs_notif_target_students', { n: target.count, d: target.devices ?? 0 });
  return (
    <span
      className="m-muted"
      title={target.names.join(', ')}
      style={{ minWidth: 168, fontSize: 'var(--text-sm)' }}
    >
      {label}
    </span>
  );
}

/**
 * The ledger tail. Deliberately last: it is the least useful panel, because the table stores only
 * `(key, sent_at)` — no recipients, no body, and no record of whether anything arrived.
 */
function SentLog({ recent }: { recent: SentEntry[] }) {
  const { t } = useLang();
  return (
    <NCard style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
        <MIcon name="list" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_notif_recent_title')}</strong>
        <Badge>{recent.length}</Badge>
      </div>
      <p className="m-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
        {t('logs_notif_recent_note')}
      </p>
      {recent.length ? (
        <div className="m-stack" style={{ gap: 6 }}>
          {recent.map((e) => (
            <div
              key={e.key}
              className="m-row"
              style={{
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '6px 0',
                borderBottom: '1px solid var(--line, #e7e0d6)',
              }}
            >
              <span style={{ minWidth: 132, color: 'var(--text-strong)' }}>
                {fmtStamp(e.sentAt.slice(0, 16))}
              </span>
              {e.channel && (
                <Tag color={e.channel === 'zalo' ? 'violet' : 'blue'} dot={false}>
                  {t(e.channel === 'zalo' ? 'logs_notif_channel_zalo' : 'logs_notif_channel_push')}
                </Tag>
              )}
              <span style={{ minWidth: 150 }}>{jobLabel(e.job, t)}</span>
              <span className="m-muted" style={{ flex: 1, minWidth: 150 }}>
                {e.label || t('logs_notif_deleted')}
              </span>
              <span
                className="m-muted"
                style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.7 }}
              >
                {e.key}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="list" title={t('logs_notif_recent_empty')} />
      )}
    </NCard>
  );
}

function jobLabel(job: SentEntry['job'], t: (k: string) => string) {
  switch (job) {
    case 'class':
      return t('logs_notif_job_class');
    case 'preview':
    case 'preview-staff':
      return t('logs_notif_job_preview');
    case 'digest':
      return t('logs_notif_job_digest');
    case 'garden-penalty':
    case 'garden-wilt':
    case 'garden-drop':
      return t('logs_notif_job_garden');
    default:
      return t('logs_notif_job_unknown');
  }
}

/**
 * The device's own clock, as an ICT-shaped stamp, purely to decide whether a fire time is in the
 * past. Deliberately NOT used for anything the server computed: a phone set to Sydney would draw
 * the "missed" flag a few hours early, which is a cosmetic wrongness on an admin page, whereas
 * threading a server clock through every render for one comparison is not worth it.
 */
function nowStampGuess(): string {
  const d = new Date(Date.now() + 7 * 60 * 60_000);
  return d.toISOString().slice(0, 16);
}
