import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, MSelect, MDatePicker } from './ui.jsx';
import { colorOf, iso, TODAY, ICON_TINT } from './lib/core.js';
import { expandEvents, fmtTime, toMin } from './calendar/index.jsx';
import { useLang, locale } from './lib/i18n.jsx';
import type { IconName } from './icons.jsx';
import type { ClassLite, ClassRow } from '../server/services/classes.js';
import type { HomeworkRow, GradeRow } from '../server/services/homework.js';
import type { EventRow } from '../server/services/events.js';
import type { StudentRow } from '../server/services/people.js';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';

const {
  Card: SC,
  Button: SBtn,
  IconButton: SIB,
  Tag: STag,
  Badge: SBadge,
  Checkbox: SCheck,
  ProgressBar: SProg,
} = DS;

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  color: string;
  phone?: string | null;
  avatar?: string;
}

interface DashLoaderData {
  todayEvents: EventRow[];
  homework: HomeworkRow[];
  classes: ClassLite[];
  studentCount: number;
  materialCount: number;
}

interface HwLoaderData {
  homework: HomeworkRow[];
  classes: ClassRow[];
  students: StudentRow[];
  grades: GradeRow[];
  types: AssessmentTypeRow[];
}

type HomeworkDraft = {
  id?: string;
  title: string;
  classId?: string | null;
  due?: string | null;
  color?: string | null;
  done?: boolean;
  points?: number | string | null;
  notes?: string | null;
  assessmentTypeId?: string | null;
};

// ---- StatCard ----
function StatCard({
  icon,
  color,
  num,
  label,
}: {
  icon: IconName;
  color: string;
  num: number;
  label: string;
}) {
  return (
    <SC interactive style={{ padding: 0, cursor: 'default' }}>
      <div className="statcard">
        <div className="statcard__icon" style={ICON_TINT(color)}>
          <MIcon name={icon} size={24} />
        </div>
        <div>
          <div className="statcard__num">{num}</div>
          <div className="statcard__label">{label}</div>
        </div>
      </div>
    </SC>
  );
}

function DashHwItem({ h, classes }: { h: HomeworkRow; classes: ClassLite[] }) {
  const fetcher = useFetcher();
  const optimisticDone = fetcher.formData ? fetcher.formData.get('done') === 'true' : h.done;
  const c = colorOf(h.color);
  const clsName = (id: string | null) => classes.find((cl) => cl.id === id)?.name;
  const toggle = () => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', h.id);
    fd.set('done', String(!optimisticDone));
    fetcher.submit(fd, { action: '/homework', method: 'post' });
  };
  return (
    <div className="m-row" style={{ gap: 12 }}>
      <SCheck checked={optimisticDone} done onChange={toggle} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--text-sm)' }}>
          {h.title}
        </div>
        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {clsName(h.classId)}
        </div>
      </div>
      <span style={{ width: 10, height: 10, borderRadius: 9, background: c.base }} />
    </div>
  );
}

