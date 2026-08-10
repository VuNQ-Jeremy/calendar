import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { UpcomingSession } from '../../server/services/session-preview.js';

const { Card: MC, Tag: MTag } = DS;

interface ChildSummary {
  id: string;
  name: string;
  color: string;
  classNames: string[];
  items: UpcomingSession[];
}

interface ChildrenLoaderData {
  serverNow: string;
  children: ChildSummary[];
}

/**
 * A parent's home. One card per child: their classes, the next few sessions, and the way in.
 *
 * Read-only by design — a parent has nothing to submit here. The route feeding it skips the
 * client cache; see app/routes/children.tsx.
 */
export function ParentChildrenScreen() {
  const { children, serverNow } = useLoaderData() as ChildrenLoaderData;
  const { t } = useLang();

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={t('ch_title')} subtitle={t('ch_sub')} />
      {children.length === 0 ? (
        // A parent record with no linked child. Staff-side data problem, so say what to do about it.
        <Empty icon="users" title={t('ch_no_children')} />
      ) : (
        children.map((c) => <ChildCard key={c.id} child={c} serverNow={serverNow} />)
      )}
    </div>
  );
}

/** How many of a child's upcoming sessions the home card previews before deferring to the detail. */
const PREVIEW_LIMIT = 3;

function ChildCard({ child: c, serverNow }: { child: ChildSummary; serverNow: string }) {
  const { t, lang } = useLang();
  const shown = c.items.slice(0, PREVIEW_LIMIT);

  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{c.name}</div>
          {c.classNames.length > 0 && (
            <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
              {c.classNames.join(' · ')}
            </div>
          )}
        </div>
        <Link to={`/children/${c.id}`} style={{ textDecoration: 'none' }}>
          <MTag color={c.color}>{t('ch_view_child')}</MTag>
        </Link>
      </div>

      <div className="m-stack" style={{ gap: 8, marginTop: 14 }}>
        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {t('ch_upcoming')}
        </div>
        {shown.length === 0 ? (
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('ch_upcoming_none')}
          </div>
        ) : (
          shown.map((s) => (
            <div
              key={`${s.eventId}:${s.date}`}
              className="m-row"
              style={{ gap: 10, alignItems: 'baseline' }}
            >
              <span style={{ fontSize: 'var(--text-sm)', minWidth: 96 }}>
                {dayLabel(s.date, serverNow, lang, t)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{s.className}</span>
              <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                {[s.start, s.end].filter(Boolean).join('–') || '—'}
              </span>
            </div>
          ))
        )}
        {c.items.length > shown.length && (
          <Link to={`/children/${c.id}`} style={{ fontSize: 'var(--text-sm)' }}>
            {t('ch_more_sessions', { n: c.items.length - shown.length })}
          </Link>
        )}
      </div>
    </MC>
  );
}

/**
 * "Today" / "Tomorrow" / a plain date. Today comes from the server's clock shifted to ICT, not the
 * browser's, so a phone set to the wrong timezone still agrees with the list it labels — the same
 * reasoning as src/schedule/student-schedule.tsx.
 */
function dayLabel(
  date: string,
  serverNow: string,
  lang: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const ict = new Date(new Date(serverNow).getTime() + 7 * 60 * 60_000);
  const today = ict.toISOString().slice(0, 10);
  const tomorrow = new Date(ict.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (date === today) return t('sched_today');
  if (date === tomorrow) return t('sched_tomorrow');
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
