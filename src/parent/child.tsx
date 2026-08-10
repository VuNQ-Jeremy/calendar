import { Link, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { PageHeader, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { monthLabel, shiftMonth } from '../../shared/logic/month.js';
import { ATTENDANCE_META } from '../../shared/logic/assess.js';
import type { AttendanceStatusId } from '../../shared/logic/assess.js';
import type { AttendanceHistoryRow } from '../../server/services/attendance.js';

const { Card: MC, Tag: MTag, IconButton, Button } = DS;

interface ChildLoaderData {
  month: string;
  student: { id: string; name: string; color: string };
  classNames: string[];
  attendance: AttendanceHistoryRow[];
}

/**
 * One child, one month: the attendance roll, and the two documents for that month.
 *
 * The report card and the fee slip are the EXISTING staff document routes, opened in a new tab —
 * a parent sees the same printable slip the teacher would hand over, rather than a second
 * rendering of it that could drift. Both check ownership server-side; see parent-portal.ts.
 */
export function ParentChildScreen() {
  const { month, student, classNames, attendance } = useLoaderData() as ChildLoaderData;
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const fmtMonth = (m: string) => monthLabel(m, lang);

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader
        title={student.name}
        subtitle={classNames.join(' · ') || t('ch_no_classes')}
        actions={
          <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
            <IconButton
              label={fmtMonth(shiftMonth(month, -1))}
              onClick={() => navigate(`/children/${student.id}/${shiftMonth(month, -1)}`)}
            >
              <MIcon name="chevronLeft" size={18} />
            </IconButton>
            <span style={{ fontWeight: 800, minWidth: 130, textAlign: 'center' }}>
              {fmtMonth(month)}
            </span>
            <IconButton
              label={fmtMonth(shiftMonth(month, 1))}
              onClick={() => navigate(`/children/${student.id}/${shiftMonth(month, 1)}`)}
            >
              <MIcon name="chevronRight" size={18} />
            </IconButton>
          </div>
        }
      />

      <MC style={{ padding: 16 }}>
        <div style={{ fontWeight: 700 }}>{t('ch_documents')}</div>
        <div className="m-row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {/* Plain anchors, not <Link>: these routes live outside the app shell and render as
              standalone documents, so they open in their own tab rather than inside the layout. */}
          <a
            href={`/assessments/${month}/${student.id}/report`}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">{t('ch_report_card')}</Button>
          </a>
          <a
            href={`/tuition/${month}/${student.id}/print`}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary">{t('ch_fee_slip')}</Button>
          </a>
        </div>
      </MC>

      <MC style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>{t('ch_attendance_title')}</div>
        {attendance.length === 0 ? (
          <Empty icon="clipboard" title={t('ch_attendance_none')} />
        ) : (
          <div className="m-stack" style={{ gap: 6 }}>
            {attendance.map((r) => (
              <AttendanceRow key={`${r.eventId}:${r.date}`} row={r} lang={lang} />
            ))}
          </div>
        )}
      </MC>

      <div>
        <Link to="/children" style={{ fontSize: 'var(--text-sm)' }}>
          {t('ch_back')}
        </Link>
      </div>
    </div>
  );
}

function AttendanceRow({ row, lang }: { row: AttendanceHistoryRow; lang: string }) {
  const { t } = useLang();
  // A status the app no longer defines still has to print something — show the raw value rather
  // than a blank chip, so a stale row reads as data instead of a rendering bug.
  const meta = ATTENDANCE_META[row.status as AttendanceStatusId];
  const when = [row.startTime, row.endTime].filter(Boolean).join('–');

  return (
    <div className="m-row" style={{ gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontSize: 'var(--text-sm)', minWidth: 76 }}>{dayLabel(row.date, lang)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {row.className ?? row.eventTitle}
        {when && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {' · ' + when}
          </span>
        )}
      </span>
      <MTag color={meta?.color ?? 'cocoa'}>{meta ? t(meta.tk) : row.status}</MTag>
    </div>
  );
}

/** Day and month only — the year is already in the month header above the list. */
function dayLabel(date: string, lang: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
