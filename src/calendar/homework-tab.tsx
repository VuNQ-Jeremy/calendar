import React from 'react';
import { useFetcher } from 'react-router';
import { Empty, MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { HomeworkRow, GradeRow } from '../../server/services/homework.js';

interface HomeworkTabProps {
  classId: string;
  classes: ClassRow[];
  students: StudentRow[];
}

export function HomeworkTab({ classId, classes, students }: HomeworkTabProps) {
  const { t } = useLang();
  const { data: hwData } = useCachedLoad<{ homework: HomeworkRow[]; grades: GradeRow[] }>(
    'hw:modal',
    '/homework',
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Local copy of the homework list + grades. Auto-saving a grade POSTs to
  // /homework, whose clientAction invalidates the 'hw:' cache in a finally —
  // that would wipe hwData to undefined and blank the whole section until a
  // remount refetches. Holding our own copy (updated only when hwData is
  // present) keeps the list visible across those save-triggered invalidations.
  const [homework, setHomework] = React.useState<HomeworkRow[]>([]);
  const [grades, setGrades] = React.useState<GradeRow[]>([]);

  React.useEffect(() => {
    if (hwData) {
      setHomework(hwData.homework);
      setGrades(hwData.grades);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwData]);

  const roster = (classes.find((c) => c.id === classId)?.studentIds ?? [])
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);

  const hwList = homework
    .filter((h) => h.classId === classId)
    .sort((a, b) => (b.due ?? '').localeCompare(a.due ?? ''));

  // Auto-select the first homework once the list is available.
  React.useEffect(() => {
    if (selectedId == null && hwList.length) setSelectedId(hwList[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwList.length]);

  const selHw = hwList.find((h) => h.id === selectedId);

  return (
    <div className="evm-split">
      <div className="evm-split__left">
        {hwList.length ? (
          hwList.map((h) => {
            const graded = grades.filter(
              (g) => g.homeworkId === h.id && (g.score != null || g.comment),
            ).length;
            const active = selectedId === h.id;
            return (
              <button
                key={h.id}
                type="button"
                className="lrow"
                onClick={() => setSelectedId(h.id)}
                style={{
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: 'transparent',
                  border: active ? '1.5px solid var(--brand)' : '1.5px solid var(--border-subtle)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
                  {h.title}
                </span>
                <span className="m-muted" style={{ fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                  {h.due ?? ''} · {t('hw_graded_n', { done: graded, total: roster.length })}
                </span>
              </button>
            );
          })
        ) : (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('hw_list_empty')}
          </span>
        )}
      </div>
      <div className="evm-split__right">
        {selHw ? (
          <GradingPanel
            key={selHw.id}
            homework={selHw}
            roster={roster}
            grades={grades.filter((g) => g.homeworkId === selHw.id)}
            onSaved={(saved) =>
              setGrades((prev) => [...prev.filter((g) => g.homeworkId !== selHw.id), ...saved])
            }
          />
        ) : (
          <Empty icon="clipboard" title={t('hw_pick_prompt')} />
        )}
      </div>
    </div>
  );
}

interface GradingPanelProps {
  homework: HomeworkRow;
  roster: StudentRow[];
  grades: GradeRow[];
  onSaved: (grades: GradeRow[]) => void;
}

// Score dropdown options: blank (ungraded) plus 0–10 in 0.25 steps, matching
// the granularity the old number input allowed so no stored score is unpickable.
const SCORE_OPTIONS = [
  { value: '', label: '—' },
  ...Array.from({ length: 41 }, (_, i) => {
    const v = String(i * 0.25);
    return { value: v, label: v };
  }),
];

function GradingPanel({ homework, roster, grades, onSaved }: GradingPanelProps) {
  const { t } = useLang();
  const saveFetcher = useFetcher<{ ok: boolean; grades: GradeRow[] }>();
  const [rows, setRows] = React.useState<Record<string, { score: string; comment: string }>>({});

  React.useEffect(() => {
    const seeded: Record<string, { score: string; comment: string }> = {};
    for (const s of roster) {
      const g = grades.find((x) => x.studentId === s.id);
      seeded[s.id] = { score: g?.score != null ? String(g.score) : '', comment: g?.comment ?? '' };
    }
    setRows(seeded);
    // Reseed only when the homework changes (GradingPanel is keyed by homework.id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homework.id]);

  React.useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.grades) onSaved(saveFetcher.data.grades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  // Auto-save: persist the whole roster whenever a score or comment changes.
  const persist = (next: Record<string, { score: string; comment: string }>) => {
    const records = roster.map((s) => ({
      studentId: s.id,
      score: next[s.id]?.score === '' || next[s.id] == null ? null : Number(next[s.id].score),
      comment: next[s.id]?.comment || null,
    }));
    const fd = new FormData();
    fd.set('intent', 'save-grades');
    fd.set('homeworkId', homework.id);
    fd.set('records', JSON.stringify(records));
    saveFetcher.submit(fd, { action: '/homework', method: 'post' });
  };

  const setScore = (sid: string, score: string) => {
    const next = { ...rows, [sid]: { ...rows[sid], score } };
    setRows(next);
    persist(next);
  };
  const setComment = (sid: string, comment: string) =>
    setRows((p) => ({ ...p, [sid]: { ...p[sid], comment } }));
  const commitComment = () => persist(rows);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="m-row" style={{ gap: 10, marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>{homework.title}</strong>
        {saveFetcher.data?.ok && saveFetcher.state === 'idle' && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('hw_grade_saved')}
          </span>
        )}
      </div>
      <div className="evm-pane-scroll m-stack">
        {roster.map((s) => (
          <div key={s.id} className="lrow" style={{ gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
              {s.name}
            </span>
            <div className="hw-grade-score" style={{ width: 90 }}>
              <MSelect
                value={rows[s.id]?.score ?? ''}
                onChange={(v) => setScore(s.id, v)}
                options={SCORE_OPTIONS}
              />
            </div>
            <input
              className="mochi-input"
              style={{ width: 220 }}
              placeholder={t('hw_comment')}
              value={rows[s.id]?.comment ?? ''}
              onChange={(e) => setComment(s.id, e.target.value)}
              onBlur={commitComment}
            />
          </div>
        ))}
        {!roster.length && <Empty icon="users" title={t('att_empty_roster')} />}
      </div>
    </div>
  );
}
