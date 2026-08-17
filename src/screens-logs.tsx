import React from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, MSelect } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { formatDmy } from '../shared/logic/tuition.js';
import { daysBetweenVn } from '../shared/logic/garden.js';
import { AI_INPUT_METRIC, AI_OUTPUT_METRIC, estimateAiCostUsd } from '../shared/logic/usage.js';
import type { ScheduledWordRow } from '../server/services/flashcards.js';

/**
 * Logs — admin-only diagnostics. One section so far: the review schedule.
 *
 * Deliberately plain. This screen exists to answer "what does the database actually say?", so it
 * renders the stored values and does the smallest possible arithmetic on top (days overdue, which
 * is a comparison against the server's ICT today, never the device clock). Nothing here writes.
 */

const { Card: LCard, Badge, Tag } = DS;

/** Overdue ink. A literal palette hex, so it reads the same in both themes. */
const DANGER = colorOf('rose');

type LoaderData = {
  studentId: string | null;
  students: { id: string; name: string; color: string }[];
  scheduledWords: ScheduledWordRow[];
  limit: number;
  today: string;
};

/** The filter's "everyone" option. Not a student id, so it cannot collide with one. */
const ALL = 'all';

/**
 * The two /logs tabs, as navigation rather than local state.
 *
 * Every other DS.Tabs in this app holds its value in `useState`, because those tabs switch between
 * views of data one loader already fetched. These two are separate pages with separate loaders and
 * separate cache keys — the notification forecast is expensive enough that the schedule tab should
 * not pay for it — so switching tabs is a route change. Exported so both screens render the same
 * strip and neither can drift out of step with the other.
 */
const LOGS_TAB_PATH: Record<'schedule' | 'notifications' | 'activity' | 'usage', string> = {
  schedule: '/logs',
  notifications: '/logs/notifications',
  activity: '/logs/activity',
  usage: '/logs/usage',
};

export function LogsTabs({
  value,
}: {
  value: 'schedule' | 'notifications' | 'activity' | 'usage';
}) {
  const navigate = useNavigate();
  const { t } = useLang();
  return (
    <div style={{ marginBottom: 16 }}>
      <DS.Tabs
        value={value}
        onChange={(id) => navigate(LOGS_TAB_PATH[id as keyof typeof LOGS_TAB_PATH] ?? '/logs')}
        tabs={[
          { id: 'schedule', label: t('logs_tab_schedule') },
          { id: 'notifications', label: t('logs_tab_notifications') },
          { id: 'activity', label: t('logs_tab_activity') },
          { id: 'usage', label: t('logs_tab_usage') },
        ]}
      />
    </div>
  );
}

export function LogsScreen() {
  const { studentId, students, scheduledWords, limit, today } = useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const { t } = useLang();

  // The filter is a navigation, not local state: the student sits in the path so each filter gets
  // its own cache entry (see logsStudentKey). Picking a student is therefore a route change, and
  // the back button walks the filters.
  const onPick = (value: string) => {
    navigate(value === ALL ? '/logs' : `/logs/${value}`);
  };

  const options = [
    { value: ALL, label: t('logs_all_students') },
    ...students.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="content">
      <PageHeader title={t('logs_title')} subtitle={t('logs_subtitle')} />
      <LogsTabs value="schedule" />

      <LCard style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <MIcon name="repeat" size={20} />
          <strong style={{ fontSize: 'var(--text-lg)' }}>{t('logs_scheduled_title')}</strong>
          <Badge>{scheduledWords.length}</Badge>
          <span style={{ flex: 1 }} />
          <div style={{ minWidth: 220 }}>
            <MSelect value={studentId ?? ALL} onChange={onPick} options={options} />
          </div>
        </div>

        <p className="m-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
          {t('logs_scheduled_hint')}
        </p>

        {scheduledWords.length ? (
          <>
            <ScheduledWordList rows={scheduledWords} today={today} />
            {scheduledWords.length >= limit && (
              <p style={{ margin: 0, color: DANGER.ink, fontSize: 'var(--text-sm)' }}>
                {t('logs_truncated', { n: limit })}
              </p>
            )}
          </>
        ) : (
          <Empty
            icon="repeat"
            title={t('logs_scheduled_empty')}
            sub={t('logs_scheduled_empty_sub')}
          />
        )}
      </LCard>
    </div>
  );
}

