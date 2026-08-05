import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader, Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { UpcomingSession } from '../../server/services/session-preview.js';

const { Card: MC, Tag: MTag } = DS;

interface ScheduleLoaderData {
  items: UpcomingSession[];
  serverNow: string;
}

/**
 * A student's upcoming sessions and what each one covers — the web twin of the phone's "Lịch học"
 * tab. The route feeding it deliberately skips the client cache; see app/routes/my-schedule.tsx.
 */
export function StudentScheduleScreen() {
  const { items, serverNow } = useLoaderData() as ScheduleLoaderData;
  const { t, lang } = useLang();

  return (
    <div className="m-stack" style={{ gap: 12 }}>
      <PageHeader title={t('sched_title')} subtitle={t('sched_sub')} />
      {items.length === 0 ? (
        <Empty icon="calendar" title={t('sched_empty')} />
      ) : (
        groupByDate(items).map(([date, group]) => (
          <div key={date} className="m-stack" style={{ gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              {dayLabel(date, serverNow, lang, t)}
            </div>
            {group.map((s) => (
              <SessionCard key={`${s.eventId}:${s.date}`} session={s} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function SessionCard({ session: s }: { session: UpcomingSession }) {
  const { t } = useLang();
  const p = s.preview;
  const focus = p.focusText.trim();
  const nothingNoted = !focus && !p.tests.length && !p.vocabTopic;
  const when = [s.start, s.end].filter(Boolean).join('–');

  return (
    <MC style={{ padding: 16 }}>
      <div className="m-row" style={{ gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{s.className}</div>
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 2 }}>
            {[when || null, s.title !== s.className ? s.title : null, s.location]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <MTag color={s.classColor}>{when || '—'}</MTag>
      </div>

      {nothingNoted ? (
        <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 10 }}>
          {t('sched_no_preview')}
        </div>
      ) : (
        <div className="m-stack" style={{ gap: 8, marginTop: 12 }}>
          {focus && (
            <div>
              <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                {t('prev_slip_study')}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{focus}</div>
            </div>
          )}
          {(p.tests.length > 0 || p.vocabTopic) && (
            <div>
              <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                {t('prev_slip_check')}
              </div>
              <div className="m-row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {p.tests.map((x) => (
                  <Link key={x.id} to="/my-tests" style={{ textDecoration: 'none' }}>
                    <MTag color={s.classColor}>{x.title}</MTag>
                  </Link>
                ))}
                {p.vocabTopic && (
                  <Link
                    to={`/vocabulary/${encodeURIComponent(p.vocabTopic.slug ?? p.vocabTopic.id)}`}
                    style={{ textDecoration: 'none' }}
                  >
                    <MTag color="violet">
                      {`${p.vocabTopic.name} · ${t('prev_slip_words', {
                        n: p.vocabTopic.wordCount,
                      })}`}
                    </MTag>
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </MC>
  );
}

/** Preserve the server's ordering; it already sorted by (date, start). */
function groupByDate(items: UpcomingSession[]): [string, UpcomingSession[]][] {
  const out: [string, UpcomingSession[]][] = [];
  for (const s of items) {
    const last = out[out.length - 1];
    if (last && last[0] === s.date) last[1].push(s);
    else out.push([s.date, [s]]);
  }
  return out;
}

/**
 * "Hôm nay" / "Ngày mai" / a plain date. Today comes from the server's clock shifted to ICT, not
 * the browser's, so a laptop set to the wrong timezone still agrees with the list it labels.
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
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}
