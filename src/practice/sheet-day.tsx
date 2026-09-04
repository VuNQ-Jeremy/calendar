import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { DONE_STATUSES, weekdayOf } from '../../shared/logic/practice.js';
import type { SheetDay } from '../../shared/logic/practice-sheet.js';
import type { ExcuseRow, MissRow, StudentTaskRow } from '../../server/services/practice.js';
import { dm, type PracticeSubmit } from './common.jsx';

const { Button, IconButton, Tag } = DS;

export type Day = SheetDay<StudentTaskRow, MissRow, ExcuseRow>;

/**
 * One date group's header row: the sheet's annotated date cell. Everything a teacher used to reach
 * through the week column's menu, the review page's excuse block and the ledger's miss list sits on
 * this one line — day-off menu, the miss with Mark excused, the ×N owed, the pending excuse request.
 *
 * `data-testid`/`aria-label` strings are e2e handles (e2e/crud-practice.spec.ts).
 */
export function DayHeader({
  day,
  classId,
  classTime,
  penalty,
  menuOpen,
  onToggleMenu,
  submit,
}: {
  day: Day;
  classId: string;
  /** 'HH:MM' when the lesson on this date carries a start time; null when it does not. */
  classTime: string | null;
  /** The student's pending ×N when it falls on this date, else 0. */
  penalty: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  submit: PracticeSubmit;
}) {
  const { t, lang } = useLang();
  const cal = getCal(lang);
  const done = day.rows.filter((r) => DONE_STATUSES.has(r.copy.status)).length;

  const override = (value: 'true' | 'false' | 'null') => {
    onToggleMenu();
    submit({ intent: 'day-override', classId, date: day.date, isPractice: value });
  };

  return (
    <div
      className={`pr-sheet__dayhead is-${day.kind}${day.isToday ? ' is-today' : ''}${
        day.isPractice ? '' : ' is-off'
      }${menuOpen ? ' has-menu' : ''}`}
      data-testid="pr-day"
      data-date={day.date}
      data-today={day.isToday ? 'true' : 'false'}
      data-kind={day.kind}
    >
      <span className="pr-sheet__date">{`${cal.dow[weekdayOf(day.date)]} ${dm(day.date)}`}</span>
      {day.isToday && <Tag color="orange">{t('pr_today')}</Tag>}
      {day.isClass && (
        <Tag color="blue">
          <MIcon name="book" size={14} />
          {classTime ? t('pr_class_at', { time: classTime }) : t('pr_class_day')}
        </Tag>
      )}
      {/* Sunday is off by rule and a switched-off day is off by choice; the outline says which. */}
      {!day.isPractice &&
        (day.isSunday ? (
          <span className="pr-sheet__sunday">{t('pr_sunday')}</span>
        ) : (
          <Tag>{t('pr_day_off')}</Tag>
        ))}
      {day.rows.length > 0 && (
        <span className="pr-sheet__meta">{t('pr_day_meta', { n: day.rows.length, done })}</span>
      )}
      {day.miss && (
        <span className="pr-sheet__miss">
          <Tag color={day.miss.excused ? 'green' : 'orange'}>
            {t(day.miss.excused ? 'pr_miss_excused' : 'pr_miss_unexcused')}
          </Tag>
          {!day.miss.excused && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => submit({ intent: 'excuse-miss', missId: day.miss!.id })}
            >
              {t('pr_excuse_miss')}
            </Button>
          )}
        </span>
      )}
      {penalty > 0 && <Tag color="orange">{t('pr_penalty_owed', { n: penalty })}</Tag>}
      {day.excuse && (
        <span className="pr-sheet__excuse">
          <span>{t('pr_excuse_request')}</span>
          <em>{`“${day.excuse.reason}”`}</em>
          <Button
            size="sm"
            onClick={() =>
              submit({ intent: 'excuse-decide', excuseId: day.excuse!.id, decision: 'approve' })
            }
          >
            {t('pr_approve')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              submit({ intent: 'excuse-decide', excuseId: day.excuse!.id, decision: 'reject' })
            }
          >
            {t('pr_reject')}
          </Button>
        </span>
      )}
      <span className="pr-sheet__spacer" />
      <span className="pr-sheet__menu">
        <IconButton
          label={t('pr_day_menu')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <MIcon name="more" size={16} />
        </IconButton>
        {menuOpen && (
          <div className="pr-sheet__menu-pop" role="menu">
            <button
              type="button"
              role="menuitem"
              className="pr-sheet__menu-item"
              onClick={() => override('false')}
            >
              {t('pr_day_off')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pr-sheet__menu-item"
              onClick={() => override('true')}
            >
              {t('pr_make_practice_day')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="pr-sheet__menu-item"
              onClick={() => override('null')}
            >
              {t('pr_remove_override')}
            </button>
          </div>
        )}
      </span>
    </div>
  );
}