// ---- Dashboard / Today ----
function DashboardScreen({ user, onNav }: { user: AppUser; onNav: (route: string) => void }) {
  const { todayEvents, homework, classes, studentCount, materialCount } =
    useLoaderData() as DashLoaderData;
  const { t, lang } = useLang();
  const today = iso(TODAY);
  const todays = expandEvents(todayEvents, TODAY, TODAY).sort(
    (a, b) => toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00'),
  );
  const dueToday = homework.filter((h) => h.due === today && !h.done);
  const pending = homework.filter((h) => !h.done);
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name;
  const todayStr = new Date(TODAY).toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="content">
      <PageHeader
        title={t('dash_greeting', { name: user.name.split(' ')[0] })}
        subtitle={t(
          todays.length === 0
            ? 'dash_sub_none'
            : todays.length === 1
              ? 'dash_sub_one'
              : 'dash_sub_many',
          { date: todayStr, count: todays.length },
        )}
      />
      <div className="m-grid cols-4">
        <StatCard icon="book" color="green" num={classes.length} label={t('stat_classes')} />
        <StatCard icon="users" color="blue" num={studentCount} label={t('stat_students')} />
        <StatCard icon="clipboard" color="orange" num={pending.length} label={t('stat_homework')} />
        <StatCard icon="folder" color="violet" num={materialCount} label={t('stat_materials')} />
      </div>
      <div className="m-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Today's schedule */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_today_schedule')}</h2>
            <SBtn
              variant="ghost"
              size="sm"
              iconRight={<MIcon name="chevronRight" size={16} />}
              onClick={() => onNav('calendar')}
            >
              {t('nav_calendar')}
            </SBtn>
          </div>
          {todays.length ? (
            <div className="m-stack">
              {todays.map((e, i) => {
                const c = colorOf(e.color);
                return (
                  <div key={i} className="lrow" style={{ padding: 12 }}>
                    <div className="lrow__bar" style={{ background: c.base }} />
                    <div
                      className="m-mono"
                      style={{
                        minWidth: 70,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                      }}
                    >
                      {fmtTime(e.start ?? '00:00')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="lrow__title" style={{ fontSize: 'var(--text-md)' }}>
                        {e.title}
                      </div>
                      {e.location && (
                        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                          {e.location}
                        </div>
                      )}
                    </div>
                    {e.classId && <STag color={e.color}>{className(e.classId) || t('class')}</STag>}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              icon="calendar"
              title={t('dash_nothing_scheduled')}
              sub={t('dash_enjoy_quiet')}
            />
          )}
        </SC>
        {/* Due today */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_due_today')}</h2>
            {dueToday.length > 0 && <SBadge color="brand">{dueToday.length}</SBadge>}
          </div>
          {dueToday.length ? (
            <div className="m-stack">
              {dueToday.map((h) => (
                <DashHwItem key={h.id} h={h} classes={classes} />
              ))}
            </div>
          ) : (
            <Empty icon="check" title={t('dash_all_caught')} sub={t('dash_no_hw_today')} />
          )}
        </SC>
      </div>
    </div>
  );
}

// ---- Homework ----
interface HomeworkItemProps {
  h: HomeworkRow;
  classes: ClassLite[];
  today: string;
  lang: string;
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  typeName?: string | null;
  gradedLabel?: string | null;
  onGrade?: () => void;
}

function HomeworkItem({
  h,
  classes,
  today,
  lang,
  onEdit,
  onDelete,
  t,
  typeName,
  gradedLabel,
  onGrade,
}: HomeworkItemProps) {
  const fetcher = useFetcher();
  const optimisticDone = fetcher.formData ? fetcher.formData.get('done') === 'true' : h.done;
  const c = colorOf(h.color);
  const overdue = !optimisticDone && h.due && h.due < today;
  const clsName = (id: string | null) => classes.find((cl) => cl.id === id)?.name ?? '—';

  const toggle = () => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', h.id);
    fd.set('done', String(!optimisticDone));
    fetcher.submit(fd, { action: '/homework', method: 'post' });
  };

  return (
    <div className="lrow">
      <SCheck checked={optimisticDone} done onChange={toggle} />
      <div className="lrow__bar" style={{ background: c.base }} />
      <div style={{ flex: 1 }}>
        <div
          className="lrow__title"
          style={{
            textDecoration: optimisticDone ? 'line-through' : 'none',
            opacity: optimisticDone ? 0.55 : 1,
          }}
        >
          {h.title}
        </div>
        <div className="lrow__meta">
          <STag color={h.color}>{clsName(h.classId)}</STag>
          {h.due && (
            <span className="m-row" style={{ gap: 5 }}>
              <MIcon name="clock" size={14} />
              {overdue ? (
                <strong style={{ color: 'var(--danger)' }}>{t('hw_overdue')}</strong>
              ) : (
                new Date(h.due).toLocaleDateString(locale(lang), {
                  month: 'short',
                  day: 'numeric',
                })
              )}
            </span>
          )}
          {h.points != null && (
            <span
              className="mchip"
              style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
            >
              <MIcon name="flag" size={12} />
              {t('hw_pts', { n: h.points })}
            </span>
          )}
          {typeName && (
            <span
              className="mchip"
              style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
            >
              {typeName}
            </span>
          )}
          {gradedLabel && (
            <span
              className="mchip"
              style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
            >
              {gradedLabel}
            </span>
          )}
        </div>
        {h.notes && (
          <div
            className="m-muted"
            style={
              {
                fontSize: 'var(--text-sm)',
                marginTop: 6,
                textWrap: 'pretty',
              } as React.CSSProperties
            }
          >
            {h.notes}
          </div>
        )}
      </div>
      <div className="lrow__actions">
        {onGrade && (
          <SIB label={t('hw_grade')} size="sm" onClick={onGrade}>
            <MIcon name="chart" size={16} />
          </SIB>
        )}
        <SIB label={t('edit')} size="sm" onClick={onEdit}>
          <MIcon name="edit" size={16} />
        </SIB>
        <SIB label={t('delete')} size="sm" onClick={onDelete}>
          <MIcon name="trash" size={16} />
        </SIB>
      </div>
    </div>
  );
}

interface GradeModalProps {
  hw: HomeworkRow;
  roster: StudentRow[];
  grades: GradeRow[];
  onClose: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function GradeModal({ hw, roster, grades, onClose, t }: GradeModalProps) {
  const fetcher = useFetcher();
  const [rows, setRows] = React.useState<Record<string, { score: number | ''; comment: string }>>(
    () => {
      const init: Record<string, { score: number | ''; comment: string }> = {};
      for (const s of roster) {
        const g = grades.find((gr) => gr.studentId === s.id);
        init[s.id] = { score: g?.score ?? '', comment: g?.comment ?? '' };
      }
      return init;
    },
  );

  const setRow = (studentId: string, patch: Partial<{ score: number | ''; comment: string }>) =>
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'save-grades');
    fd.set('homeworkId', hw.id);
    fd.set(
      'records',
      JSON.stringify(
        roster.map((s) => ({
          studentId: s.id,
          score:
            rows[s.id]?.score === '' || rows[s.id]?.score == null ? null : Number(rows[s.id].score),
          comment: rows[s.id]?.comment?.trim() ? rows[s.id].comment.trim() : null,
        })),
      ),
    );
    fetcher.submit(fd, { action: '/homework', method: 'post' });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('hw_grade') + ': ' + hw.title}
      width={560}
      footer={
        <>
          <SBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </SBtn>
          <SBtn variant="primary" onClick={save}>
            {t('save')}
          </SBtn>
        </>
      }
    >
      <div
        className="m-muted"
        style={{ fontSize: 'var(--text-sm)', marginBottom: 10 } as React.CSSProperties}
      >
        {t('hw_grade_synced')}
      </div>
      <div className="m-stack">
        {roster.map((s) => (
          <div key={s.id} className="lrow">
            <div style={{ flex: 1 }}>
              <div className="lrow__title">{s.name}</div>
              <div className="m-grid cols-2" style={{ gap: 10, marginTop: 6 }}>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  className="mochi-input"
                  value={rows[s.id]?.score ?? ''}
                  onChange={(e) =>
                    setRow(s.id, { score: e.target.value === '' ? '' : Number(e.target.value) })
                  }
                />
                <input
                  className="mochi-input"
                  placeholder={t('hw_comment')}
                  value={rows[s.id]?.comment ?? ''}
                  onChange={(e) => setRow(s.id, { comment: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function HomeworkScreen() {
  const { homework: allHw, classes, students, grades, types } = useLoaderData() as HwLoaderData;
  const fetcher = useFetcher();
  const { t, lang } = useLang();
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState<HomeworkDraft | null>(null);
  const [gradeModal, setGradeModal] = React.useState<HomeworkRow | null>(null);
  const today = iso(TODAY);

  const list = allHw.filter((h) =>
    filter === 'all' ? true : filter === 'open' ? !h.done : h.done,
  );
  const doneCount = allHw.filter((h) => h.done).length;
  const pct = allHw.length ? Math.round((doneCount / allHw.length) * 100) : 0;

  const openNew = () =>
    setModal({
      title: '',
      classId: classes[0]?.id || '',
      due: today,
      color: classes[0]?.color || 'orange',
      done: false,
      points: 10,
      notes: '',
      assessmentTypeId: '',
    });

  const save = (f: HomeworkDraft) => {
    const title = (f.title ?? '').trim() || t('hw_untitled');
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('title', title);
    if (f.classId) fd.set('classId', f.classId);
    if (f.due) fd.set('due', f.due);
    if (f.color) fd.set('color', f.color);
    fd.set('done', String(!!f.done));
    if (f.points != null && f.points !== '') fd.set('points', String(f.points));
    if (f.notes) fd.set('notes', f.notes);
    fd.set('assessmentTypeId', f.assessmentTypeId ?? '');
    fetcher.submit(fd, { action: '/homework', method: 'post' });
    setModal(null);
  };

  const removeHw = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/homework', method: 'post' });
  };

  return (
    <div className="content">
      <PageHeader
        title={t('hw_title')}
        subtitle={t('hw_sub')}
        actions={
          <SBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
            {t('hw_add')}
          </SBtn>
        }
      />
      <SC style={{ padding: 18 }}>
        <div className="m-spread" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 800, color: 'var(--text-strong)' }}>
            {t('hw_complete', { done: doneCount, total: allHw.length })}
          </div>
          <div className="m-mono m-muted">{`${pct}%`}</div>
        </div>
        <SProg value={pct} color="green" />
      </SC>
      <DS.Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: t('all') },
          { id: 'open', label: t('hw_tab_open') },
          { id: 'done', label: t('hw_tab_done') },
        ]}
      />
      <div className="m-stack">
        {list.length ? (
          list.map((h) => {
            const roster = classes.find((c) => c.id === h.classId)?.studentIds ?? [];
            const hwGrades = grades.filter((g) => g.homeworkId === h.id);
            const gradedCount = hwGrades.filter((g) => g.score != null || g.comment).length;
            return (
              <HomeworkItem
                key={h.id}
                h={h}
                classes={classes}
                today={today}
                lang={lang}
                onEdit={() => setModal({ ...h })}
                onDelete={() => removeHw(h.id)}
                t={t}
                typeName={types.find((tp) => tp.id === h.assessmentTypeId)?.name ?? null}
                gradedLabel={
                  h.classId && roster.length
                    ? t('hw_graded_n', { done: gradedCount, total: roster.length })
                    : null
                }
                onGrade={h.classId ? () => setGradeModal(h) : undefined}
              />
            );
          })
        ) : (
          <SC>
            <Empty icon="clipboard" title={t('hw_no_tasks')} sub={t('hw_add_start')} />
          </SC>
        )}
      </div>
      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('hw_edit_task') : t('hw_new_task')}
          width={480}
          footer={
            <>
              <SBtn variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </SBtn>
              <SBtn variant="primary" onClick={() => save(modal)}>
                {t('save')}
              </SBtn>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('hw_task')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.title}
              onChange={(e) => setModal((m) => (m ? { ...m, title: e.target.value } : m))}
            />
          </div>
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MSelect
              label={t('class')}
              value={modal.classId ?? ''}
              onChange={(v) => {
                const cls = classes.find((x) => x.id === v);
                setModal((m) => (m ? { ...m, classId: v, color: cls ? cls.color : m.color } : m));
              }}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
            />
            <MDatePicker
              label={t('hw_due')}
              value={modal.due || ''}
              onChange={(v) => setModal((m) => (m ? { ...m, due: v } : m))}
              clearable
            />
          </div>
          <MSelect
            label={t('assess_score_label')}
            value={modal.assessmentTypeId ?? ''}
            onChange={(v) => setModal((m) => (m ? { ...m, assessmentTypeId: v } : m))}
            options={[
              { value: '', label: t('assess_type_none') },
              ...types
                .filter((tp) => tp.active || tp.id === modal.assessmentTypeId)
                .map((tp) => ({ value: tp.id, label: tp.name })),
            ]}
          />
          <div className="mochi-field" style={{ maxWidth: 160 }}>
            <label className="mochi-field__label">{t('hw_points')}</label>
            <input
              type="number"
              min={0}
              className="mochi-input"
              value={modal.points ?? ''}
              onChange={(e) =>
                setModal((m) =>
                  m
                    ? {
                        ...m,
                        points: e.target.value === '' ? '' : Number(e.target.value),
                      }
                    : m,
                )
              }
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('hw_notes')}</label>
            <textarea
              className="mochi-input"
              rows={3}
              style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
              placeholder={t('hw_notes_ph')}
              value={modal.notes || ''}
              onChange={(e) => setModal((m) => (m ? { ...m, notes: e.target.value } : m))}
            />
          </div>
        </Modal>
      )}
      {gradeModal && (
        <GradeModal
          hw={gradeModal}
          roster={(classes.find((c) => c.id === gradeModal.classId)?.studentIds ?? [])
            .map((sid) => students.find((s) => s.id === sid))
            .filter((s): s is StudentRow => !!s)}
          grades={grades.filter((g) => g.homeworkId === gradeModal.id)}
          onClose={() => setGradeModal(null)}
          t={t}
        />
      )}
    </div>
  );
}

export { DashboardScreen, HomeworkScreen };