type UsageRow = { month: string; metric: string; count: number; quantity: number };

type UsageLoaderData = {
  rows: UsageRow[];
  /** Current ICT month, 'YYYY-MM'. */
  month: string;
  speechFreeSeconds: number;
  /**
   * Speech seconds this month across EVERY school, not just this one — the Azure F0 allowance is
   * a property of the subscription key the whole deployment shares. Only the gauge uses it; the
   * table beside it stays per-school.
   */
  speechUsedSeconds: number;
};

/** Per-metric display strings; a metric without an entry still renders under its raw key. */
const USAGE_METRIC_LABEL: Record<string, { title: string }> = {
  'speech-assess': { title: 'usage_speech_title' },
};

const mins = (seconds: number) => (seconds / 60).toFixed(1);

/**
 * /logs → Usage: one card per metered service, its current ICT month first with a gauge
 * against the free quota, then the past months as plain rows. Built generic on purpose —
 * a future metric (AI tokens, Zalo sends…) is one row per month in the same table and one
 * label entry above.
 */
export function LogsUsageScreen() {
  const { rows, month, speechFreeSeconds, speechUsedSeconds } = useLoaderData() as UsageLoaderData;
  const { t } = useLang();

  // The two Anthropic metrics render as ONE combined card (calls, tokens, cost estimate).
  const isAi = (m: string) => m === AI_INPUT_METRIC || m === AI_OUTPUT_METRIC;
  const aiRows = rows.filter((r) => isAi(r.metric));
  const metrics = [...new Set(rows.filter((r) => !isAi(r.metric)).map((r) => r.metric))];
  if (metrics.length === 0) metrics.push('speech-assess'); // the gauge is useful even at zero

  return (
    <div className="content">
      <PageHeader title={t('logs_title')} subtitle={t('logs_subtitle')} />
      <LogsTabs value="usage" />

      <div className="m-stack" style={{ gap: 16 }}>
        {metrics.map((metric) => {
          const label = USAGE_METRIC_LABEL[metric];
          const monthRows = rows.filter((r) => r.metric === metric);
          const current = monthRows.find((r) => r.month === month) ?? {
            month,
            metric,
            count: 0,
            quantity: 0,
          };
          const past = monthRows.filter((r) => r.month !== month);
          // Only the speech metric has a known free quota; a future metric renders no gauge
          // until it declares one.
          const quota = metric === 'speech-assess' ? speechFreeSeconds : null;
          // Against the platform-wide total, not this school's share — the quota is Azure's, and
          // Azure counts every school's clips against the one key.
          const used = metric === 'speech-assess' ? speechUsedSeconds : current.quantity;
          const pct = quota ? Math.min(100, (used / quota) * 100) : null;

          return (
            <LCard key={metric} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <MIcon name="mic" size={20} />
                <strong style={{ fontSize: 'var(--text-lg)' }}>
                  {label ? t(label.title) : metric}
                </strong>
                <Badge>{current.month}</Badge>
              </div>

              <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                {t('usage_month_clips', { n: current.count, m: mins(current.quantity) })}
              </div>

              {pct !== null && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }}>
                  <div
                    style={{
                      height: 10,
                      borderRadius: 999,
                      background: 'var(--border-subtle, #e7e0d6)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 999,
                        background:
                          pct >= 90
                            ? 'var(--red-600, #c0392b)'
                            : pct >= 70
                              ? 'var(--warning, #E0A02E)'
                              : 'var(--green-600, #2e7d32)',
                      }}
                    />
                  </div>
                  <span className="m-muted" style={{ fontSize: 13 }}>
                    {t('usage_free_quota', {
                      pct: pct.toFixed(pct < 10 ? 1 : 0),
                      h: Math.round((quota as number) / 3600),
                    })}
                  </span>
                </div>
              )}

              {past.length > 0 && (
                <div className="m-stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{t('usage_prev_months')}</strong>
                  {past.map((r) => (
                    <div
                      key={r.month}
                      className="m-row"
                      style={{
                        gap: 12,
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <span style={{ minWidth: 70 }}>{r.month}</span>
                      <span>{t('usage_month_clips', { n: r.count, m: mins(r.quantity) })}</span>
                    </div>
                  ))}
                </div>
              )}
            </LCard>
          );
        })}
        <AiUsageCard rows={aiRows} month={month} />
      </div>
    </div>
  );
}

