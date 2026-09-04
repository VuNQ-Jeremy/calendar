import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import type { LedgerRow } from '../../server/services/practice.js';
import { dm, type PracticeSubmit } from './common.jsx';

const { Card, Button, Tag } = DS;

/**
 * The month's standing per student — the old ledger table turned sideways so it can sit above the
 * sheet. "No Zalo pairing" is shown rather than hidden because an unpaired family is the one case
 * where the whole miss economy is invisible to the people it is meant to inform (decision #25).
 */
export function StandingStrip({
  rows,
  classId,
  submit,
  confirm,
}: {
  rows: LedgerRow[];
  classId: string;
  submit: PracticeSubmit;
  confirm: (o: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
}) {
  const { t } = useLang();

  const clear = async (studentId: string) => {
    const ok = await confirm({
      title: t('pr_clear_warning'),
      message: t('pr_clear_warning_confirm'),
      confirmLabel: t('pr_clear_warning'),
      danger: true,
    });
    if (!ok) return;
    submit({ intent: 'clear-warning', classId, studentId });
  };

  return (
    <div className="pr-sheet__standing">
      {rows.map((r) => (
        <Card
          key={r.studentId}
          flat
          className="pr-sheet__stand"
          data-testid="pr-standing"
          data-student={r.studentId}
        >
          <div className="pr-sheet__stand-head">
            <strong>{r.studentName}</strong>
            {!r.hasZalo && <Tag>{t('pr_no_zalo')}</Tag>}
          </div>
          <div className="pr-sheet__stand-nums">
            <span>
              {t('pr_done_total')} <b>{`${r.summary.doneTasks} / ${r.summary.totalTasks}`}</b>
            </span>
            <span>
              {t('pr_excused')} <b>{`${r.summary.excusedUsed} / ${r.summary.excusedQuota}`}</b>
            </span>
            <span>
              {t('pr_unexcused')} <b>{r.summary.unexcused}</b>
            </span>
          </div>
          <div className="pr-sheet__stand-flags">
            {r.summary.pendingMultiplier > 0 && r.summary.pendingForDate && (
              <Tag color="orange">
                {t('pr_penalty_badge', {
                  n: r.summary.pendingMultiplier,
                  date: dm(r.summary.pendingForDate),
                })}
              </Tag>
            )}
            {r.summary.level > 0 ? (
              <>
                <Tag color="violet">{t('pr_warning_level', { n: r.summary.level })}</Tag>
                <Button size="sm" variant="ghost" onClick={() => void clear(r.studentId)}>
                  {t('pr_clear_warning')}
                </Button>
              </>
            ) : (
              <span className="pr-sheet__muted">{t('pr_no_warning')}</span>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
