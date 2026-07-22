import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { MaterialPreview } from './material-preview.jsx';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { MaterialRow } from '../../server/services/materials.js';
import type { HomeworkRow, GradeRow } from '../../server/services/homework.js';

const { Button: CBtn } = DS;

interface HomeworkTabProps {
  eventId: string;
  classId: string;
  classes: ClassRow[];
  students: StudentRow[];
  materials: MaterialRow[];
}

type Selected = { kind: 'hw'; id: string } | { kind: 'mat'; id: string } | null;

export function HomeworkTab({ eventId, classId, classes, students, materials }: HomeworkTabProps) {
  const { t } = useLang();
  const hwFetcher = useFetcher<{ homework: HomeworkRow[]; grades: GradeRow[] }>();
  const attachedFetcher = useFetcher<{ materialIds: string[] }>();
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<Selected>(null);
  // Local copy of grades so save results can be merged without a full reload
  // (fetcher.load data is NOT revalidated after another fetcher's action).
  const [grades, setGrades] = React.useState<GradeRow[]>([]);

  React.useEffect(() => {
    hwFetcher.load('/homework');
    attachedFetcher.load(`/event-materials?eventId=${encodeURIComponent(eventId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  React.useEffect(() => {
    if (hwFetcher.data) setGrades(hwFetcher.data.grades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwFetcher.data]);

  const roster = (classes.find((c) => c.id === classId)?.studentIds ?? [])
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);

  const q = query.trim().toLowerCase();
  const hwList = (hwFetcher.data?.homework ?? [])
    .filter((h) => h.classId === classId)
    .filter((h) => !q || h.title.toLowerCase().includes(q))
    .sort((a, b) => (b.due ?? '').localeCompare(a.due ?? ''));

  const attachedIds = attachedFetcher.data?.materialIds ?? [];
  const classMats = materials
    .filter((m) => m.classId === classId)
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .sort((a, b) => Number(attachedIds.includes(b.id)) - Number(attachedIds.includes(a.id)));

  const selHw = selected?.kind === 'hw' ? hwList.find((h) => h.id === selected.id) : undefined;
  const selMat = selected?.kind === 'mat' ? classMats.find((m) => m.id === selected.id) : undefined;

  return (
    <div className="evm-split">
      <div className="evm-split__left">
        <input
          className="mochi-input"
          placeholder={t('hw_search_ph')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
          {t('hw_section_homework')}
        </div>
        {hwList.length ? (
          hwList.map((h) => {
            const graded = grades.filter(
              (g) => g.homeworkId === h.id && (g.score != null || g.comment),
            ).length;
            const active = selected?.kind === 'hw' && selected.id === h.id;
            return (
              <button
                key={h.id}
                type="button"
                className="lrow"
                onClick={() => setSelected({ kind: 'hw', id: h.id })}
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
        <div className="m-muted" style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginTop: 8 }}>
          {t('hw_section_materials')}
        </div>
        {classMats.map((m) => {
          const active = selected?.kind === 'mat' && selected.id === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className="lrow"
              onClick={() => setSelected({ kind: 'mat', id: m.id })}
              style={{
                cursor: 'pointer',
                textAlign: 'left',
                background: 'transparent',
                border: active ? '1.5px solid var(--brand)' : '1.5px solid var(--border-subtle)',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
                {attachedIds.includes(m.id) ? '★ ' : ''}
                {m.title}
              </span>
            </button>
          );
        })}
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
        ) : selMat ? (
          <MaterialPreview material={selMat} />
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
