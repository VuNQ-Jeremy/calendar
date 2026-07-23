import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { HomeworkRow, GradeRow } from '../../server/services/homework.js';

const { Button: CBtn } = DS;

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
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Local copy of grades so save results can be merged without a full reload
  // (the /homework route clientAction invalidates the cache on grade save,
  // so the next modal open refetches fresh, but this session keeps the
  // just-saved rows visible without waiting on that refetch).
  const [grades, setGrades] = React.useState<GradeRow[]>([]);

  React.useEffect(() => {
    if (hwData) setGrades(hwData.grades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwData]);

  const roster = (classes.find((c) => c.id === classId)?.studentIds ?? [])
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);

  const q = query.trim().toLowerCase();
  const hwList = (hwData?.homework ?? [])
    .filter((h) => h.classId === classId)
    .filter((h) => !q || h.title.toLowerCase().includes(q))
    .sort((a, b) => (b.due ?? '').localeCompare(a.due ?? ''));

  const selHw = hwList.find((h) => h.id === selectedId);

  return (
    <div className="evm-split">
      <div className="evm-split__left">
        <input
          className="mochi-input"
          placeholder={t('hw_search_ph')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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

  const setRow = (sid: string, patch: Partial<{ score: string; comment: string }>) =>
    setRows((p) => ({ ...p, [sid]: { ...p[sid], ...patch } }));

  const invalid = Object.values(rows).some((r) => {
    if (r.score === '') return false;
    const n = Number(r.score);
    return !Number.isFinite(n) || n < 0 || n > 10;
  });

  const save = () => {
    const records = roster.map((s) => ({
      studentId: s.id,
      score: rows[s.id]?.score === '' || rows[s.id] == null ? null : Number(rows[s.id].score),
      comment: rows[s.id]?.comment || null,
    }));
    const fd = new FormData();
    fd.set('intent', 'save-grades');
    fd.set('homeworkId', homework.id);
    fd.set('records', JSON.stringify(records));
    saveFetcher.submit(fd, { action: '/homework', method: 'post' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="m-row" style={{ gap: 10, marginBottom: 8 }}>
        <strong style={{ flex: 1 }}>{homework.title}</strong>
        {homework.due && <span className="m-muted">{homework.due}</span>}
      </div>
      <div className="evm-pane-scroll m-stack">
        {roster.map((s) => (
          <div key={s.id} className="lrow" style={{ gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
              {s.name}
            </span>
            <input
              className="mochi-input"
              type="number"
              min={0}
              max={10}
              step={0.25}
              style={{ width: 90 }}
              placeholder="—"
              value={rows[s.id]?.score ?? ''}
              onChange={(e) => setRow(s.id, { score: e.target.value })}
            />
            <input
              className="mochi-input"
              style={{ width: 220 }}
              placeholder={t('hw_comment')}
              value={rows[s.id]?.comment ?? ''}
              onChange={(e) => setRow(s.id, { comment: e.target.value })}
            />
          </div>
        ))}
        {!roster.length && <Empty icon="users" title={t('att_empty_roster')} />}
      </div>
      <div className="m-row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        {saveFetcher.data?.ok && saveFetcher.state === 'idle' && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('hw_grade_saved')}
          </span>
        )}
        <CBtn variant="primary" onClick={save} disabled={invalid || saveFetcher.state !== 'idle'}>
          {t('hw_grade_save')}
        </CBtn>
      </div>
    </div>
  );
}