/** Compact token count: 1234 → "1.2k". */
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/**
 * Anthropic API usage (vocabulary enrichment + generation), combined from its two metric rows
 * per month — input and output tokens — into one card with a list-price cost estimate
 * (shared/logic/usage.ts). No quota gauge: the API is pay-as-you-go, so the number to watch
 * is the estimated dollars, not a percentage.
 */
function AiUsageCard({ rows, month }: { rows: UsageRow[]; month: string }) {
  const { t } = useLang();
  const of = (m: string, metric: string) => rows.find((r) => r.month === m && r.metric === metric);
  const line = (m: string) => {
    const inp = of(m, AI_INPUT_METRIC);
    const out = of(m, AI_OUTPUT_METRIC);
    return t('usage_ai_month', {
      n: inp?.count ?? 0,
      i: tok(inp?.quantity ?? 0),
      o: tok(out?.quantity ?? 0),
      c: `$${estimateAiCostUsd(inp?.quantity ?? 0, out?.quantity ?? 0).toFixed(2)}`,
    });
  };
  const past = [...new Set(rows.map((r) => r.month))]
    .filter((m) => m !== month)
    .sort()
    .toReversed();

  return (
    <LCard style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <MIcon name="zap" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('usage_ai_title')}</strong>
        <Badge>{month}</Badge>
      </div>

      <div style={{ fontVariantNumeric: 'tabular-nums' }}>{line(month)}</div>

      {past.length > 0 && (
        <div className="m-stack" style={{ gap: 4 }}>
          <strong style={{ fontSize: 'var(--text-sm)' }}>{t('usage_prev_months')}</strong>
          {past.map((m) => (
            <div
              key={m}
              className="m-row"
              style={{
                gap: 12,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ minWidth: 70 }}>{m}</span>
              <span>{line(m)}</span>
            </div>
          ))}
        </div>
      )}
    </LCard>
  );
}

function ScheduledWordList({ rows, today }: { rows: ScheduledWordRow[]; today: string }) {
  const { t } = useLang();
  return (
    <div className="m-stack" style={{ gap: 8, overflowX: 'auto' }}>
      {rows.map((r) => (
        <ScheduledWordRowView key={`${r.studentId}:${r.wordId}`} row={r} today={today} />
      ))}
      <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
        {t('logs_scheduled_legend')}
      </p>
    </div>
  );
}

function ScheduledWordRowView({ row, today }: { row: ScheduledWordRow; today: string }) {
  const { t } = useLang();
  // Positive = overdue by that many ICT days; 0 = due today; negative = still in the future.
  const overdueBy = daysBetweenVn(row.dueDay, today);

  return (
    <div
      className="m-row"
      style={{
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '8px 0',
        borderBottom: '1px solid var(--line, #e7e0d6)',
      }}
    >
      <Tag color={row.studentColor} dot={false}>
        {row.studentName}
      </Tag>
      <span style={{ fontWeight: 600, color: 'var(--text-strong)', minWidth: 120 }}>
        {row.word}
      </span>
      <span className="m-muted" style={{ minWidth: 120, flex: 1 }}>
        {row.meaningVi}
      </span>
      <Tag color={row.topicColor} dot={false}>
        {row.topicName}
      </Tag>
      <span style={{ minWidth: 74 }}>{t('logs_level', { n: row.level + 1 })}</span>
      <span
        style={{
          minWidth: 150,
          color: overdueBy >= 0 ? DANGER.ink : 'var(--text-body)',
          fontWeight: overdueBy >= 0 ? 600 : 400,
        }}
      >
        {formatDmy(row.dueDay)}
        {' · '}
        {overdueBy > 0
          ? t('logs_overdue_days', { n: overdueBy })
          : overdueBy === 0
            ? t('logs_due_today')
            : t('logs_due_in_days', { n: -overdueBy })}
      </span>
      <span className="m-muted" style={{ minWidth: 92 }}>
        {t('logs_right_wrong', { right: row.correct, wrong: row.wrong })}
      </span>
    </div>
  );
}
