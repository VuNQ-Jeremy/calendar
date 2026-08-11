import React from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, MSelect } from './ui.jsx';
import { colorOf } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { formatDmy } from '../shared/logic/tuition.js';
import { daysBetweenVn } from '../shared/logic/garden.js';
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
