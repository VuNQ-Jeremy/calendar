import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { shiftMonth } from '../../shared/logic/tuition.js';
import type { ExcuseRow, LedgerRow } from '../../server/services/practice.js';
import type { ClassRow } from '../../server/services/classes.js';
import { dm, usePracticeSubmit } from './common.jsx';

const { Button, Tag } = DS;

interface LedgerLoaderData {
  classId: string;
  cls: ClassRow;
  month: string;
  rows: LedgerRow[];
  pendingExcuses: ExcuseRow[];
}

/**
 * The month's ledger: one row per student, expandable into the individual misses.
 *
 * "No Zalo pairing" is shown as a muted tag rather than hidden, because an unpaired family is the
 * one case where the whole miss economy is invisible to the people it is meant to inform
 * (decision #25) — the teacher needs to see that before they wonder why nobody reacted.
 */
export function PracticeLedgerScreen() {
  const { classId, cls, month, rows } = useLoaderData() as LedgerLoaderData;
  const { t } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();
  const [open, setOpen] = React.useState<string | null>(null);

  const clearWarning = async (studentId: string) => {
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
    <div className="pr-ledger">
      <PageHeader
        title={cls.name}
        subtitle={`${t('pr_ledger')} · ${month}`}
        actions={
          <>
            <Link to={`/practice/${classId}/ledger/${shiftMonth(month, -1)}`}>
              <Button variant="secondary">‹</Button>
            </Link>
            <Link to={`/practice/${classId}/ledger/${shiftMonth(month, 1)}`}>
              <Button variant="secondary">›</Button>
            </Link>
          </>
        }
      />

      <table className="pr-ledger__table">
        <thead>
          <tr>
            <th>{t('pr_student')}</th>
            <th>{t('pr_done_total')}</th>
            <th>{t('pr_excused')}</th>
            <th>{t('pr_unexcused')}</th>
            <th>{t('pr_misses')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.studentId}>
              <tr>
                <td>
                  <button
                    type="button"
                    className="pr-ledger__name"
                    onClick={() => setOpen(open === r.studentId ? null : r.studentId)}
                  >
                    {r.studentName}
                  </button>
                  {!r.hasZalo && <Tag>{t('pr_no_zalo')}</Tag>}
                </td>
                <td>{`${r.summary.doneTasks} / ${r.summary.totalTasks}`}</td>
                <td>{`${r.summary.excusedUsed} / ${r.summary.excusedQuota}`}</td>
                <td>{r.summary.unexcused}</td>
                <td>
                  {r.summary.pendingMultiplier > 0 && r.summary.pendingForDate && (
                    <Tag color="orange">
                      {t('pr_penalty_badge', {
                        n: r.summary.pendingMultiplier,
                        date: dm(r.summary.pendingForDate),
                      })}
                    </Tag>
                  )}
                  {r.summary.level > 0 && (
                    <>
                      <Tag color="violet">{t('pr_warning_level', { n: r.summary.level })}</Tag>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void clearWarning(r.studentId)}
                      >
                        {t('pr_clear_warning')}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
              {open === r.studentId && (
                <tr>
                  <td colSpan={5}>
                    <ul className="pr-ledger__misses">
                      {r.misses.length === 0 && <li>{t('pr_no_tasks_day')}</li>}
                      {r.misses.map((m) => (
                        <li key={m.id}>
                          <span>{dm(m.date)}</span>
                          <Tag color={m.excused ? 'green' : 'orange'}>
                            {m.excused ? t('pr_excused') : t('pr_unexcused')}
                          </Tag>
                          {!m.excused && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => submit({ intent: 'excuse-miss', missId: m.id })}
                            >
                              {t('pr_excuse_miss')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {confirmNode}
    </div>
  );
}
